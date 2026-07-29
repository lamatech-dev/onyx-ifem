import { readFileSync } from "node:fs";
import { parseEd25519Jwks } from "./jwks.ts";
import type { JwtVerifierOptions } from "./jwt.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type ReadFile = (path: string) => Buffer;

export function loadAuthenticationOptions(
  environment: Environment,
  readFile: ReadFile = (path) => readFileSync(path),
): JwtVerifierOptions | undefined {
  const mode = environment.ONYX_AUTH_MODE ?? "disabled";
  if (mode !== "disabled" && mode !== "required") throw new Error("ONYX_AUTH_MODE must be disabled or required");
  if (mode === "disabled") return undefined;

  const publicKeyPath = environment.ONYX_AUTH_PUBLIC_KEY_PATH;
  const jwksPath = environment.ONYX_AUTH_JWKS_PATH;
  if ((publicKeyPath ? 1 : 0) + (jwksPath ? 1 : 0) !== 1) {
    throw new Error("exactly one of ONYX_AUTH_PUBLIC_KEY_PATH or ONYX_AUTH_JWKS_PATH is required when ONYX_AUTH_MODE=required");
  }
  const common = {
    issuer: required(environment, "ONYX_AUTH_ISSUER"),
    audience: required(environment, "ONYX_AUTH_AUDIENCE"),
  };
  return jwksPath
    ? {...common, publicKeys: parseEd25519Jwks(readFile(jwksPath))}
    : {...common, publicKey: readFile(publicKeyPath!)};
}

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required when ONYX_AUTH_MODE=required`);
  return value;
}
