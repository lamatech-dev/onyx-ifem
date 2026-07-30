import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

export interface LocalStackConfig {
  apiHost: "127.0.0.1";
  apiPort: number;
  webHost: "localhost";
  webPort: number;
  databasePath: string;
  rootDirectory: string;
  webDirectory: string;
}

function port(value: string | undefined, fallback: number, name: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

export function resolveLocalStackConfig(environment: NodeJS.ProcessEnv = process.env): LocalStackConfig {
  const rootDirectory = resolve(environment.ONYX_ROOT_PATH || process.cwd());
  const apiPort = port(environment.ONYX_PORT, 3001, "ONYX_PORT");
  const webPort = port(environment.ONYX_WEB_PORT, 3002, "ONYX_WEB_PORT");
  if (apiPort === webPort) throw new Error("ONYX_PORT and ONYX_WEB_PORT must be different");
  return {
    apiHost: "127.0.0.1",
    apiPort,
    webHost: "localhost",
    webPort,
    databasePath: resolve(rootDirectory, environment.ONYX_DB_PATH || "data/onyx.db"),
    rootDirectory,
    webDirectory: resolve(rootDirectory, "web"),
  };
}

async function waitFor(url: string, label: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

function stop(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, timeoutMs)),
  ]);
}

export async function runLocalStack(config = resolveLocalStackConfig()) {
  await mkdir(dirname(config.databasePath), { recursive: true });
  const apiUrl = `http://${config.apiHost}:${config.apiPort}`;
  const webUrl = `http://${config.webHost}:${config.webPort}`;
  const api = spawn(process.execPath, ["--experimental-strip-types", "src/mission/server.ts"], {
    cwd: config.rootDirectory,
    env: {
      ...process.env,
      ONYX_AUTH_MODE: process.env.ONYX_AUTH_MODE || "disabled",
      ONYX_DB_PATH: config.databasePath,
      ONYX_HOST: config.apiHost,
      ONYX_PORT: String(config.apiPort),
    },
    stdio: "inherit",
  });
  const web = spawn("npm", ["run", "dev", "--", "--host", config.webHost, "--port", String(config.webPort), "--strictPort"], {
    cwd: config.webDirectory,
    env: { ...process.env, ONYX_API_URL: apiUrl },
    stdio: "inherit",
  });
  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stop(web);
    stop(api);
    await Promise.all([waitForExit(web, 5_000), waitForExit(api, 5_000)]);
    stop(web, "SIGKILL");
    stop(api, "SIGKILL");
    process.exitCode = exitCode;
  };
  const childFailure = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
    if (shuttingDown) return;
    console.error(`${name} stopped unexpectedly (${signal || code || "unknown"})`);
    void shutdown(code || 1);
  };
  api.once("exit", (code, signal) => childFailure("ONYX API", code, signal));
  web.once("exit", (code, signal) => childFailure("ONYX web console", code, signal));
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  try {
    await Promise.all([
      waitFor(`${apiUrl}/readyz`, "ONYX API"),
      waitFor(webUrl, "ONYX web console"),
    ]);
    console.log(`ONYX stack ready: ${webUrl} (API ${apiUrl})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await shutdown(1);
  }
  return { api, web, shutdown };
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) await runLocalStack();
