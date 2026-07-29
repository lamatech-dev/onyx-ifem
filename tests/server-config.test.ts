import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { server } from "../src/mission/server.ts";

describe("HTTP server resilience defaults", () => {
  it("sets bounded receive, header, socket, keep-alive, and reuse limits", () => {
    assert.equal(server.requestTimeout, 15_000);
    assert.equal(server.headersTimeout, 5_000);
    assert.equal(server.keepAliveTimeout, 5_000);
    assert.equal(server.timeout, 30_000);
    assert.equal(server.maxHeadersCount, 100);
    assert.equal(server.maxRequestsPerSocket, 1_000);
  });
});
