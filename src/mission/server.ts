import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { OnyxApplication, errorResponse, type ApiResponse } from "../api/application.ts";
import { OnyxError } from "../contracts/errors.ts";

const host = process.env.ONYX_HOST ?? "127.0.0.1";
const port = Number(process.env.ONYX_PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("ONYX_PORT must be an integer from 1 to 65535");
const authMode = process.env.ONYX_AUTH_MODE ?? "disabled";
if (authMode !== "disabled" && authMode !== "required") throw new Error("ONYX_AUTH_MODE must be disabled or required");
const auth = authMode === "required" ? {
  publicKey: readFileSync(requiredEnvironment("ONYX_AUTH_PUBLIC_KEY_PATH")),
  issuer: requiredEnvironment("ONYX_AUTH_ISSUER"),
  audience: requiredEnvironment("ONYX_AUTH_AUDIENCE"),
} : undefined;

const application = new OnyxApplication({
  ...(process.env.ONYX_DB_PATH ? {databasePath: process.env.ONYX_DB_PATH} : {}),
  replicaIds: {
    ...(process.env.ONYX_REPLICA_ID ? {mission: process.env.ONYX_REPLICA_ID} : {}),
    ...(process.env.ONYX_WORK_REPLICA_ID ? {work: process.env.ONYX_WORK_REPLICA_ID} : {}),
    ...(process.env.ONYX_TIMELINE_REPLICA_ID ? {timeline: process.env.ONYX_TIMELINE_REPLICA_ID} : {}),
    ...(process.env.ONYX_REPORTING_REPLICA_ID ? {reportingEvidence: process.env.ONYX_REPORTING_REPLICA_ID} : {}),
  },
  ...(auth ? {auth} : {}),
});

function respond(response: ServerResponse, result: ApiResponse): void {
  response.writeHead(result.status, {"content-type": "application/json; charset=utf-8", ...result.headers});
  response.end(JSON.stringify(result.body));
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
    const body = request.method === "POST" ? await readJson(request) : undefined;
    respond(response, await application.handle({
      method: request.method ?? "GET",
      path: request.url ?? "/",
      body,
      headers: {authorization: request.headers.authorization},
    }));
  } catch (error) {
    respond(response, errorResponse(error));
  }
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when ONYX_AUTH_MODE=required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(port, host, () => console.log(`ONYX API listening on http://${host}:${port}`));

  const shutdown = (): void => {
    server.close(() => {
      application.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
