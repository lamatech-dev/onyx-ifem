import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { OnyxApplication, type ApiResponse } from "../src/api/application.ts";
import { signAccessToken, type AccessTokenClaims } from "../src/auth/jwt.ts";
import { createMissionCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");
const issuer = "https://identity.onyx.local";
const audience = "onyx-ifem-api";
const keyPair = generateKeyPairSync("ed25519");

function claims(overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims {
  return {
    iss: issuer,
    aud: audience,
    sub: testId(15),
    org: testId(13),
    actor_type: "USER",
    scope: ["mission:create", "mission:read"],
    exp: Date.parse("2030-01-01T00:00:00.000Z") / 1_000,
    iat: Date.parse("2026-07-29T20:00:00.000Z") / 1_000,
    authority_epoch: 0,
    jti: "proof:test",
    ...overrides,
  };
}

function application(): OnyxApplication {
  return new OnyxApplication({
    now,
    auth: {publicKey: keyPair.publicKey, issuer, audience, clockToleranceSeconds: 0},
  });
}

function authorization(tokenClaims: AccessTokenClaims = claims()): Readonly<Record<string, string>> {
  return {authorization: `Bearer ${signAccessToken(keyPair.privateKey, tokenClaims)}`};
}

function responseBody(response: ApiResponse): Record<string, any> {
  return response.body as Record<string, any>;
}

describe("Ed25519 bearer authentication", () => {
  it("keeps health and OpenAPI public while protecting commands and queries", async () => {
    const app = application();
    try {
      assert.equal((await app.handle({method: "GET", path: "/healthz"})).status, 200);
      assert.equal((await app.handle({method: "GET", path: "/readyz"})).status, 200);
      assert.equal((await app.handle({method: "GET", path: "/openapi.json"})).status, 200);
      assert.equal((await app.handle({method: "GET", path: "/metrics"})).status, 200);

      const command = await app.handle({method: "POST", path: "/v1/mission/commands/CreateMission", body: createMissionCommand()});
      assert.equal(command.status, 401);
      assert.equal(responseBody(command).code, "AUTHENTICATION_REQUIRED");
      assert.equal(command.headers?.["www-authenticate"], "Bearer");
      assert.equal((await app.handle({method: "GET", path: `/v1/missions?organization_id=${testId(13)}`})).status, 401);
    } finally {
      app.close();
    }
  });

  it("authenticates a bound command and authorizes its read query", async () => {
    const app = application();
    const headers = authorization();
    try {
      const created = await app.handle({
        method: "POST", path: "/v1/mission/commands/CreateMission", body: createMissionCommand(), headers,
      });
      assert.equal(created.status, 202);
      const fetched = await app.handle({
        method: "GET", path: `/v1/missions/${testId(14)}?organization_id=${testId(13)}`, headers,
      });
      assert.equal(fetched.status, 200);
      assert.equal(responseBody(fetched).mission_id, testId(14));
    } finally {
      app.close();
    }
  });

  it("rejects forged, expired, wrong-issuer, and wrong-audience tokens", async () => {
    const app = application();
    const otherKey = generateKeyPairSync("ed25519");
    const valid = signAccessToken(keyPair.privateKey, claims());
    const [, payload, signature] = valid.split(".") as [string, string, string];
    const disallowedHeader = Buffer.from(JSON.stringify({alg: "none", typ: "onyx-access+jwt"})).toString("base64url");
    const tokens = [
      signAccessToken(otherKey.privateKey, claims()),
      signAccessToken(keyPair.privateKey, claims({exp: Date.parse("2020-01-01T00:00:00.000Z") / 1_000})),
      signAccessToken(keyPair.privateKey, claims({iss: "https://attacker.invalid"})),
      signAccessToken(keyPair.privateKey, claims({aud: "another-api"})),
      `${disallowedHeader}.${payload}.${signature}`,
      signAccessToken(keyPair.privateKey, {...claims(), extension: true} as unknown as AccessTokenClaims),
    ];
    try {
      for (const token of tokens) {
        const response = await app.handle({
          method: "POST",
          path: "/v1/mission/commands/CreateMission",
          body: createMissionCommand(),
          headers: {authorization: `Bearer ${token}`},
        });
        assert.equal(response.status, 401);
        assert.equal(responseBody(response).code, "AUTHENTICATION_REQUIRED");
      }
    } finally {
      app.close();
    }
  });

  it("binds organization, actor, authority epoch, proof reference, scope, and expiry", async () => {
    const cases: AccessTokenClaims[] = [
      claims({org: testId(999)}),
      claims({sub: testId(999)}),
      claims({authority_epoch: 1}),
      claims({jti: "another-proof"}),
      claims({scope: ["mission:read"]}),
      claims({exp: Date.parse("2027-01-01T00:00:00.000Z") / 1_000}),
    ];
    for (const tokenClaims of cases) {
      const app = application();
      try {
        const response = await app.handle({
          method: "POST",
          path: "/v1/mission/commands/CreateMission",
          body: createMissionCommand(),
          headers: authorization(tokenClaims),
        });
        assert.equal(response.status, 403);
      } finally {
        app.close();
      }
    }
  });

  it("requires context read scope and matching query organization", async () => {
    const app = application();
    try {
      const createHeaders = authorization();
      assert.equal((await app.handle({
        method: "POST", path: "/v1/mission/commands/CreateMission", body: createMissionCommand(), headers: createHeaders,
      })).status, 202);
      const noRead = authorization(claims({scope: ["mission:create"]}));
      assert.equal((await app.handle({
        method: "GET", path: `/v1/missions?organization_id=${testId(13)}`, headers: noRead,
      })).status, 403);
      assert.equal((await app.handle({
        method: "GET", path: `/v1/missions?organization_id=${testId(999)}`, headers: createHeaders,
      })).status, 403);
    } finally {
      app.close();
    }
  });
});
