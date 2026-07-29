import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { OnyxApplication, type ApiResponse } from "../src/api/application.ts";
import { createMissionCommand, createReportCommand, createTaskCommand, createTimelineCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");

function body(response: ApiResponse): Record<string, any> {
  return response.body as Record<string, any>;
}

describe("OnyxApplication", () => {
  it("exposes health and deterministic not-found responses", async () => {
    const application = new OnyxApplication({now});
    try {
      const health = await application.handle({method: "GET", path: "/healthz"});
      assert.equal(health.status, 200);
      assert.deepEqual(body(health).contexts, ["mission", "work", "timeline", "reporting-evidence"]);

      const missing = await application.handle({method: "GET", path: "/v1/unknown"});
      assert.equal(missing.status, 404);
      assert.equal(body(missing).code, "NOT_FOUND");
      assert.equal((await application.handle({method: "GET", path: "/v1/missions/extra/path"})).status, 404);
    } finally {
      application.close();
    }
  });

  it("executes the four-context HTTP workflow without a network socket", async () => {
    const application = new OnyxApplication({now});
    try {
      const mission = await application.handle({
        method: "POST",
        path: "/v1/mission/commands/CreateMission",
        body: createMissionCommand(),
      });
      const task = await application.handle({
        method: "POST",
        path: "/v1/work/commands/CreateTask",
        body: createTaskCommand(),
      });
      const timeline = await application.handle({
        method: "POST",
        path: "/v1/timeline/commands/CreateTimeline",
        body: createTimelineCommand(),
      });
      const reportBase = createReportCommand();
      const reportCommand = createReportCommand({
        payload: {...reportBase.payload, subject_ref: {aggregate_type: "Timeline", object_id: testId(500)}},
      });
      const report = await application.handle({
        method: "POST",
        path: "/v1/reporting-evidence/commands/CreateReport",
        body: reportCommand,
      });

      assert.deepEqual([mission.status, task.status, timeline.status, report.status], [202, 202, 202, 202]);
      assert.equal(body(report).event_type, "ReportCreated");
      assert.deepEqual(
        await application.handle({method: "POST", path: "/v1/reporting-evidence/commands/CreateReport", body: reportCommand}),
        report,
      );

      const fetched = await application.handle({
        method: "GET",
        path: `/v1/reports/${testId(600)}?organization_id=${testId(13)}`,
      });
      assert.equal(fetched.status, 200);
      assert.equal(body(fetched).subject_ref.aggregate_type, "Timeline");

      const listed = await application.handle({method: "GET", path: `/v1/reports?organization_id=${testId(13)}`});
      assert.equal(body(listed).items.length, 1);
      const history = await application.handle({
        method: "GET",
        path: `/v1/reports/${testId(600)}/history?organization_id=${testId(13)}&after_version=0&limit=10`,
      });
      assert.deepEqual(body(history).items.map((event: Record<string, unknown>) => event.event_type), ["ReportCreated"]);
      assert.equal((await application.handle({
        method: "GET",
        path: `/v1/reports/${testId(600)}?organization_id=${testId(999)}`,
      })).status, 404);
    } finally {
      application.close();
    }
  });

  it("maps route and contract failures to canonical API errors", async () => {
    const application = new OnyxApplication({now});
    try {
      const mismatch = await application.handle({
        method: "POST",
        path: "/v1/mission/commands/PauseMission",
        body: createMissionCommand(),
      });
      assert.equal(mismatch.status, 400);
      assert.equal(body(mismatch).code, "INVALID_ARGUMENT");

      const invalid = await application.handle({
        method: "POST",
        path: "/v1/mission/commands/CreateMission",
        body: {...createMissionCommand(), extension: true},
      });
      assert.equal(invalid.status, 400);
      assert.equal(body(invalid).code, "INVALID_ARGUMENT");
      assert.equal((await application.handle({method: "GET", path: "/v1/missions"})).status, 400);
      assert.equal((await application.handle({
        method: "POST",
        path: "/v1/mission/commands/CreateMission",
        body: createMissionCommand(),
      })).status, 202);
      assert.equal((await application.handle({
        method: "GET",
        path: `/v1/missions/${testId(14)}/history?organization_id=${testId(13)}&limit=0`,
      })).status, 400);
    } finally {
      application.close();
    }
  });

  it("restores API-visible state when a SQLite application is recreated", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-api-sqlite-"));
    const databasePath = join(directory, "onyx.db");
    try {
      const first = new OnyxApplication({databasePath, now});
      assert.equal((await first.handle({
        method: "POST",
        path: "/v1/mission/commands/CreateMission",
        body: createMissionCommand(),
      })).status, 202);
      first.close();

      const second = new OnyxApplication({databasePath, now});
      const restored = await second.handle({
        method: "GET",
        path: `/v1/missions/${testId(14)}?organization_id=${testId(13)}`,
      });
      assert.equal(restored.status, 200);
      assert.equal(body(restored).mission_id, testId(14));
      second.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
