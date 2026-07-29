import assert from "node:assert/strict";
import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { describe, it } from "node:test";
import { loadAuthenticationOptions } from "../src/auth/config.ts";
import { parseEd25519Jwks } from "../src/auth/jwks.ts";
import { JwtVerifier, signAccessToken, type AccessTokenClaims } from "../src/auth/jwt.ts";
import { testId } from "./fixtures.ts";

const issuer = "https://identity.onyx.local";
const audience = "onyx-ifem-api";
const now = () => new Date("2026-07-30T00:00:00.000Z");

function claims(): AccessTokenClaims {
  return {
    iss: issuer,
    aud: audience,
    sub: testId(15),
    org: testId(13),
    actor_type: "SERVICE",
    scope: ["mission:read"],
    exp: Date.parse("2026-07-30T01:00:00.000Z") / 1_000,
    authority_epoch: 2,
    jti: "rotation-proof",
  };
}

function publicJwk(keyPair: ReturnType<typeof generateKeyPairSync>, kid: string): JsonWebKey {
  return {...keyPair.publicKey.export({format: "jwk"}), kid, alg: "EdDSA", use: "sig", key_ops: ["verify"]};
}

describe("static Ed25519 JWKS", () => {
  it("loads exactly one configured authentication source", () => {
    const keyPair = generateKeyPairSync("ed25519");
    const jwks = Buffer.from(JSON.stringify({keys: [publicJwk(keyPair, "current")]}));
    const common = {ONYX_AUTH_MODE: "required", ONYX_AUTH_ISSUER: issuer, ONYX_AUTH_AUDIENCE: audience};
    const loaded = loadAuthenticationOptions({...common, ONYX_AUTH_JWKS_PATH: "/keys/jwks.json"}, (path) => {
      assert.equal(path, "/keys/jwks.json");
      return jwks;
    });

    assert.equal(loaded?.issuer, issuer);
    assert.ok(loaded && "publicKeys" in loaded && loaded.publicKeys?.has("current"));
    assert.throws(() => loadAuthenticationOptions(common), /exactly one/);
    assert.throws(() => loadAuthenticationOptions({...common, ONYX_AUTH_PUBLIC_KEY_PATH: "/key.pem", ONYX_AUTH_JWKS_PATH: "/jwks.json"}), /exactly one/);
    assert.throws(() => loadAuthenticationOptions({ONYX_AUTH_MODE: "unknown"}), /disabled or required/);
    assert.equal(loadAuthenticationOptions({}), undefined);
  });

  it("accepts overlapping rotation keys selected by kid", () => {
    const retiring = generateKeyPairSync("ed25519");
    const current = generateKeyPairSync("ed25519");
    const publicKeys = parseEd25519Jwks(JSON.stringify({keys: [
      publicJwk(retiring, "2026-07-retiring"),
      publicJwk(current, "2026-08-current"),
    ]}));
    const verifier = new JwtVerifier({publicKeys, issuer, audience, now, clockToleranceSeconds: 0});

    assert.equal(verifier.authenticate(`Bearer ${signAccessToken(retiring.privateKey, claims(), "2026-07-retiring")}`).jti, "rotation-proof");
    assert.equal(verifier.authenticate(`Bearer ${signAccessToken(current.privateKey, claims(), "2026-08-current")}`).jti, "rotation-proof");
  });

  it("rejects missing, unknown, and single-key kid values", () => {
    const configured = generateKeyPairSync("ed25519");
    const publicKeys = parseEd25519Jwks(JSON.stringify({keys: [publicJwk(configured, "current")]}));
    const ring = new JwtVerifier({publicKeys, issuer, audience, now, clockToleranceSeconds: 0});
    const single = new JwtVerifier({publicKey: configured.publicKey, issuer, audience, now, clockToleranceSeconds: 0});

    assert.throws(() => ring.authenticate(`Bearer ${signAccessToken(configured.privateKey, claims())}`), /kid is required/);
    assert.throws(() => ring.authenticate(`Bearer ${signAccessToken(configured.privateKey, claims(), "unknown")}`), /kid is unknown/);
    assert.throws(() => single.authenticate(`Bearer ${signAccessToken(configured.privateKey, claims(), "current")}`), /kid is not allowed/);
  });

  it("rejects private material, duplicate IDs, incompatible keys, and oversized rings", () => {
    const ed25519 = generateKeyPairSync("ed25519");
    const privateJwk = {...ed25519.privateKey.export({format: "jwk"}), kid: "private"};
    const valid = publicJwk(ed25519, "duplicate");

    assert.throws(() => parseEd25519Jwks(JSON.stringify({keys: [privateJwk]})), /private key material/);
    assert.throws(() => parseEd25519Jwks(JSON.stringify({keys: [valid, valid]})), /duplicate kid/);
    assert.throws(() => parseEd25519Jwks(JSON.stringify({keys: [{...valid, crv: "X25519"}]})), /Ed25519 OKP/);
    assert.throws(() => parseEd25519Jwks(JSON.stringify({keys: [{...valid, key_ops: ["verify", "sign"]}]})), /only verify/);
    assert.throws(() => parseEd25519Jwks(JSON.stringify({keys: Array.from({length: 33}, (_, index) => ({...valid, kid: `key-${index}`}))})), /1 through 32/);
    assert.throws(() => parseEd25519Jwks(Buffer.from([0xff])), /valid JSON/);
  });
});
