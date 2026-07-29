import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
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
        ONYX_OUTBOX_WEBHOOK_URL: "",
        ONYX_PORT: String(port),
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
      assert.equal((await health.json() as {status: string}).status, "ok");

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
      assert.equal((await malformed.json() as {code: string}).code, "INVALID_ARGUMENT");

      const oversized = await fetch(`${origin}/v1/mission/commands/CreateMission`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({payload: "x".repeat(1_048_576)}),
      });
      assert.equal(oversized.status, 400);
      assert.equal((await oversized.json() as {message: string}).message, "command envelope exceeds 1 MiB");

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
