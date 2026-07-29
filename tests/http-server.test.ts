import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("HTTP executable", () => {
  it("serves a durable process over a real socket and shuts down cleanly", {timeout: 20_000}, async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-http-process-"));
    const port = await availablePort();
    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, ["--experimental-strip-types", "src/mission/server.ts"], {
      cwd: new URL("..", import.meta.url),
      env: cleanEnvironment({
        ONYX_AUTH_MODE: "disabled",
        ONYX_DB_PATH: join(directory, "onyx.db"),
        ONYX_HOST: "127.0.0.1",
        ONYX_MAX_IN_FLIGHT: "1",
        ONYX_OUTBOX_WEBHOOK_URL: "",
        ONYX_PORT: String(port),
        ONYX_RATE_LIMIT_CAPACITY: "11",
        ONYX_RATE_LIMIT_REFILL_PER_SECOND: "0.01",
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    try {
      await waitForOutput(child, () => `${stdout}\n${stderr}`, '"event":"http.server.started"');
      const origin = `http://127.0.0.1:${port}`;

      const health = await fetch(`${origin}/healthz`, {headers: {"x-request-id": "smoke-health"}});
      assert.equal(health.status, 200);
      assert.equal(health.headers.get("x-request-id"), "smoke-health");
      assert.equal(health.headers.get("cache-control"), "no-store");
      assert.equal(health.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'; sandbox");
      assert.equal(health.headers.get("referrer-policy"), "no-referrer");
      assert.equal(health.headers.get("x-content-type-options"), "nosniff");
      assert.equal(health.headers.get("x-frame-options"), "DENY");
      assert.equal(health.headers.has("strict-transport-security"), false);
      assert.equal((await health.json() as {status: string}).status, "ok");

      const head = await fetch(`${origin}/healthz`, {method: "HEAD"});
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");

      const wrongHealthMethod = await fetch(`${origin}/healthz`, {
        method: "POST",
        headers: {"content-type": "text/plain"},
        body: "must-not-be-parsed",
      });
      assert.equal(wrongHealthMethod.status, 405);
      assert.equal(wrongHealthMethod.headers.get("allow"), "GET, HEAD");
      assert.equal(wrongHealthMethod.headers.get("connection"), "close");
      assert.equal((await wrongHealthMethod.json() as {code: string}).code, "INVALID_ARGUMENT");

      const readiness = await fetch(`${origin}/readyz`);
      assert.equal(readiness.status, 200);
      const readinessBody = await readiness.json() as {persistence: {durable: boolean}; messaging: {enabled: boolean}};
      assert.equal(readinessBody.persistence.durable, true);
      assert.equal(readinessBody.messaging.enabled, true);

      const metrics = await fetch(`${origin}/metrics`);
      assert.equal(metrics.status, 200);
      assert.match(metrics.headers.get("content-type") ?? "", /^text\/plain; version=0\.0\.4/);
      assert.match(await metrics.text(), /onyx_persistence_durable 1\n/);

      const malformed = await fetch(`${origin}/v1/mission/commands/CreateMission`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: "{",
      });
      assert.equal(malformed.status, 400);
      assert.equal(malformed.headers.get("connection"), "close");
      assert.equal((await malformed.json() as {code: string}).code, "INVALID_ARGUMENT");

      const oversized = await fetch(`${origin}/v1/mission/commands/CreateMission`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({payload: "x".repeat(1_048_576)}),
      });
      assert.equal(oversized.status, 400);
      assert.equal((await oversized.json() as {message: string}).message, "command envelope exceeds 1 MiB");

      const missingContentType = await fetch(`${origin}/v1/mission/commands/CreateMission`, {
        method: "POST",
        body: Buffer.from("{}"),
      });
      assert.equal(missingContentType.status, 400);
      assert.equal(missingContentType.headers.get("connection"), "close");
      assert.equal((await missingContentType.json() as {message: string}).message, "content-type application/json is required");

      const wrongContentType = await fetch(`${origin}/v1/mission/commands/CreateMission`, {
        method: "POST",
        headers: {"content-type": "text/plain"},
        body: "{}",
      });
      assert.equal(wrongContentType.status, 400);

      const wrongCharset = await fetch(`${origin}/v1/mission/commands/CreateMission`, {
        method: "POST",
        headers: {"content-type": "application/json; charset=iso-8859-1"},
        body: "{}",
      });
      assert.equal(wrongCharset.status, 400);

      const compressed = await fetch(`${origin}/v1/mission/commands/CreateMission`, {
        method: "POST",
        headers: {"content-encoding": "gzip", "content-type": "application/json"},
        body: "{}",
      });
      assert.equal(compressed.status, 400);

      const invalidUtf8 = await fetch(`${origin}/v1/mission/commands/CreateMission`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
      });
      assert.equal(invalidUtf8.status, 400);
      assert.equal((await invalidUtf8.json() as {message: string}).message, "request body must be valid UTF-8");

      const held = createConnection({host: "127.0.0.1", port});
      let heldResponse = "";
      held.setEncoding("utf8");
      held.on("data", (chunk: string) => { heldResponse += chunk; });
      await once(held, "connect");
      held.write([
        "POST /v1/mission/commands/CreateMission HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Content-Length: 9",
        "Connection: close",
        "",
        "{",
      ].join("\r\n"));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const overloaded = await fetch(`${origin}/v1/missions?organization_id=00000000-0000-7000-8000-000000000013`);
      assert.equal(overloaded.status, 503);
      assert.equal((await overloaded.json() as {code: string}).code, "DEPENDENCY_UNAVAILABLE");

      const readyUnderConcurrency = await fetch(`${origin}/readyz`);
      assert.equal(readyUnderConcurrency.status, 200);
      assert.equal(readyUnderConcurrency.headers.has("x-ratelimit-remaining"), false);

      held.end('"x":123}');
      await once(held, "end");
      assert.match(heldResponse, /^HTTP\/1\.1 400 /);

      const rateLimited = await fetch(`${origin}/v1/missions?organization_id=00000000-0000-7000-8000-000000000013`);
      assert.equal(rateLimited.status, 429);
      assert.equal((await rateLimited.json() as {code: string}).code, "RATE_LIMITED");

      const wrongMetricsMethod = await fetch(`${origin}/metrics`, {method: "POST", body: "{}"});
      assert.equal(wrongMetricsMethod.status, 429);

      assert.equal((await fetch(`${origin}/healthz`)).status, 200);
      assert.equal((await fetch(`${origin}/readyz`)).status, 200);
      const metricsUnderPressure = await fetch(`${origin}/metrics`);
      assert.equal(metricsUnderPressure.status, 200);
      assert.match(await metricsUnderPressure.text(), /onyx_http_admission_rejections_total\{reason="concurrency_limited"\} 1/);
      assert.match(await (await fetch(`${origin}/metrics`)).text(), /onyx_http_admission_rejections_total\{reason="rate_limited"\} 2/);

      child.kill("SIGTERM");
      const [code, signal] = await waitForExit(child);
      assert.equal(code, 0, `server exited with stderr:\n${stderr}`);
      assert.equal(signal, null);
      assert.match(stdout, /"event":"application.shutdown.completed"/);
      assert.match(stdout, /"request_id":"smoke-health"/);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
  });

  it("forces shutdown after the configured drain deadline", {timeout: 10_000}, async () => {
    const port = await availablePort();
    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, ["--experimental-strip-types", "src/mission/server.ts"], {
      cwd: new URL("..", import.meta.url),
      env: cleanEnvironment({
        ONYX_AUTH_MODE: "disabled",
        ONYX_HOST: "127.0.0.1",
        ONYX_PORT: String(port),
        ONYX_REQUEST_TIMEOUT_MS: "300000",
        ONYX_SHUTDOWN_TIMEOUT_MS: "200",
        ONYX_SOCKET_TIMEOUT_MS: "300000",
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    let held: ReturnType<typeof createConnection> | undefined;

    try {
      await waitForOutput(child, () => `${stdout}\n${stderr}`, '"event":"http.server.started"');
      held = createConnection({host: "127.0.0.1", port});
      await once(held, "connect");
      held.write([
        "POST /v1/mission/commands/CreateMission HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Content-Length: 100",
        "Connection: close",
        "",
        "{",
      ].join("\r\n"));
      await new Promise((resolve) => setTimeout(resolve, 25));

      child.kill("SIGTERM");
      const [code, signal] = await waitForExit(child);
      assert.equal(code, 1);
      assert.equal(signal, null);
      assert.match(stdout, /"event":"application.shutdown.started"/);
      assert.match(stderr, /"event":"application.shutdown.forced","timeout_ms":200/);
      assert.doesNotMatch(stdout, /"event":"application.shutdown.completed"/);
    } finally {
      held?.destroy();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
  });
});

function cleanEnvironment(onyx: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("ONYX_"))),
    ...onyx,
  };
}

async function availablePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("failed to allocate a TCP port");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForOutput(child: ChildProcess, output: () => string, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!output().includes(expected)) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`server exited before startup:\n${output()}`);
    if (Date.now() >= deadline) throw new Error(`timed out waiting for server startup:\n${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForExit(child: ChildProcess): Promise<[number | null, NodeJS.Signals | null]> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for graceful shutdown")), 5_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve([code, signal]);
    });
  });
}
