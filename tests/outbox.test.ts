import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { OutboxDispatcher } from "../src/infrastructure/outbox/dispatcher.ts";
import { SqliteDatabase } from "../src/infrastructure/sqlite/database.ts";
import { MissionService } from "../src/mission/service.ts";
import { SqliteMissionRepository } from "../src/mission/sqlite-repository.ts";
import type { MissionEvent } from "../src/mission/types.ts";
import { createMissionCommand, missionCommand, testId } from "./fixtures.ts";

const eventTime = () => new Date("2026-07-29T20:00:01.000Z");
const dispatchTime = new Date("2026-07-29T20:00:02.000Z");

describe("transactional outbox", () => {
  it("stores the event in the outbox in the same command transaction", async () => {
    const database = new SqliteDatabase(":memory:");
    const service = new MissionService({repository: new SqliteMissionRepository(database), now: eventTime});
    const command = createMissionCommand();
    const event = await service.execute(command);

    const message = database.getOutboxMessage<MissionEvent>(event.event_id);
    assert.equal(message?.context, "mission");
    assert.equal(message?.organizationId, command.organization_id);
    assert.equal(message?.aggregateId, command.payload.mission_id);
    assert.equal(message?.eventType, "MissionCreated");
    assert.deepEqual(message?.event, event);
    assert.equal(message?.attemptCount, 0);

    assert.deepEqual(await service.execute(command), event);
    assert.equal(database.claimOutbox({workerId: "worker-a", now: dispatchTime, leaseDurationMs: 30_000, limit: 100}).length, 1);
    database.close();
  });

  it("rolls the outbox back when any command commit statement fails", () => {
    const database = new SqliteDatabase(":memory:");
    const eventId = testId(910);
    const base = {
      context: "test",
      organizationId: "organization-1",
      version: 1,
      eventId,
      eventVersion: 1,
      event: {event_id: eventId, event_type: "TestRecorded", recorded_at: eventTime().toISOString()},
      fingerprint: "fingerprint-1",
      create: true,
    };
    database.commit({...base, aggregateId: "aggregate-1", state: {value: 1}, operationId: "operation-1"});
    assert.throws(() => database.commit({
      ...base,
      aggregateId: "aggregate-2",
      state: {value: 2},
      operationId: "operation-2",
    }));

    const claimed = database.claimOutbox({workerId: "worker-a", now: dispatchTime, leaseDurationMs: 30_000, limit: 100});
    assert.deepEqual(claimed.map((message) => message.aggregateId), ["aggregate-1"]);
    assert.equal(database.getState("test", "aggregate-2"), undefined);
    database.close();
  });

  it("uses exclusive leases and recovers messages after lease expiry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-outbox-lease-"));
    const path = join(directory, "onyx.db");
    try {
      const first = new SqliteDatabase(path);
      const service = new MissionService({repository: new SqliteMissionRepository(first), now: eventTime});
      const event = await service.execute(createMissionCommand());
      const second = new SqliteDatabase(path);

      const firstClaim = first.claimOutbox<MissionEvent>({workerId: "worker-a", now: dispatchTime, leaseDurationMs: 1_000, limit: 1});
      assert.equal(firstClaim[0]?.attemptCount, 1);
      assert.deepEqual(second.claimOutbox({workerId: "worker-b", now: dispatchTime, leaseDurationMs: 1_000, limit: 1}), []);

      const recovered = second.claimOutbox<MissionEvent>({
        workerId: "worker-b",
        now: new Date(dispatchTime.getTime() + 1_001),
        leaseDurationMs: 1_000,
        limit: 1,
      });
      assert.equal(recovered[0]?.eventId, event.event_id);
      assert.equal(recovered[0]?.attemptCount, 2);
      assert.throws(() => first.acknowledgeOutbox(event.event_id, "worker-a", dispatchTime));
      second.acknowledgeOutbox(event.event_id, "worker-b", new Date(dispatchTime.getTime() + 1_002));
      assert.ok(second.getOutboxMessage(event.event_id)?.deliveredAt);
      assert.deepEqual(second.claimOutbox({workerId: "worker-c", now: new Date("2030-01-01"), leaseDurationMs: 1_000, limit: 1}), []);

      second.close();
      first.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("retries with backoff and dead-letters a poison message", async () => {
    const database = new SqliteDatabase(":memory:");
    const service = new MissionService({repository: new SqliteMissionRepository(database), now: eventTime});
    const event = await service.execute(createMissionCommand());
    let clock = dispatchTime;
    const dispatcher = new OutboxDispatcher({
      database,
      workerId: "worker-a",
      now: () => clock,
      maxAttempts: 2,
      retryDelayMs: () => 1_000,
      publish: async () => { throw new Error("broker unavailable"); },
    });

    assert.deepEqual(await dispatcher.runOnce(), {claimed: 1, delivered: 0, retried: 1, deadLettered: 0});
    assert.equal(database.getOutboxMessage(event.event_id)?.lastError, "Error: broker unavailable");
    assert.deepEqual(await dispatcher.runOnce(), {claimed: 0, delivered: 0, retried: 0, deadLettered: 0});

    clock = new Date(clock.getTime() + 1_000);
    assert.deepEqual(await dispatcher.runOnce(), {claimed: 1, delivered: 0, retried: 0, deadLettered: 1});
    const poisoned = database.getOutboxMessage(event.event_id);
    assert.equal(poisoned?.attemptCount, 2);
    assert.equal(poisoned?.deadLetteredAt, clock.toISOString());
    database.close();
  });

  it("delivers each pending event and acknowledges successful publication", async () => {
    const database = new SqliteDatabase(":memory:");
    const service = new MissionService({repository: new SqliteMissionRepository(database), now: eventTime});
    const first = await service.execute(createMissionCommand());
    const second = await service.execute(missionCommand(
      "CancelMission",
      80,
      {mission_id: testId(14), reason_code: "TEST", reason: "Verify delivery"},
      "mission:cancel",
      1,
    ));
    const published: string[] = [];
    const dispatcher = new OutboxDispatcher<MissionEvent>({
      database,
      workerId: "worker-a",
      now: () => dispatchTime,
      publish: async (message) => { published.push(message.eventId); },
    });

    assert.deepEqual(await dispatcher.runOnce(), {claimed: 2, delivered: 2, retried: 0, deadLettered: 0});
    assert.deepEqual(published, [first.event_id, second.event_id]);
    assert.deepEqual(await dispatcher.runOnce(), {claimed: 0, delivered: 0, retried: 0, deadLettered: 0});
    database.close();
  });
});
