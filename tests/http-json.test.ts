import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { validateJsonRequestHeaders } from "../src/infrastructure/http/json-body.ts";

describe("HTTP JSON media profile", () => {
  it("accepts application/json with an optional UTF-8 charset", () => {
    assert.doesNotThrow(() => validateJsonRequestHeaders({"content-type": "application/json"}));
    assert.doesNotThrow(() => validateJsonRequestHeaders({"content-type": "Application/JSON; Charset=UTF-8"}));
    assert.doesNotThrow(() => validateJsonRequestHeaders({"content-type": 'application/json; charset="utf-8"', "content-encoding": "identity"}));
  });

  it("rejects missing or ambiguous media metadata", () => {
    for (const headers of [
      {},
      {"content-type": "text/plain"},
      {"content-type": "application/problem+json"},
      {"content-type": "application/json; charset=iso-8859-1"},
      {"content-type": "application/json; charset=utf-8; charset=utf-8"},
      {"content-type": "application/json; profile=test"},
      {"content-type": "application/json", "content-encoding": "gzip"},
    ]) {
      assert.throws(
        () => validateJsonRequestHeaders(headers),
        (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT" && error.httpStatus === 400,
      );
    }
  });
});
