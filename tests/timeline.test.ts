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
import { createMissionCommand, createTaskCommand, createTimelineCommand, testId, timelineCommand } from "./fixtures.ts";

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

    assert.equal(event.event_type, "TimelineCreated");
    if (event.event_type !== "TimelineCreated") throw new Error("unexpected event");
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

  it("executes scheduling mutations and archives the timeline", async () => {
    const {timeline} = await fixture(); await timeline.execute(createTimelineCommand()); const id = testId(500);
    const commands = [
      timelineCommand("SetDeadline", 1, {timeline_id: id, deadline_id: testId(520), deadline_at: "2026-08-01T10:00:00.000000Z", label: "Release"}, "timeline:deadline:set", 1),
      timelineCommand("MoveDeadline", 2, {timeline_id: id, deadline_id: testId(520), new_deadline_at: "2026-08-02T10:00:00.000000Z", reason: "Risk buffer"}, "timeline:deadline:move", 2),
      timelineCommand("AddMilestone", 3, {timeline_id: id, milestone_id: testId(521), title: "Acceptance", due_at: "2026-08-02T09:00:00.000000Z"}, "timeline:milestone:add", 3),
      timelineCommand("DefineCriticalMarker", 4, {timeline_id: id, marker_id: testId(522), label: "Go/no-go", trigger_at: "2026-08-02T08:00:00.000000Z"}, "timeline:marker:define", 4),
      timelineCommand("ActivatePenaltyZone", 5, {timeline_id: id, penalty_zone_id: testId(523), starts_at: "2026-08-02T11:00:00.000000Z", reason: "Late delivery"}, "timeline:penalty-zone:activate", 5),
      timelineCommand("ResolveScheduleException", 6, {timeline_id: id, exception_id: testId(524), resolution_note: "Approved variance"}, "timeline:exception:resolve", 6),
      timelineCommand("ArchiveTimeline", 7, {timeline_id: id, retention_policy_id: testId(525)}, "timeline:archive", 7),
    ];
    const events = []; for (const command of commands) events.push(await timeline.execute(command));
    assert.deepEqual(events.map((event) => event.event_type), ["DeadlineChanged", "DeadlineMoved", "MilestoneAdded", "CriticalMarkerDefined", "PenaltyZoneActivated", "ScheduleExceptionRaised", "TimelineArchived"]);
    const view = await timeline.getTimeline(testId(13), id); assert.equal(view.status, "ARCHIVED"); assert.equal(view.version, 8); assert.equal(view.lifecycle_epoch, 1); assert.equal(view.deadlines[testId(520)]?.deadline_at, "2026-08-02T10:00:00.000000Z");
    await assert.rejects(timeline.execute(timelineCommand("AddMilestone", 8, {timeline_id: id, milestone_id: testId(526), title: "No", due_at: "2026-08-03T00:00:00.000000Z"}, "timeline:milestone:add", 8)), (error: unknown) => error instanceof OnyxError && error.code === "INVALID_STATE_TRANSITION");
  });

  it("durably emits each due deadline and critical-marker signal exactly once",async()=>{let current=new Date("2026-07-29T20:00:01.000Z");const service=new TimelineService({repository:new InMemoryTimelineRepository(),requireSubject:async()=>undefined,now:()=>current,replicaId:"timeline-scheduler"}),id=testId(500);await service.execute(createTimelineCommand());await service.execute(timelineCommand("SetDeadline",20,{timeline_id:id,deadline_id:testId(530),deadline_at:"2026-07-29T20:00:02.000000Z",label:"Due"},"timeline:deadline:set",1));await service.execute(timelineCommand("DefineCriticalMarker",21,{timeline_id:id,marker_id:testId(531),label:"Critical",trigger_at:"2026-07-29T20:00:02.000000Z"},"timeline:marker:define",2));current=new Date("2026-07-29T20:00:03.000Z");const emitted=await service.processDueSignals(testId(13),id);assert.deepEqual(emitted.map(e=>e.event_type),["DeadlineReached","CriticalMarkerReached"]);assert.deepEqual(await service.processDueSignals(testId(13),id),[]);const view=await service.getTimeline(testId(13),id);assert.deepEqual(view.reached_deadline_ids,[testId(530)]);assert.deepEqual(view.reached_marker_ids,[testId(531)]);assert.deepEqual((await service.getHistory(testId(13),id)).map(e=>e.event_type).slice(-2),["DeadlineReached","CriticalMarkerReached"])});
});
