import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeResponseBody } from "../src/mission/server.ts";

describe("HTTP response serialization", () => {
  it("serves metrics text without JSON quoting and still serializes API bodies", () => {
    const metrics = "# HELP onyx_process_uptime_seconds Process uptime.\nonyx_process_uptime_seconds 42\n";
    assert.equal(serializeResponseBody(metrics), metrics);
    assert.equal(serializeResponseBody({status: "ok"}), '{"status":"ok"}');
  });
});
