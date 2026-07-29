import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OnyxError } from "../contracts/errors.ts";
import { InMemoryMissionRepository } from "./repository.ts";
import { MissionService } from "./service.ts";
import { InMemoryWorkRepository } from "../work/repository.ts";
import { WorkService } from "../work/service.ts";
import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import { SqliteMissionRepository } from "./sqlite-repository.ts";
import { SqliteWorkRepository } from "../work/sqlite-repository.ts";

const host = process.env.ONYX_HOST ?? "127.0.0.1";
const port = Number(process.env.ONYX_PORT ?? "3000");
const database = process.env.ONYX_DB_PATH ? new SqliteDatabase(process.env.ONYX_DB_PATH) : undefined;
const service = new MissionService({
  repository: database ? new SqliteMissionRepository(database) : new InMemoryMissionRepository(),
  replicaId: process.env.ONYX_REPLICA_ID ?? "mission-api",
});
const workService = new WorkService({
  repository: database ? new SqliteWorkRepository(database) : new InMemoryWorkRepository(),
  replicaId: process.env.ONYX_WORK_REPLICA_ID ?? "work-api",
  requireMission: async (organizationId, missionId) => {
    await service.getMission(organizationId, missionId);
  },
});

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {"content-type": "application/json; charset=utf-8"});
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_048_576) throw new OnyxError("INVALID_ARGUMENT", "command envelope exceeds 1 MiB");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OnyxError("INVALID_ARGUMENT", "request body must be valid JSON");
  }
}

export const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      return respond(response, 200, {status: "ok", contexts: ["mission", "work"]});
    }
    if (request.method === "POST" && request.url?.startsWith("/v1/mission/commands/")) {
      const command = await readJson(request);
      const routeType = request.url.slice("/v1/mission/commands/".length);
      if ((command as {command_type?: string})?.command_type !== routeType) {
        throw new OnyxError("INVALID_ARGUMENT", "command_type must match the command route");
      }
      const event = await service.execute(command);
      return respond(response, 202, event);
    }
    if (request.method === "POST" && request.url?.startsWith("/v1/work/commands/")) {
      const command = await readJson(request);
      const routeType = request.url.slice("/v1/work/commands/".length);
      if ((command as {command_type?: string})?.command_type !== routeType) {
        throw new OnyxError("INVALID_ARGUMENT", "command_type must match the command route");
      }
      const event = await workService.execute(command);
      return respond(response, 202, event);
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/v1/missions") {
      const organizationId = url.searchParams.get("organization_id");
      if (!organizationId) throw new OnyxError("INVALID_ARGUMENT", "organization_id is required");
      return respond(response, 200, {items: await service.listMissions(organizationId)});
    }
    const historyMatch = url.pathname.match(/^\/v1\/missions\/([^/]+)\/history$/);
    if (request.method === "GET" && historyMatch) {
      const organizationId = url.searchParams.get("organization_id");
      if (!organizationId) throw new OnyxError("INVALID_ARGUMENT", "organization_id is required");
      const afterVersion = Number(url.searchParams.get("after_version") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      return respond(response, 200, {items: await service.getHistory(organizationId, historyMatch[1], afterVersion, limit)});
    }
    const missionMatch = url.pathname.match(/^\/v1\/missions\/([^/]+)$/);
    if (request.method === "GET" && missionMatch) {
      const organizationId = url.searchParams.get("organization_id");
      if (!organizationId) throw new OnyxError("INVALID_ARGUMENT", "organization_id is required");
      return respond(response, 200, await service.getMission(organizationId, missionMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/v1/tasks") {
      const organizationId = url.searchParams.get("organization_id");
      if (!organizationId) throw new OnyxError("INVALID_ARGUMENT", "organization_id is required");
      return respond(response, 200, {items: await workService.listTasks(organizationId)});
    }
    const taskHistoryMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/history$/);
    if (request.method === "GET" && taskHistoryMatch) {
      const organizationId = url.searchParams.get("organization_id");
      if (!organizationId) throw new OnyxError("INVALID_ARGUMENT", "organization_id is required");
      const afterVersion = Number(url.searchParams.get("after_version") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      return respond(response, 200, {items: await workService.getHistory(organizationId, taskHistoryMatch[1], afterVersion, limit)});
    }
    const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
    if (request.method === "GET" && taskMatch) {
      const organizationId = url.searchParams.get("organization_id");
      if (!organizationId) throw new OnyxError("INVALID_ARGUMENT", "organization_id is required");
      return respond(response, 200, await workService.getTask(organizationId, taskMatch[1]));
    }
    return respond(response, 404, {code: "NOT_FOUND", message: "route not found"});
  } catch (error) {
    if (error instanceof OnyxError) {
      return respond(response, error.httpStatus, {code: error.code, message: error.message, details: error.details});
    }
    console.error(error);
    return respond(response, 500, {code: "INTERNAL_ERROR", message: "unexpected failure"});
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(port, host, () => console.log(`ONYX API listening on http://${host}:${port}`));

  const shutdown = (): void => {
    server.close(() => {
      database?.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
