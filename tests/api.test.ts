import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { OnyxApplication, type ApiResponse } from "../src/api/application.ts";
import type { RequestLogRecord } from "../src/infrastructure/observability/logger.ts";
import { contextLinkCommand, createMissionCommand, createReportCommand, createTaskCommand, createTimelineCommand, identityCommand, organizationCommand, testId } from "./fixtures.ts";

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
      assert.deepEqual(body(health).contexts, ["mission", "work", "timeline", "reporting-evidence", "organization", "identity-authority", "context"]);

      const head = await application.handle({method: "HEAD", path: "/healthz"});
      assert.equal(head.status, 200);
      assert.deepEqual(head.body, health.body);

      const wrongHealthMethod = await application.handle({method: "POST", path: "/healthz"});
      assert.equal(wrongHealthMethod.status, 405);
      assert.equal(wrongHealthMethod.headers?.allow, "GET, HEAD");
      assert.equal(body(wrongHealthMethod).code, "INVALID_ARGUMENT");

      const wrongReadMethod = await application.handle({method: "DELETE", path: "/v1/missions"});
      assert.equal(wrongReadMethod.status, 405);
      assert.equal(wrongReadMethod.headers?.allow, "GET, HEAD");

      const wrongCommandMethod = await application.handle({method: "GET", path: "/v1/mission/commands/CreateMission"});
      assert.equal(wrongCommandMethod.status, 405);
      assert.equal(wrongCommandMethod.headers?.allow, "POST");

      const unknownCommandContext = await application.handle({method: "POST", path: "/v1/unknown/commands/Anything"});
      assert.equal(unknownCommandContext.status, 404);

      const openapi = await application.handle({method: "GET", path: "/openapi.json"});
      assert.equal(openapi.status, 200);
      assert.equal(body(openapi).openapi, "3.1.2");
      assert.equal(Object.keys(body(openapi).paths as object).length, 86);
      body(openapi).info.title = "mutated by caller";
      const freshOpenApi = await application.handle({method: "GET", path: "/openapi.json"});
      assert.equal(body(freshOpenApi).info.title, "ONYX IFEM API");

      const metrics = await application.handle({method: "GET", path: "/metrics"});
      assert.equal(metrics.status, 200);
      assert.equal(metrics.headers?.["content-type"], "text/plain; version=0.0.4; charset=utf-8");
      assert.match(String(metrics.body), /onyx_persistence_durable 0/);

      const missing = await application.handle({method: "GET", path: "/v1/unknown"});
      assert.equal(missing.status, 404);
      assert.equal(body(missing).code, "NOT_FOUND");
      assert.equal((await application.handle({method: "GET", path: "/v1/missions/extra/path"})).status, 404);
    } finally {
      application.close();
    }
  });

  it("executes the seven-context HTTP workflow without a network socket", async () => {
    const application = new OnyxApplication({now});
    try {
      const organization = await application.handle({
        method: "POST",
        path: "/v1/organization/commands/CreateOrganization",
        body: organizationCommand("CreateOrganization", 740, "Organization", testId(13), {organization_id: testId(13), name: "ONYX Labs", slug: "onyx-labs"}, "organization:create", 0),
      });
      const userId = testId(800);
      const user = await application.handle({method: "POST", path: "/v1/identity-authority/commands/CreateUser", body: identityCommand("CreateUser", 740, {user_id: userId, email: "lead@onyx.example", display_name: "Operations Lead"}, "identity-authority:user:create", 0)});
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
      const contextLinkId = testId(850);
      const contextLink = await application.handle({method:"POST",path:"/v1/context/commands/CreateContextLink",body:contextLinkCommand("CreateContextLink",741,{context_link_id:contextLinkId,source_ref:{aggregate_type:"Mission",object_id:testId(14)},target_ref:{aggregate_type:"Task",object_id:testId(400)},relation_type:"DELIVERS",strength:"STRONG",metadata:{origin:"api-test"}},"context:create",0)});
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

      assert.deepEqual([organization.status, user.status, mission.status, task.status, contextLink.status, timeline.status, report.status], [202, 202, 202, 202, 202, 202, 202]);
      const organizationView = await application.handle({method: "GET", path: `/v1/organizations/${testId(13)}?organization_id=${testId(13)}`});
      assert.equal(organizationView.status, 200);
      assert.equal(body(organizationView).slug, "onyx-labs");
      const userView = await application.handle({method: "GET", path: `/v1/users/${userId}?organization_id=${testId(13)}`});
      assert.equal(userView.status, 200); assert.equal(body(userView).display_name, "Operations Lead");
      const contextView=await application.handle({method:"GET",path:`/v1/context-links/${contextLinkId}?organization_id=${testId(13)}`});assert.equal(contextView.status,200);assert.equal(body(contextView).relation_type,"DELIVERS");
      assert.equal(body(report).event_type, "ReportCreated");
      const replay = await application.handle({method: "POST", path: "/v1/reporting-evidence/commands/CreateReport", body: reportCommand});
      assert.equal(replay.status, report.status);
      assert.deepEqual(replay.body, report.body);

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

  it("paginates collections with opaque cursors and validates query syntax", async () => {
    const application = new OnyxApplication({now});
    try {
      for (const sequence of [30, 31, 32]) {
        const base = createMissionCommand();
        const missionId = testId(sequence);
        const created = await application.handle({
          method: "POST",
          path: "/v1/mission/commands/CreateMission",
          body: createMissionCommand({
            command_id: testId(100 + sequence),
            operation_id: testId(200 + sequence),
            payload: {...base.payload, mission_id: missionId},
            target: {...base.target, object_id: missionId},
          }),
        });
        assert.equal(created.status, 202);
      }

      const first = await application.handle({
        method: "GET",
        path: `/v1/missions?organization_id=${testId(13)}&limit=2`,
      });
      assert.equal(first.status, 200);
      assert.deepEqual(body(first).items.map((item: Record<string, unknown>) => item.mission_id), [testId(30), testId(31)]);
      assert.equal(typeof body(first).next_cursor, "string");

      const second = await application.handle({
        method: "GET",
        path: `/v1/missions?organization_id=${testId(13)}&limit=2&cursor=${body(first).next_cursor}`,
      });
      assert.equal(second.status, 200);
      assert.deepEqual(body(second).items.map((item: Record<string, unknown>) => item.mission_id), [testId(32)]);
      assert.equal(body(second).next_cursor, undefined);

      const invalidPaths = [
        "/v1/missions?organization_id=invalid",
        `/v1/missions?organization_id=${testId(13)}&organization_id=${testId(13)}`,
        `/v1/missions?organization_id=${testId(13)}&limit=01`,
        `/v1/missions?organization_id=${testId(13)}&cursor=not-a-cursor`,
        `/v1/missions?organization_id=${testId(13)}&unknown=true`,
        `/v1/missions/not-a-uuid?organization_id=${testId(13)}`,
        `/v1/missions/${testId(30)}/history?organization_id=${testId(13)}&after_version=NaN`,
        `/v1/missions/${testId(30)}/history?organization_id=${testId(13)}&limit=1001`,
      ];
      for (const path of invalidPaths) {
        const response = await application.handle({method: "GET", path});
        assert.equal(response.status, 400, path);
        assert.equal(body(response).code, "INVALID_ARGUMENT", path);
      }
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

  it("keeps collection cursors stable across a SQLite restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-api-pagination-"));
    const databasePath = join(directory, "onyx.db");
    try {
      const first = new OnyxApplication({databasePath, now});
      for (const sequence of [40, 41]) {
        const base = createMissionCommand();
        const missionId = testId(sequence);
        assert.equal((await first.handle({
          method: "POST",
          path: "/v1/mission/commands/CreateMission",
          body: createMissionCommand({
            command_id: testId(100 + sequence),
            operation_id: testId(200 + sequence),
            payload: {...base.payload, mission_id: missionId},
            target: {...base.target, object_id: missionId},
          }),
        })).status, 202);
      }
      const page = await first.handle({
        method: "GET",
        path: `/v1/missions?organization_id=${testId(13)}&limit=1`,
      });
      assert.deepEqual(body(page).items.map((item: Record<string, unknown>) => item.mission_id), [testId(40)]);
      const cursor = String(body(page).next_cursor);
      first.close();

      const second = new OnyxApplication({databasePath, now});
      const resumed = await second.handle({
        method: "GET",
        path: `/v1/missions?organization_id=${testId(13)}&limit=1&cursor=${cursor}`,
      });
      assert.deepEqual(body(resumed).items.map((item: Record<string, unknown>) => item.mission_id), [testId(41)]);
      assert.equal(body(resumed).next_cursor, undefined);
      second.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("reports readiness, messaging backlog, request IDs, and structured request logs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-api-observability-"));
    const databasePath = join(directory, "onyx.db");
    const records: RequestLogRecord[] = [];
    let monotonic = 10;
    const application = new OnyxApplication({
      databasePath,
      now,
      monotonicNow: () => monotonic++,
      logger: (record) => records.push(record),
    });
    try {
      const created = await application.handle({
        method: "POST",
        path: "/v1/mission/commands/CreateMission?secret=must-not-be-logged",
        body: createMissionCommand(),
        headers: {"x-request-id": "request:test-1", authorization: "Bearer must-not-be-logged"},
      });
      assert.equal(created.headers?.["x-request-id"], "request:test-1");

      const readiness = await application.handle({method: "GET", path: "/readyz"});
      assert.equal(readiness.status, 200);
      assert.equal(body(readiness).persistence.mode, "sqlite");
      assert.equal(body(readiness).messaging.outbox.pending, 1);
      assert.equal(body(readiness).messaging.outbox.ready, 1);
      assert.equal(body(readiness).messaging.inbox.completed, 0);
      assert.match(readiness.headers?.["x-request-id"] ?? "", /^[0-9a-f-]{36}$/);

      const metrics = await application.handle({method: "GET", path: "/metrics"});
      assert.match(String(metrics.body), /onyx_persistence_durable 1/);
      assert.match(String(metrics.body), /onyx_outbox_messages\{state="pending"\} 1/);
      assert.doesNotMatch(String(metrics.body), new RegExp(testId(13)));

      assert.equal(records.length, 3);
      assert.deepEqual(records[0], {
        timestamp: now().toISOString(),
        level: "info",
        event: "http.request.completed",
        request_id: "request:test-1",
        method: "POST",
        path: "/v1/mission/commands/CreateMission",
        status: 202,
        duration_ms: 1,
      });
      assert.doesNotMatch(JSON.stringify(records), /must-not-be-logged/);
    } finally {
      application.close();
      await rm(directory, {recursive: true, force: true});
    }
  });
});
