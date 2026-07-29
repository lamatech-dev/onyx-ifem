import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptsJsonBody, allowedMethodsForPath } from "../src/api/routes.ts";

describe("HTTP route policy", () => {
  it("describes supported methods for every known route shape", () => {
    assert.deepEqual(allowedMethodsForPath("/healthz"), ["GET", "HEAD"]);
    assert.deepEqual(allowedMethodsForPath("/v1/missions"), ["GET", "HEAD"]);
    assert.deepEqual(allowedMethodsForPath("/v1/missions/mission-1"), ["GET", "HEAD"]);
    assert.deepEqual(allowedMethodsForPath("/v1/missions/mission-1/history"), ["GET", "HEAD"]);
    assert.deepEqual(allowedMethodsForPath("/v1/mission/commands/CreateMission"), ["POST"]);
  });

  it("only enables JSON parsing for known command routes", () => {
    assert.equal(acceptsJsonBody("POST", "/v1/mission/commands/CreateMission"), true);
    assert.equal(acceptsJsonBody("GET", "/v1/mission/commands/CreateMission"), false);
    assert.equal(acceptsJsonBody("POST", "/healthz"), false);
    assert.equal(acceptsJsonBody("POST", "/v1/unknown/commands/Anything"), false);
    assert.equal(allowedMethodsForPath("/v1/unknown/commands/Anything"), undefined);
    assert.equal(allowedMethodsForPath("/v1/missions/extra/path"), undefined);
  });
});
