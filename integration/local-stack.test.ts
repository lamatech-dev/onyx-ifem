import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("starts and gracefully stops the complete local product stack", { timeout: 60_000 }, async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "onyx-stack-"));
  const child = spawn(process.execPath, ["--experimental-strip-types", "tools/local-stack.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ONYX_DB_PATH: join(temporaryDirectory, "onyx.db"),
      ONYX_PORT: "3111",
      ONYX_WEB_PORT: "3112",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`stack startup timed out\n${output}`)), 45_000);
      const inspect = () => {
        if (!output.includes("ONYX stack ready:")) return;
        clearTimeout(timeout);
        resolveReady();
      };
      child.stdout.on("data", inspect);
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        rejectReady(new Error(`stack exited before readiness (${signal || code})\n${output}`));
      });
    });
    const [api, web, image] = await Promise.all([
      fetch("http://127.0.0.1:3111/readyz"),
      fetch("http://localhost:3112/"),
      fetch("http://localhost:3112/og.png"),
    ]);
    assert.equal(api.status, 200);
    assert.equal(web.status, 200);
    assert.equal(image.status, 200);
    child.kill("SIGTERM");
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })));
    assert.equal(exit.signal, null, output);
    assert.equal(exit.code, 0, output);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
