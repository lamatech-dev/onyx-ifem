import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OnyxError } from "../contracts/errors.ts";
import { InMemoryMissionRepository } from "./repository.ts";
import { MissionService } from "./service.ts";

const host = process.env.ONYX_HOST ?? "127.0.0.1";
const port = Number(process.env.ONYX_PORT ?? "3000");
const service = new MissionService({
  repository: new InMemoryMissionRepository(),
  replicaId: process.env.ONYX_REPLICA_ID ?? "mission-api",
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
      return respond(response, 200, {status: "ok", context: "mission"});
    }
    if (request.method === "POST" && request.url === "/v1/mission/commands/CreateMission") {
      const event = await service.createMission(await readJson(request));
      return respond(response, 202, event);
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
  server.listen(port, host, () => console.log(`ONYX Mission API listening on http://${host}:${port}`));
}

