import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainObjectRef } from "../src/contracts/envelopes.ts";
import { OnyxError } from "../src/contracts/errors.ts";
import { InMemoryMissionRepository } from "../src/mission/repository.ts";
import { MissionService } from "../src/mission/service.ts";
import { InMemoryReportingRepository } from "../src/reporting-evidence/repository.ts";
import { ReportingService } from "../src/reporting-evidence/service.ts";
import { InMemoryTimelineRepository } from "../src/timeline/repository.ts";
import { TimelineService } from "../src/timeline/service.ts";
import { InMemoryWorkRepository } from "../src/work/repository.ts";
import { WorkService } from "../src/work/service.ts";
import { createMissionCommand, createReportCommand, createTaskCommand, createTimelineCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");

async function fixture(): Promise<{reporting: ReportingService; timeline: TimelineService; work: WorkService}> {
  const mission = new MissionService({repository: new InMemoryMissionRepository(), now});
  await mission.execute(createMissionCommand());
  const work = new WorkService({
    repository: new InMemoryWorkRepository(),
    now,
    requireMission: async (organizationId, missionId) => {
      await mission.getMission(organizationId, missionId);
    },
  });
  const timeline = new TimelineService({
    repository: new InMemoryTimelineRepository(),
    now,
    requireSubject: async (organizationId, subject) => {
      await mission.getMission(organizationId, subject.object_id);
    },
  });
  const requireSubject = async (organizationId: string, subject: DomainObjectRef): Promise<void> => {
    if (subject.aggregate_type === "Mission") return void await mission.getMission(organizationId, subject.object_id);
    if (subject.aggregate_type === "Task") return void await work.getTask(organizationId, subject.object_id);
    if (subject.aggregate_type === "Timeline") return void await timeline.getTimeline(organizationId, subject.object_id);
    throw new OnyxError("INVALID_ARGUMENT", "unsupported report subject type");
  };
  return {
    reporting: new ReportingService({repository: new InMemoryReportingRepository(), requireSubject, now, replicaId: "reporting-test"}),
    timeline,
    work,
  };
}

describe("ReportingService.createReport", () => {
  it("creates a report for a Mission subject", async () => {
    const {reporting} = await fixture();
    const command = createReportCommand();

    const event = await reporting.execute(command);

    assert.equal(event.event_type, "ReportCreated");
    assert.deepEqual(event.payload, command.payload);
    assert.equal(event.vector_clock["reporting-test"], 1);
    assert.match(event.audit.integrity_digest, /^[0-9a-f]{64}$/);
    assert.equal((await reporting.getReport(testId(13), testId(600))).report_type, "MISSION_STATUS");
  });

  it("supports existing Task and Timeline subjects", async () => {
    const {reporting, timeline, work} = await fixture();
    await work.execute(createTaskCommand());
    await timeline.execute(createTimelineCommand());
    const base = createReportCommand();

    const taskReport = await reporting.execute(createReportCommand({
      payload: {...base.payload, subject_ref: {aggregate_type: "Task", object_id: testId(400)}},
    }));
    const timelineReport = await reporting.execute(createReportCommand({
      command_id: testId(603),
      operation_id: testId(604),
      payload: {...base.payload, report_id: testId(605), subject_ref: {aggregate_type: "Timeline", object_id: testId(500)}},
      target: {aggregate_type: "Report", object_id: testId(605)},
    }));

    assert.equal(taskReport.payload.subject_ref.aggregate_type, "Task");
    assert.equal(timelineReport.payload.subject_ref.aggregate_type, "Timeline");
  });

  it("rejects missing and unsupported subjects", async () => {
    const {reporting} = await fixture();
    const base = createReportCommand();

    await assert.rejects(
      reporting.execute(createReportCommand({
        payload: {...base.payload, subject_ref: {aggregate_type: "Mission", object_id: testId(999)}},
      })),
      (error: unknown) => error instanceof OnyxError && error.code === "NOT_FOUND",
    );
    await assert.rejects(
      reporting.execute(createReportCommand({
        payload: {...base.payload, subject_ref: {aggregate_type: "File", object_id: testId(999)}},
      })),
      (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT",
    );
  });

  it("replays identical operations and rejects changed reuse", async () => {
    const {reporting} = await fixture();
    const command = createReportCommand();
    const first = await reporting.execute(command);

    assert.deepEqual(await reporting.execute(structuredClone(command)), first);
    await assert.rejects(
      reporting.execute({...command, payload: {...command.payload, title: "Changed"}}),
      (error: unknown) => error instanceof OnyxError && error.code === "IDEMPOTENCY_KEY_REUSE",
    );
  });

  it("enforces authority, target identity, and organization-scoped queries", async () => {
    const {reporting} = await fixture();
    const command = createReportCommand();
    await reporting.execute(command);

    assert.equal((await reporting.listReports(testId(13))).length, 1);
    assert.equal((await reporting.listReports(testId(999))).length, 0);
    assert.deepEqual((await reporting.getHistory(testId(13), testId(600))).map((event) => event.event_type), ["ReportCreated"]);
    await assert.rejects(
      reporting.execute(createReportCommand({
        operation_id: testId(606),
        authority_proof: {...command.authority_proof, scope: ["reporting-evidence:read"]},
      })),
      (error: unknown) => error instanceof OnyxError && error.code === "AUTHORITY_PROOF_INVALID",
    );
    await assert.rejects(
      reporting.execute(createReportCommand({target: {aggregate_type: "Report", object_id: testId(999)}})),
      (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT",
    );
  });
});
