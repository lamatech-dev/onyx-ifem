import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from "node:crypto";
import { TextDecoder } from "node:util";
import { OnyxError } from "../contracts/errors.ts";
import type { ActorContext, UuidV7 } from "../contracts/envelopes.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_TYPE = "onyx-access+jwt";
const HEADER_KEYS = new Set(["alg", "typ"]);
const CLAIM_KEYS = new Set(["iss", "aud", "sub", "org", "actor_type", "scope", "exp", "nbf", "iat", "authority_epoch", "jti"]);
const ACTOR_TYPES = new Set<ActorContext["actor_type"]>(["USER", "SERVICE", "DEVICE"]);
const utf8 = new TextDecoder("utf-8", {fatal: true});

export interface AccessTokenClaims {
  iss: string;
  aud: string | string[];
  sub: UuidV7;
  org: UuidV7;
  actor_type: ActorContext["actor_type"];
  scope: string[];
  exp: number;
  nbf?: number;
  iat?: number;
  authority_epoch: number;
  jti: string;
}

export interface JwtVerifierOptions {
  publicKey: string | Buffer | KeyObject;
  issuer: string;
  audience: string;
  now?: () => Date;
  clockToleranceSeconds?: number;
}

export class JwtVerifier {
  readonly #publicKey: KeyObject;
  readonly #issuer: string;
  readonly #audience: string;
  readonly #now: () => Date;
  readonly #clockToleranceSeconds: number;

  constructor(options: JwtVerifierOptions) {
    if (!options.issuer) throw new Error("JWT issuer must not be empty");
    if (!options.audience) throw new Error("JWT audience must not be empty");
    this.#publicKey = options.publicKey instanceof KeyObject ? options.publicKey : createPublicKey(options.publicKey);
    if (this.#publicKey.type !== "public" || this.#publicKey.asymmetricKeyType !== "ed25519") {
      throw new Error("JWT verification key must be an Ed25519 public key");
    }
    this.#issuer = options.issuer;
    this.#audience = options.audience;
    this.#now = options.now ?? (() => new Date());
    this.#clockToleranceSeconds = options.clockToleranceSeconds ?? 30;
    if (!Number.isInteger(this.#clockToleranceSeconds) || this.#clockToleranceSeconds < 0 || this.#clockToleranceSeconds > 300) {
      throw new Error("JWT clock tolerance must be an integer from 0 to 300 seconds");
    }
  }

  authenticate(authorization: string | undefined): AccessTokenClaims {
    if (!authorization?.startsWith("Bearer ")) this.#reject("bearer token is required");
    const token = authorization.slice("Bearer ".length);
    if (token.length === 0 || token.length > 8_192) this.#reject("bearer token size is invalid");
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) this.#reject("bearer token is malformed");
    const [encodedHeader, encodedClaims, encodedSignature] = segments as [string, string, string];
    const header = this.#json(encodedHeader, "header");
    this.#exactKeys(header, HEADER_KEYS, "header");
    if (header.alg !== "EdDSA" || header.typ !== TOKEN_TYPE) this.#reject("bearer token algorithm or type is not allowed");

    const signingInput = Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii");
    const signature = this.#base64url(encodedSignature, "signature");
    let signatureValid = false;
    try {
      signatureValid = verify(null, signingInput, this.#publicKey, signature);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) this.#reject("bearer token signature is invalid");

    const claims = this.#json(encodedClaims, "claims");
    this.#exactKeys(claims, CLAIM_KEYS, "claims");
    this.#validateClaims(claims);
    return structuredClone(claims) as unknown as AccessTokenClaims;
  }

  #validateClaims(claims: Record<string, unknown>): void {
    if (claims.iss !== this.#issuer) this.#reject("bearer token issuer is invalid");
    const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    if (!Array.isArray(audiences) || audiences.some((audience) => typeof audience !== "string") || !audiences.includes(this.#audience)) {
      this.#reject("bearer token audience is invalid");
    }
    for (const field of ["sub", "org"] as const) {
      if (typeof claims[field] !== "string" || !UUID_V7.test(claims[field])) this.#reject(`bearer token ${field} is invalid`);
    }
    if (!ACTOR_TYPES.has(claims.actor_type as ActorContext["actor_type"])) this.#reject("bearer token actor_type is invalid");
    if (!Array.isArray(claims.scope) || claims.scope.length === 0 || claims.scope.some((scope) => typeof scope !== "string" || scope.length === 0)) {
      this.#reject("bearer token scope is invalid");
    }
    if (new Set(claims.scope).size !== claims.scope.length) this.#reject("bearer token scopes must be unique");
    if (!Number.isInteger(claims.authority_epoch) || (claims.authority_epoch as number) < 0) this.#reject("bearer token authority_epoch is invalid");
    if (typeof claims.jti !== "string" || claims.jti.length === 0 || claims.jti.length > 512) this.#reject("bearer token jti is invalid");
    for (const field of ["exp", "nbf", "iat"] as const) {
      if (claims[field] !== undefined && (!Number.isInteger(claims[field]) || (claims[field] as number) < 0)) this.#reject(`bearer token ${field} is invalid`);
    }
    if (claims.exp === undefined) this.#reject("bearer token exp is required");
    const now = Math.floor(this.#now().getTime() / 1_000);
    if ((claims.exp as number) <= now - this.#clockToleranceSeconds) this.#reject("bearer token is expired");
    if (typeof claims.nbf === "number" && claims.nbf > now + this.#clockToleranceSeconds) this.#reject("bearer token is not active");
    if (typeof claims.iat === "number" && claims.iat > now + this.#clockToleranceSeconds) this.#reject("bearer token issued-at time is in the future");
  }

  #json(segment: string, field: string): Record<string, unknown> {
    const decoded = this.#base64url(segment, field);
    try {
      const value = JSON.parse(utf8.decode(decoded)) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) this.#reject(`bearer token ${field} must be an object`);
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof OnyxError) throw error;
      return this.#reject(`bearer token ${field} is not valid JSON`);
    }
  }

  #base64url(value: string, field: string): Buffer {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) this.#reject(`bearer token ${field} is not canonical base64url`);
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) this.#reject(`bearer token ${field} is not canonical base64url`);
    return decoded;
  }

  #exactKeys(value: Record<string, unknown>, keys: Set<string>, field: string): void {
    if (Object.keys(value).some((key) => !keys.has(key))) this.#reject(`bearer token ${field} contains unsupported fields`);
  }

  #reject(message: string): never {
    throw new OnyxError("AUTHENTICATION_REQUIRED", message);
  }
}

export function signAccessToken(privateKey: string | Buffer | KeyObject, claims: AccessTokenClaims): string {
  const key = privateKey instanceof KeyObject ? privateKey : createPrivateKey(privateKey);
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("JWT signing key must be an Ed25519 private key");
  const header = Buffer.from(JSON.stringify({alg: "EdDSA", typ: TOKEN_TYPE}), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${payload}`, "ascii"), key).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
