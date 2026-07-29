import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainObjectRef } from "../src/contracts/envelopes.ts";
import { OnyxError } from "../src/contracts/errors.ts";
import { InMemoryMissionRepository } from "../src/mission/repository.ts";
import { MissionService } from "../src/mission/service.ts";
import { InMemoryTimelineRepository } from "../src/timeline/repository.ts";
import { TimelineService } from "../src/timeline/service.ts";
import { InMemoryWorkRepository } from "../src/work/repository.ts";
import { WorkService } from "../src/work/service.ts";
import { createMissionCommand, createTaskCommand, createTimelineCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");

async function fixture(): Promise<{timeline: TimelineService; work: WorkService}> {
  const mission = new MissionService({repository: new InMemoryMissionRepository(), now});
  await mission.execute(createMissionCommand());
  const work = new WorkService({
    repository: new InMemoryWorkRepository(),
    now,
    requireMission: async (organizationId, missionId) => {
      await mission.getMission(organizationId, missionId);
    },
  });
  const requireSubject = async (organizationId: string, subject: DomainObjectRef): Promise<void> => {
    if (subject.aggregate_type === "Mission") return void await mission.getMission(organizationId, subject.object_id);
    if (subject.aggregate_type === "Task") return void await work.getTask(organizationId, subject.object_id);
    throw new OnyxError("INVALID_ARGUMENT", "unsupported timeline subject type");
  };
  return {
    timeline: new TimelineService({repository: new InMemoryTimelineRepository(), requireSubject, now, replicaId: "timeline-test"}),
    work,
  };
}

describe("TimelineService.createTimeline", () => {
  it("creates a timeline for a Mission subject", async () => {
    const {timeline} = await fixture();
    const command = createTimelineCommand();

    const event = await timeline.execute(command);

    assert.equal(event.event_type, "TimelineCreated");
    assert.deepEqual(event.payload.subject_ref, command.payload.subject_ref);
    assert.equal(event.vector_clock["timeline-test"], 1);
    assert.match(event.audit.integrity_digest, /^[0-9a-f]{64}$/);
    assert.equal((await timeline.getTimeline(testId(13), testId(500))).timezone, "Asia/Tehran");
  });

  it("creates a timeline for an existing Task subject", async () => {
    const {timeline, work} = await fixture();
    await work.execute(createTaskCommand());
    const base = createTimelineCommand();
    const event = await timeline.execute(createTimelineCommand({
      payload: {...base.payload, subject_ref: {aggregate_type: "Task", object_id: testId(400)}},
    }));

    assert.equal(event.payload.subject_ref.aggregate_type, "Task");
  });

  it("rejects missing or unsupported subjects", async () => {
    const {timeline} = await fixture();
    const base = createTimelineCommand();

    await assert.rejects(
      timeline.execute(createTimelineCommand({
        payload: {...base.payload, subject_ref: {aggregate_type: "Mission", object_id: testId(999)}},
      })),
      (error: unknown) => error instanceof OnyxError && error.code === "NOT_FOUND",
    );
    await assert.rejects(
      timeline.execute(createTimelineCommand({
        payload: {...base.payload, subject_ref: {aggregate_type: "Report", object_id: testId(999)}},
      })),
      (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT",
    );
  });

  it("replays identical operations and rejects changed reuse", async () => {
    const {timeline} = await fixture();
    const command = createTimelineCommand();
    const first = await timeline.execute(command);

    assert.deepEqual(await timeline.execute(structuredClone(command)), first);
    await assert.rejects(
      timeline.execute({...command, payload: {...command.payload, timezone: "UTC"}}),
      (error: unknown) => error instanceof OnyxError && error.code === "IDEMPOTENCY_KEY_REUSE",
    );
  });

  it("enforces authority, target identity, and organization-scoped queries", async () => {
    const {timeline} = await fixture();
    const command = createTimelineCommand();
    await timeline.execute(command);

    assert.equal((await timeline.listTimelines(testId(13))).length, 1);
    assert.equal((await timeline.listTimelines(testId(999))).length, 0);
    assert.deepEqual((await timeline.getHistory(testId(13), testId(500))).map((event) => event.event_type), ["TimelineCreated"]);
    await assert.rejects(
      timeline.execute(createTimelineCommand({
        operation_id: testId(503),
        authority_proof: {...command.authority_proof, scope: ["timeline:read"]},
      })),
      (error: unknown) => error instanceof OnyxError && error.code === "AUTHORITY_PROOF_INVALID",
    );
    await assert.rejects(
      timeline.execute(createTimelineCommand({target: {aggregate_type: "Timeline", object_id: testId(999)}})),
      (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT",
    );
  });
});
