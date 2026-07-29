import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InboxProcessor } from "../src/infrastructure/inbox/processor.ts";
import { SqliteDatabase } from "../src/infrastructure/sqlite/database.ts";
import { sha256 } from "../src/shared/canonical-json.ts";
import { testId } from "./fixtures.ts";

interface TestEvent {
  event_id: string;
  event_type: string;
  payload: {value: number};
}

const event: TestEvent = {event_id: testId(920), event_type: "TestRecorded", payload: {value: 1}};
const initialTime = new Date("2026-07-29T20:00:00.000Z");

describe("consumer inbox", () => {
  it("processes an event once and permanently deduplicates redelivery", async () => {
    const database = new SqliteDatabase(":memory:");
    let handled = 0;
    const processor = new InboxProcessor<TestEvent>({
      database,
      consumerName: "projection-a",
      workerId: "worker-a",
      now: () => initialTime,
      handle: async () => { handled += 1; },
    });

    assert.equal(await processor.process(event), "processed");
    assert.equal(await processor.process(structuredClone(event)), "duplicate");
    assert.equal(handled, 1);
    const receipt = database.getInboxReceipt("projection-a", event.event_id);
    assert.equal(receipt?.attemptCount, 1);
    assert.equal(receipt?.completedAt, initialTime.toISOString());
    assert.deepEqual(database.readiness(initialTime).inbox, {processing: 0, retryable: 0, completed: 1, failed: 0});
    database.close();
  });

  it("maintains an independent deduplication stream for each consumer", async () => {
    const database = new SqliteDatabase(":memory:");
    const handled: string[] = [];
    const create = (consumerName: string) => new InboxProcessor<TestEvent>({
      database,
      consumerName,
      workerId: `${consumerName}-worker`,
      now: () => initialTime,
      handle: async () => { handled.push(consumerName); },
    });

    assert.equal(await create("projection-a").process(event), "processed");
    assert.equal(await create("projection-b").process(event), "processed");
    assert.deepEqual(handled, ["projection-a", "projection-b"]);
    database.close();
  });

  it("returns busy while another worker owns a live lease", async () => {
    const database = new SqliteDatabase(":memory:");
    let releaseHandler!: () => void;
    const handlerStarted = Promise.withResolvers<void>();
    const handlerRelease = new Promise<void>((resolve) => { releaseHandler = resolve; });
    const first = new InboxProcessor<TestEvent>({
      database,
      consumerName: "projection-a",
      workerId: "worker-a",
      now: () => initialTime,
      leaseDurationMs: 1_000,
      handle: async () => {
        handlerStarted.resolve();
        await handlerRelease;
      },
    });
    const second = new InboxProcessor<TestEvent>({
      database,
      consumerName: "projection-a",
      workerId: "worker-b",
      now: () => initialTime,
      leaseDurationMs: 1_000,
      handle: async () => { throw new Error("must not run"); },
    });

    const processing = first.process(event);
    await handlerStarted.promise;
    assert.equal(await second.process(event), "busy");
    releaseHandler();
    assert.equal(await processing, "processed");
    database.close();
  });

  it("releases failures for retry and records the last error", async () => {
    const database = new SqliteDatabase(":memory:");
    let shouldFail = true;
    const processor = new InboxProcessor<TestEvent>({
      database,
      consumerName: "projection-a",
      workerId: "worker-a",
      now: () => initialTime,
      handle: async () => {
        if (shouldFail) throw new Error("projection unavailable");
      },
    });

    await assert.rejects(processor.process(event), /projection unavailable/);
    assert.equal(database.getInboxReceipt("projection-a", event.event_id)?.lastError, "Error: projection unavailable");
    shouldFail = false;
    assert.equal(await processor.process(event), "processed");
    assert.equal(database.getInboxReceipt("projection-a", event.event_id)?.attemptCount, 2);
    database.close();
  });

  it("recovers an expired lease and rejects event-id content changes", async () => {
    const database = new SqliteDatabase(":memory:");
    let clock = initialTime;
    database.claimInbox({
      consumerName: "projection-a",
      eventId: event.event_id,
      fingerprint: sha256(event),
      workerId: "crashed-worker",
      now: clock,
      leaseDurationMs: 1_000,
    });
    const processor = new InboxProcessor<TestEvent>({
      database,
      consumerName: "projection-a",
      workerId: "recovery-worker",
      now: () => clock,
      leaseDurationMs: 1_000,
      handle: async () => undefined,
    });

    assert.equal(await processor.process(event), "busy");
    clock = new Date(clock.getTime() + 1_001);
    assert.equal(await processor.process(event), "processed");
    assert.throws(
      () => database.completeInbox("projection-a", event.event_id, "crashed-worker", clock),
      /not leased by this worker/,
    );
    await assert.rejects(
      processor.process({...event, payload: {value: 2}}),
      /fingerprint mismatch/,
    );
    database.close();
  });
});
