import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";
import { TextDecoder } from "node:util";

const MAX_JWKS_BYTES = 1_048_576;
const MAX_KEYS = 32;
const KEY_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const utf8 = new TextDecoder("utf-8", {fatal: true});

export function parseEd25519Jwks(input: string | Buffer): ReadonlyMap<string, KeyObject> {
  const encoded = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  if (encoded.byteLength === 0 || encoded.byteLength > MAX_JWKS_BYTES) throw new Error("JWKS must contain from 1 byte through 1 MiB");

  let document: unknown;
  try {
    document = JSON.parse(utf8.decode(encoded));
  } catch {
    throw new Error("JWKS must be valid JSON");
  }
  if (!isRecord(document) || !Array.isArray(document.keys)) throw new Error("JWKS must be an object containing a keys array");
  if (document.keys.length < 1 || document.keys.length > MAX_KEYS) throw new Error(`JWKS must contain from 1 through ${MAX_KEYS} keys`);

  const result = new Map<string, KeyObject>();
  for (const candidate of document.keys) {
    if (!isRecord(candidate)) throw new Error("each JWKS key must be an object");
    if (candidate.kty !== "OKP" || candidate.crv !== "Ed25519") throw new Error("every JWKS key must be an Ed25519 OKP key");
    if (candidate.alg !== undefined && candidate.alg !== "EdDSA") throw new Error("JWKS key alg must be EdDSA when present");
    if (candidate.use !== undefined && candidate.use !== "sig") throw new Error("JWKS key use must be sig when present");
    if (candidate.key_ops !== undefined && (!Array.isArray(candidate.key_ops) || candidate.key_ops.length !== 1 || candidate.key_ops[0] !== "verify")) {
      throw new Error("JWKS key_ops must contain only verify when present");
    }
    if (candidate.d !== undefined) throw new Error("JWKS must not contain private key material");
    if (typeof candidate.kid !== "string" || !KEY_ID.test(candidate.kid)) throw new Error("JWKS key kid must contain 1 through 128 safe characters");
    if (result.has(candidate.kid)) throw new Error(`JWKS contains duplicate kid: ${candidate.kid}`);
    if (typeof candidate.x !== "string" || !canonicalEd25519Coordinate(candidate.x)) throw new Error(`JWKS key ${candidate.kid} has an invalid public coordinate`);

    let key: KeyObject;
    try {
      key = createPublicKey({key: candidate as JsonWebKey, format: "jwk"});
    } catch {
      throw new Error(`JWKS key ${candidate.kid} is not a valid Ed25519 public key`);
    }
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error(`JWKS key ${candidate.kid} is not Ed25519`);
    result.set(candidate.kid, key);
  }
  return result;
}

function canonicalEd25519Coordinate(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === 32 && decoded.toString("base64url") === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
