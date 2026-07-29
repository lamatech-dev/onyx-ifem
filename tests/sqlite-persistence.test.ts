import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../src/infrastructure/sqlite/database.ts";
import { MissionService } from "../src/mission/service.ts";
import { SqliteMissionRepository } from "../src/mission/sqlite-repository.ts";
import { ReportingService } from "../src/reporting-evidence/service.ts";
import { SqliteReportingRepository } from "../src/reporting-evidence/sqlite-repository.ts";
import { TimelineService } from "../src/timeline/service.ts";
import { SqliteTimelineRepository } from "../src/timeline/sqlite-repository.ts";
import { WorkService } from "../src/work/service.ts";
import { SqliteWorkRepository } from "../src/work/sqlite-repository.ts";
import { createMissionCommand, createReportCommand, createTaskCommand, createTimelineCommand, missionCommand, testId } from "./fixtures.ts";

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

  it("restores Timelines, history, and idempotency after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-timeline-"));
    const path = join(directory, "onyx.db");
    try {
      const firstDatabase = new SqliteDatabase(path);
      const firstMission = new MissionService({repository: new SqliteMissionRepository(firstDatabase), now});
      await firstMission.execute(createMissionCommand());
      const firstTimeline = new TimelineService({
        repository: new SqliteTimelineRepository(firstDatabase),
        now,
        requireSubject: async (organizationId, subject) => {
          await firstMission.getMission(organizationId, subject.object_id);
        },
      });
      const create = createTimelineCommand();
      const created = await firstTimeline.execute(create);
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const secondMission = new MissionService({repository: new SqliteMissionRepository(secondDatabase), now});
      const secondTimeline = new TimelineService({
        repository: new SqliteTimelineRepository(secondDatabase),
        now,
        requireSubject: async (organizationId, subject) => {
          await secondMission.getMission(organizationId, subject.object_id);
        },
      });
      assert.equal((await secondTimeline.getTimeline(testId(13), testId(500))).timezone, "Asia/Tehran");
      assert.deepEqual((await secondTimeline.getHistory(testId(13), testId(500))).map((event) => event.event_type), ["TimelineCreated"]);
      assert.deepEqual(await secondTimeline.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("restores Reports, history, and idempotency after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-reporting-"));
    const path = join(directory, "onyx.db");
    try {
      const firstDatabase = new SqliteDatabase(path);
      const firstMission = new MissionService({repository: new SqliteMissionRepository(firstDatabase), now});
      await firstMission.execute(createMissionCommand());
      const firstReporting = new ReportingService({
        repository: new SqliteReportingRepository(firstDatabase),
        now,
        requireSubject: async (organizationId, subject) => {
          await firstMission.getMission(organizationId, subject.object_id);
        },
      });
      const create = createReportCommand();
      const created = await firstReporting.execute(create);
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const secondMission = new MissionService({repository: new SqliteMissionRepository(secondDatabase), now});
      const secondReporting = new ReportingService({
        repository: new SqliteReportingRepository(secondDatabase),
        now,
        requireSubject: async (organizationId, subject) => {
          await secondMission.getMission(organizationId, subject.object_id);
        },
      });
      assert.equal((await secondReporting.getReport(testId(13), testId(600))).title, "Mission status report");
      assert.deepEqual((await secondReporting.getHistory(testId(13), testId(600))).map((event) => event.event_type), ["ReportCreated"]);
      assert.deepEqual(await secondReporting.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
