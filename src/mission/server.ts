import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { OnyxApplication, errorResponse, type ApiResponse } from "../api/application.ts";
import { OnyxError } from "../contracts/errors.ts";
import { ConcurrencyGate, HttpAdmissionController, TokenBucketRateLimiter } from "../infrastructure/http/admission.ts";
import { jsonLineLogger, resolveRequestId } from "../infrastructure/observability/logger.ts";
import { createHttpEventPublisher } from "../infrastructure/outbox/http-publisher.ts";
import { OutboxDispatcher } from "../infrastructure/outbox/dispatcher.ts";
import { OutboxWorker } from "../infrastructure/outbox/worker.ts";
import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
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
const databasePath = process.env.ONYX_DB_PATH;
const trustProxy = optionalBoolean("ONYX_TRUST_PROXY", false);
const requestTimeoutMs = optionalInteger("ONYX_REQUEST_TIMEOUT_MS", 15_000, 1_000, 300_000);
const headersTimeoutMs = optionalInteger("ONYX_HEADERS_TIMEOUT_MS", 5_000, 1_000, 60_000);
if (headersTimeoutMs > requestTimeoutMs) throw new Error("ONYX_HEADERS_TIMEOUT_MS must not exceed ONYX_REQUEST_TIMEOUT_MS");
const keepAliveTimeoutMs = optionalInteger("ONYX_KEEP_ALIVE_TIMEOUT_MS", 5_000, 100, 60_000);
const socketTimeoutMs = optionalInteger("ONYX_SOCKET_TIMEOUT_MS", 30_000, 1_000, 600_000);
const maxHeaderSize = optionalInteger("ONYX_MAX_HEADER_BYTES", 16_384, 1_024, 65_536);
const maxHeadersCount = optionalInteger("ONYX_MAX_HEADERS_COUNT", 100, 10, 1_000);
const maxRequestsPerSocket = optionalInteger("ONYX_MAX_REQUESTS_PER_SOCKET", 1_000, 1, 100_000);
const admission = new HttpAdmissionController(
  new TokenBucketRateLimiter({
    capacity: optionalNumber("ONYX_RATE_LIMIT_CAPACITY", 120, 1, 100_000),
    refillPerSecond: optionalNumber("ONYX_RATE_LIMIT_REFILL_PER_SECOND", 20, 0.01, 10_000),
    maxClients: optionalInteger("ONYX_RATE_LIMIT_MAX_CLIENTS", 10_000, 1, 1_000_000),
    idleTtlMs: optionalInteger("ONYX_RATE_LIMIT_IDLE_TTL_MS", 600_000, 1_000, 86_400_000),
  }),
  new ConcurrencyGate(optionalInteger("ONYX_MAX_IN_FLIGHT", 100, 1, 100_000)),
);
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
  ...(databasePath ? {databasePath} : {}),
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

export const server = createServer({
  requestTimeout: requestTimeoutMs,
  headersTimeout: headersTimeoutMs,
  keepAliveTimeout: keepAliveTimeoutMs,
  maxHeaderSize,
  connectionsCheckingInterval: 1_000,
}, async (request, response) => {
  const startedAt = performance.now();
  const requestIdHeader = request.headers["x-request-id"];
  const requestId = resolveRequestId(Array.isArray(requestIdHeader) ? undefined : requestIdHeader, () => uuidV7());
  const pathname = new URL(request.url ?? "/", "http://onyx.local").pathname;
  const decision = pathname === "/healthz" ? undefined : admission.admit(clientKey(request), Date.now());
  if (decision && !decision.accepted) {
    const result: ApiResponse = {
      status: decision.status,
      body: {
        code: decision.code,
        message: decision.code === "RATE_LIMITED" ? "request rate limit exceeded" : "server concurrency limit reached",
      },
      headers: {
        "x-request-id": requestId,
        "x-ratelimit-remaining": String(decision.remaining),
        "retry-after": String(decision.retryAfterSeconds),
        ...(decision.status === 503 ? {connection: "close"} : {}),
      },
    };
    respond(response, result);
    logTransportResult(request, result, requestId, startedAt);
    return;
  }
  try {
    const body = request.method === "POST" ? await readJson(request) : undefined;
    const result = await application.handle({
      method: request.method ?? "GET",
      path: request.url ?? "/",
      body,
      headers: {authorization: request.headers.authorization, "x-request-id": requestId},
    });
    respond(response, decision
      ? {...result, headers: {...result.headers, "x-ratelimit-remaining": String(decision.remaining)}}
      : result);
  } catch (error) {
    const result = errorResponse(error, logInternalError);
    const completed = {
      ...result,
      headers: {
        ...result.headers,
        "x-request-id": requestId,
        ...(decision ? {"x-ratelimit-remaining": String(decision.remaining)} : {}),
      },
    };
    respond(response, completed);
    logTransportResult(request, completed, requestId, startedAt, error);
  } finally {
    decision?.accepted && decision.release();
  }
});
server.maxHeadersCount = maxHeadersCount;
server.maxRequestsPerSocket = maxRequestsPerSocket;
server.setTimeout(socketTimeoutMs);

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when ONYX_AUTH_MODE=required`);
  return value;
}

function optionalInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} through ${maximum}`);
  }
  return value;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function clientKey(request: IncomingMessage): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = value?.split(",", 1)[0]?.trim();
    if (first && first.length <= 128) return first;
  }
  return (request.socket.remoteAddress ?? "unknown").slice(0, 128);
}

function logTransportResult(
  request: IncomingMessage,
  result: ApiResponse,
  requestId: string,
  startedAt: number,
  error?: unknown,
): void {
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

function workerLog(level: "info" | "error", event: string, fields: Record<string, unknown>): void {
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify({timestamp: new Date().toISOString(), level, event, ...fields})}\n`);
}

function createOutboxRuntime(): {worker: OutboxWorker; database: SqliteDatabase} | undefined {
  const url = process.env.ONYX_OUTBOX_WEBHOOK_URL;
  if (!url) return undefined;
  if (!databasePath || databasePath === ":memory:") {
    throw new Error("ONYX_DB_PATH must be a file-backed database when the outbox worker is enabled");
  }
  const batchSize = optionalInteger("ONYX_OUTBOX_BATCH_SIZE", 10, 1, 1_000);
  const timeoutMs = optionalInteger("ONYX_OUTBOX_TIMEOUT_MS", 10_000, 100, 120_000);
  const leaseDurationMs = optionalInteger("ONYX_OUTBOX_LEASE_MS", 120_000, 1_000, 3_600_000);
  if (leaseDurationMs <= batchSize * timeoutMs) {
    throw new Error("ONYX_OUTBOX_LEASE_MS must exceed ONYX_OUTBOX_BATCH_SIZE multiplied by ONYX_OUTBOX_TIMEOUT_MS");
  }
  const database = new SqliteDatabase(databasePath);
  const workerId = process.env.ONYX_OUTBOX_WORKER_ID ?? `${hostname()}:${process.pid}`;
  const dispatcher = new OutboxDispatcher({
    database,
    workerId,
    batchSize,
    leaseDurationMs,
    maxAttempts: optionalInteger("ONYX_OUTBOX_MAX_ATTEMPTS", 10, 1, 1_000),
    publish: createHttpEventPublisher({
      url,
      timeoutMs,
      ...(process.env.ONYX_OUTBOX_BEARER_TOKEN ? {bearerToken: process.env.ONYX_OUTBOX_BEARER_TOKEN} : {}),
    }),
  });
  return {
    database,
    worker: new OutboxWorker({
      dispatcher,
      pollIntervalMs: optionalInteger("ONYX_OUTBOX_POLL_MS", 1_000, 10, 60_000),
      errorDelayMs: optionalInteger("ONYX_OUTBOX_ERROR_DELAY_MS", 5_000, 100, 300_000),
      onBatch: (result) => {
        if (result.claimed > 0) workerLog("info", "outbox.batch.completed", {worker_id: workerId, ...result});
      },
      onError: (error) => workerLog("error", "outbox.worker.error", {
        worker_id: workerId,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outbox = createOutboxRuntime();
  server.listen(port, host, () => {
    workerLog("info", "http.server.started", {host, port, outbox_worker_enabled: outbox !== undefined});
    outbox?.worker.start();
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    workerLog("info", "application.shutdown.started", {});
    const closeServer = new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    void Promise.all([closeServer, outbox?.worker.stop()]).then(() => {
      outbox?.database.close();
      application.close();
      workerLog("info", "application.shutdown.completed", {});
      process.exit(0);
    }).catch((error: unknown) => {
      logInternalError(error);
      process.exit(1);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
