import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../src/infrastructure/sqlite/database.ts";
import { MissionService } from "../src/mission/service.ts";
import { SqliteMissionRepository } from "../src/mission/sqlite-repository.ts";
import { WorkService } from "../src/work/service.ts";
import { SqliteWorkRepository } from "../src/work/sqlite-repository.ts";
import { createMissionCommand, createTaskCommand, missionCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");

describe("SQLite persistence", () => {
  it("rolls back the aggregate and operation when an event insert fails", async () => {
    const database = new SqliteDatabase(":memory:");
    const eventId = testId(900);
    database.commit({
      context: "test",
      aggregateId: "aggregate-1",
      organizationId: "organization-1",
      version: 1,
      state: {value: "committed"},
      eventId,
      eventVersion: 1,
      event: {event_id: eventId},
      operationId: "operation-1",
      fingerprint: "fingerprint-1",
      create: true,
    });

    assert.throws(() => database.commit({
      context: "test",
      aggregateId: "aggregate-2",
      organizationId: "organization-1",
      version: 1,
      state: {value: "must-roll-back"},
      eventId,
      eventVersion: 1,
      event: {event_id: eventId},
      operationId: "operation-2",
      fingerprint: "fingerprint-2",
      create: true,
    }));
    assert.equal(database.getState("test", "aggregate-2"), undefined);
    assert.equal(database.getOperation("test", "operation-2"), undefined);
    database.close();
  });

  it("restores Mission state, events, and idempotency after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-mission-"));
    const path = join(directory, "onyx.db");
    try {
      const firstDatabase = new SqliteDatabase(path);
      const firstService = new MissionService({repository: new SqliteMissionRepository(firstDatabase), now});
      const create = createMissionCommand();
      const created = await firstService.execute(create);
      await firstService.execute(missionCommand(
        "CancelMission",
        50,
        {mission_id: testId(14), reason_code: "TEST", reason: "Verify persistence"},
        "mission:cancel",
        1,
      ));
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const secondService = new MissionService({repository: new SqliteMissionRepository(secondDatabase), now});
      assert.equal((await secondService.getMission(testId(13), testId(14))).status, "CANCELLED");
      assert.deepEqual((await secondService.getHistory(testId(13), testId(14))).map((event) => event.aggregate_version), [1, 2]);
      assert.deepEqual(await secondService.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("restores Tasks and preserves the Mission reference across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-work-"));
    const path = join(directory, "onyx.db");
    try {
      const firstDatabase = new SqliteDatabase(path);
      const mission = new MissionService({repository: new SqliteMissionRepository(firstDatabase), now});
      await mission.execute(createMissionCommand());
      const work = new WorkService({
        repository: new SqliteWorkRepository(firstDatabase),
        now,
        requireMission: async (organizationId, missionId) => {
          await mission.getMission(organizationId, missionId);
        },
      });
      const create = createTaskCommand();
      const created = await work.execute(create);
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const restoredMission = new MissionService({repository: new SqliteMissionRepository(secondDatabase), now});
      const restoredWork = new WorkService({
        repository: new SqliteWorkRepository(secondDatabase),
        now,
        requireMission: async (organizationId, missionId) => {
          await restoredMission.getMission(organizationId, missionId);
        },
      });
      assert.equal((await restoredWork.getTask(testId(13), testId(400))).mission_id, testId(14));
      assert.deepEqual(await restoredWork.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
