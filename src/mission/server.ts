import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { OnyxApplication, errorResponse, type ApiResponse } from "../api/application.ts";
import { OnyxError } from "../contracts/errors.ts";
import { jsonLineLogger, resolveRequestId } from "../infrastructure/observability/logger.ts";
import { uuidV7 } from "../shared/identifiers.ts";

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
const requestLogger = jsonLineLogger();
const logInternalError = (error: unknown): void => {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: "application.error",
    error_name: errorName,
  })}\n`);
};

const application = new OnyxApplication({
  ...(process.env.ONYX_DB_PATH ? {databasePath: process.env.ONYX_DB_PATH} : {}),
  replicaIds: {
    ...(process.env.ONYX_REPLICA_ID ? {mission: process.env.ONYX_REPLICA_ID} : {}),
    ...(process.env.ONYX_WORK_REPLICA_ID ? {work: process.env.ONYX_WORK_REPLICA_ID} : {}),
    ...(process.env.ONYX_TIMELINE_REPLICA_ID ? {timeline: process.env.ONYX_TIMELINE_REPLICA_ID} : {}),
    ...(process.env.ONYX_REPORTING_REPLICA_ID ? {reportingEvidence: process.env.ONYX_REPORTING_REPLICA_ID} : {}),
  },
  logger: requestLogger,
  logError: logInternalError,
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
  const startedAt = performance.now();
  const requestIdHeader = request.headers["x-request-id"];
  const requestId = resolveRequestId(Array.isArray(requestIdHeader) ? undefined : requestIdHeader, () => uuidV7());
  try {
    const body = request.method === "POST" ? await readJson(request) : undefined;
    respond(response, await application.handle({
      method: request.method ?? "GET",
      path: request.url ?? "/",
      body,
      headers: {authorization: request.headers.authorization, "x-request-id": requestId},
    }));
  } catch (error) {
    const result = errorResponse(error, logInternalError);
    respond(response, {...result, headers: {...result.headers, "x-request-id": requestId}});
    requestLogger({
      timestamp: new Date().toISOString(),
      level: result.status >= 500 ? "error" : "warn",
      event: "http.request.completed",
      request_id: requestId,
      method: request.method ?? "GET",
      path: new URL(request.url ?? "/", "http://onyx.local").pathname,
      status: result.status,
      duration_ms: Math.max(0, Math.round((performance.now() - startedAt) * 1_000) / 1_000),
      error_code: (result.body as {code: string}).code,
      ...(error instanceof Error ? {error_name: error.name} : {}),
    });
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
