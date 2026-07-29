import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConcurrencyGate, HttpAdmissionController, TokenBucketRateLimiter, isAdmissionExempt } from "../src/infrastructure/http/admission.ts";
import { OnyxError } from "../src/contracts/errors.ts";

describe("HTTP admission control", () => {
  it("exempts only GET infrastructure probes", () => {
    for (const path of ["/healthz", "/readyz", "/metrics"]) assert.equal(isAdmissionExempt("GET", path), true);
    assert.equal(isAdmissionExempt("POST", "/metrics"), false);
    assert.equal(isAdmissionExempt("GET", "/openapi.json"), false);
    assert.equal(isAdmissionExempt(undefined, "/healthz"), false);
  });

  it("enforces a token-bucket burst and deterministic refill", () => {
    const limiter = new TokenBucketRateLimiter({capacity: 2, refillPerSecond: 1});
    assert.deepEqual(limiter.consume("client-a", 0), {allowed: true, remaining: 1, retryAfterSeconds: 0});
    assert.deepEqual(limiter.consume("client-a", 0), {allowed: true, remaining: 0, retryAfterSeconds: 0});
    assert.deepEqual(limiter.consume("client-a", 0), {allowed: false, remaining: 0, retryAfterSeconds: 1});
    assert.deepEqual(limiter.consume("client-a", 500), {allowed: false, remaining: 0, retryAfterSeconds: 1});
    assert.deepEqual(limiter.consume("client-a", 1_000), {allowed: true, remaining: 0, retryAfterSeconds: 0});
    assert.deepEqual(limiter.consume("client-a", 900), {allowed: false, remaining: 0, retryAfterSeconds: 1});
    assert.deepEqual(limiter.consume("client-a", 1_000), {allowed: false, remaining: 0, retryAfterSeconds: 1});
  });

  it("bounds client memory and shares one overflow bucket", () => {
    const limiter = new TokenBucketRateLimiter({capacity: 1, refillPerSecond: 1, maxClients: 2, idleTtlMs: 1_000});
    assert.equal(limiter.consume("client-a", 0).allowed, true);
    assert.equal(limiter.consume("client-b", 0).allowed, true);
    assert.equal(limiter.trackedClients, 2);
    assert.equal(limiter.consume("client-c", 0).allowed, true);
    assert.equal(limiter.consume("client-d", 0).allowed, false);
    assert.equal(limiter.trackedClients, 2);

    assert.equal(limiter.consume("client-e", 60_001).allowed, true);
    assert.equal(limiter.trackedClients, 1);
  });

  it("releases concurrency exactly once", () => {
    const gate = new ConcurrencyGate(2);
    const first = gate.enter();
    const second = gate.enter();
    assert.ok(first);
    assert.ok(second);
    assert.equal(gate.active, 2);
    assert.equal(gate.enter(), undefined);
    first();
    first();
    assert.equal(gate.active, 1);
    assert.ok(gate.enter());
  });

  it("returns canonical rate-limit and overload decisions", () => {
    const controller = new HttpAdmissionController(
      new TokenBucketRateLimiter({capacity: 2, refillPerSecond: 1}),
      new ConcurrencyGate(1),
    );
    const accepted = controller.admit("client-a", 0);
    assert.equal(accepted.accepted, true);
    const overloaded = controller.admit("client-a", 0);
    assert.deepEqual(overloaded, {
      accepted: false,
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
      retryAfterSeconds: 1,
      remaining: 0,
    });
    const limited = controller.admit("client-a", 0);
    assert.deepEqual(limited, {
      accepted: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 1,
      remaining: 0,
    });
    if (accepted.accepted) accepted.release();
    assert.equal(new OnyxError("RATE_LIMITED", "limited").httpStatus, 429);
    assert.equal(new OnyxError("DEPENDENCY_UNAVAILABLE", "busy").httpStatus, 503);
    assert.equal(new OnyxError("DEADLINE_EXCEEDED", "late").httpStatus, 504);
  });
});
