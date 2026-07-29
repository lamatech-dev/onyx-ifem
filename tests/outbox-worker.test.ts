import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHttpEventPublisher } from "../src/infrastructure/outbox/http-publisher.ts";
import { OutboxWorker } from "../src/infrastructure/outbox/worker.ts";
import type { OutboxMessage } from "../src/infrastructure/sqlite/database.ts";
import { testId } from "./fixtures.ts";

const empty = {claimed: 0, delivered: 0, retried: 0, deadLettered: 0};

describe("outbox background worker", () => {
  it("does not overlap batches and waits for an active batch during stop", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let active = 0;
    let maximumActive = 0;
    let runs = 0;
    const worker = new OutboxWorker({
      dispatcher: {
        runOnce: async () => {
          runs += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          started.resolve();
          await release.promise;
          active -= 1;
          return empty;
        },
      },
      pollIntervalMs: 10,
    });

    worker.start();
    await started.promise;
    const stopped = worker.stop();
    assert.equal(worker.running, true);
    assert.equal(active, 1);
    release.resolve();
    await stopped;
    assert.equal(worker.running, false);
    assert.equal(maximumActive, 1);
    assert.equal(runs, 1);
  });

  it("continues immediately while work is claimed and rejects duplicate starts", async () => {
    const secondRun = Promise.withResolvers<void>();
    let runs = 0;
    const worker = new OutboxWorker({
      dispatcher: {
        runOnce: async () => {
          runs += 1;
          if (runs === 2) secondRun.resolve();
          return runs === 1 ? {claimed: 1, delivered: 1, retried: 0, deadLettered: 0} : empty;
        },
      },
      pollIntervalMs: 60_000,
    });

    worker.start();
    assert.throws(() => worker.start(), /already running/);
    await secondRun.promise;
    await worker.stop();
    assert.equal(runs, 2);
  });

  it("reports dispatcher failures and retries after the error delay", async () => {
    const recovered = Promise.withResolvers<void>();
    const errors: unknown[] = [];
    let runs = 0;
    const worker = new OutboxWorker({
      dispatcher: {
        runOnce: async () => {
          runs += 1;
          if (runs === 1) throw new Error("database busy");
          recovered.resolve();
          return empty;
        },
      },
      pollIntervalMs: 60_000,
      errorDelayMs: 1,
      onError: (error) => errors.push(error),
    });

    worker.start();
    await recovered.promise;
    await worker.stop();
    assert.equal(runs, 2);
    assert.match(String(errors[0]), /database busy/);
  });
});

describe("HTTPS outbox publisher", () => {
  const message: OutboxMessage = {
    eventId: testId(950),
    context: "mission",
    aggregateId: testId(14),
    aggregateVersion: 3,
    organizationId: testId(13),
    eventType: "MissionActivated",
    event: {event_id: testId(950), event_type: "MissionActivated", payload: {}},
    attemptCount: 1,
    availableAt: "2026-07-29T20:00:00.000Z",
  };

  it("publishes the exact event with idempotency and routing headers", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const publish = createHttpEventPublisher({
      url: "https://events.example.test/onyx",
      bearerToken: "publisher-secret",
      timeoutMs: 2_000,
      fetch: (async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(null, {status: 202});
      }) as typeof fetch,
    });

    await publish(message);
    assert.equal(capturedUrl, "https://events.example.test/onyx");
    assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.redirect, "error");
    assert.equal(capturedInit?.body, JSON.stringify(message.event));
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers["authorization"], "Bearer publisher-secret");
    assert.equal(headers["idempotency-key"], message.eventId);
    assert.equal(headers["x-onyx-aggregate-version"], "3");
  });

  it("rejects failed delivery without exposing credentials", async () => {
    const publish = createHttpEventPublisher({
      url: "https://events.example.test/onyx",
      bearerToken: "must-not-leak",
      fetch: (async () => new Response(null, {status: 503})) as typeof fetch,
    });
    await assert.rejects(publish(message), (error: Error) => {
      assert.match(error.message, /HTTP 503/);
      assert.doesNotMatch(error.message, /must-not-leak/);
      return true;
    });
  });

  it("requires credential-free HTTPS URLs and bounded timeouts", () => {
    assert.throws(() => createHttpEventPublisher({url: "http://events.example.test"}), /must use HTTPS/);
    assert.throws(() => createHttpEventPublisher({url: "https://user:pass@events.example.test"}), /must not contain credentials/);
    assert.throws(() => createHttpEventPublisher({url: "https://events.example.test", timeoutMs: 99}), /timeout/);
  });
});
