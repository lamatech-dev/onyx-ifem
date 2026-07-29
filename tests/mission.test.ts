import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { InMemoryMissionRepository } from "../src/mission/repository.ts";
import { MissionService } from "../src/mission/service.ts";
import { createMissionCommand, missionCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");

describe("MissionService.createMission", () => {
  it("creates a mission and emits a canonical event", async () => {
    const repository = new InMemoryMissionRepository();
    const service = new MissionService({repository, now, replicaId: "test-replica"});
    const command = createMissionCommand();

    const event = await service.createMission(command);

    assert.equal(event.event_type, "MissionCreated");
    assert.equal(event.aggregate.object_id, command.payload.mission_id);
    assert.equal(event.causation_id, command.command_id);
    assert.match(event.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(event.audit.integrity_digest, /^[0-9a-f]{64}$/);
    assert.equal(event.vector_clock["test-replica"], 1);
    assert.equal((await repository.find(command.payload.mission_id))?.status, "DRAFT");
  });

  it("returns the original event for an identical operation replay", async () => {
    const service = new MissionService({repository: new InMemoryMissionRepository(), now});
    const command = createMissionCommand();

    const first = await service.createMission(command);
    const second = await service.createMission(structuredClone(command));

    assert.deepEqual(second, first);
  });

  it("rejects operation id reuse with a different payload", async () => {
    const service = new MissionService({repository: new InMemoryMissionRepository(), now});
    const command = createMissionCommand();
    await service.createMission(command);

    await assert.rejects(
      service.createMission({...command, payload: {...command.payload, objective: "Changed"}}),
      (error: unknown) => error instanceof OnyxError && error.code === "IDEMPOTENCY_KEY_REUSE",
    );
  });

  it("rejects an expired authority proof", async () => {
    const service = new MissionService({repository: new InMemoryMissionRepository(), now});
    const command = createMissionCommand({
      authority_proof: {
        authority_epoch: 0,
        expires_at: "2026-07-29T19:59:59.000000Z",
        proof_ref: "proof:expired",
        scope: ["mission:create"],
      },
    });

    await assert.rejects(
      service.createMission(command),
      (error: unknown) => error instanceof OnyxError && error.code === "AUTHORITY_PROOF_INVALID",
    );
  });

  it("rejects a target that differs from the payload mission", async () => {
    const service = new MissionService({repository: new InMemoryMissionRepository(), now});
    const command = createMissionCommand({
      target: {aggregate_type: "Mission", object_id: "018f1c2a-7b3d-7abc-8def-0123456789aa"},
    });

    await assert.rejects(
      service.createMission(command),
      (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT",
    );
  });
});

describe("Mission lifecycle", () => {
  it("executes every field-complete lifecycle contract and records history", async () => {
    const repository = new InMemoryMissionRepository();
    const service = new MissionService({repository, now, replicaId: "test-replica"});
    await service.execute(createMissionCommand());

    const revisionId = testId(300);
    const timelineId = testId(301);
    const events = [];
    events.push(await service.execute(missionCommand(
      "CreateBlueprintRevision",
      1,
      {mission_id: testId(14), revision_id: revisionId, content: {steps: []}, change_summary: "Initial plan"},
      "mission:blueprint:create",
      1,
    )));
    events.push(await service.execute(missionCommand(
      "SubmitBlueprint",
      2,
      {mission_id: testId(14), revision_id: revisionId},
      "mission:blueprint:submit",
      2,
    )));
    events.push(await service.execute(missionCommand(
      "ActivateMission",
      3,
      {mission_id: testId(14), approved_revision_id: revisionId, timeline_id: timelineId},
      "mission:activate",
      3,
    )));
    events.push(await service.execute(missionCommand(
      "PauseMission",
      4,
      {mission_id: testId(14), reason_code: "OPERATOR_REQUEST", reason: "Planned pause"},
      "mission:pause",
      4,
    )));
    events.push(await service.execute(missionCommand(
      "ResumeMission",
      5,
      {mission_id: testId(14), resume_note: "Dependencies available"},
      "mission:resume",
      5,
    )));
    events.push(await service.execute(missionCommand(
      "CancelMission",
      6,
      {mission_id: testId(14), reason_code: "OBJECTIVE_WITHDRAWN", reason: "Owner withdrew objective"},
      "mission:cancel",
      6,
    )));
    const archiveCommand = missionCommand(
      "ArchiveMission",
      7,
      {mission_id: testId(14), retention_policy_id: testId(302)},
      "mission:archive",
      7,
    );
    archiveCommand.expected_lifecycle_epoch = 1;
    events.push(await service.execute(archiveCommand));

    assert.deepEqual(events.map((event) => event.event_type), [
      "MissionBlueprintRevisionCreated",
      "MissionBlueprintSubmitted",
      "MissionActivated",
      "MissionPaused",
      "MissionResumed",
      "MissionCancelled",
      "MissionArchived",
    ]);
    assert.deepEqual(events.map((event) => event.aggregate_version), [2, 3, 4, 5, 6, 7, 8]);

    const view = await service.getMission(testId(13), testId(14));
    assert.equal(view.status, "ARCHIVED");
    assert.equal(view.version, 8);
    assert.equal(view.lifecycle_epoch, 1);
    assert.equal(view.active_blueprint_revision_id, revisionId);
    assert.equal(view.timeline_id, timelineId);

    const history = await service.getHistory(testId(13), testId(14), 3, 3);
    assert.deepEqual(history.map((event) => event.aggregate_version), [4, 5, 6]);
  });

  it("rejects an invalid lifecycle transition", async () => {
    const service = new MissionService({repository: new InMemoryMissionRepository(), now});
    await service.execute(createMissionCommand());
    const command = missionCommand(
      "PauseMission",
      10,
      {mission_id: testId(14), reason_code: "INVALID", reason: "Cannot pause a draft"},
      "mission:pause",
      1,
    );

    await assert.rejects(
      service.execute(command),
      (error: unknown) => error instanceof OnyxError && error.code === "INVALID_STATE_TRANSITION",
    );
  });

  it("rejects an optimistic concurrency mismatch", async () => {
    const service = new MissionService({repository: new InMemoryMissionRepository(), now});
    await service.execute(createMissionCommand());
    const command = missionCommand(
      "CancelMission",
      11,
      {mission_id: testId(14), reason_code: "TEST", reason: "Expected version is stale"},
      "mission:cancel",
      99,
    );

    await assert.rejects(
      service.execute(command),
      (error: unknown) => error instanceof OnyxError && error.code === "VERSION_CONFLICT",
    );
  });

  it("lists missions within an organization boundary", async () => {
    const service = new MissionService({repository: new InMemoryMissionRepository(), now});
    await service.execute(createMissionCommand());

    assert.equal((await service.listMissions(testId(13))).length, 1);
    assert.equal((await service.listMissions(testId(999))).length, 0);
    await assert.rejects(
      service.getMission(testId(999), testId(14)),
      (error: unknown) => error instanceof OnyxError && error.code === "NOT_FOUND",
    );
  });
});
