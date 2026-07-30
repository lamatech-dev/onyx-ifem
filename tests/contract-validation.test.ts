import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { assertEmittedEvent, validateEventEnvelope } from "../src/contracts/validation.ts";
import { InMemoryMissionRepository } from "../src/mission/repository.ts";
import { MissionService } from "../src/mission/service.ts";
import {
  validateCloseMissionCommand,
  validateCreateMissionCommand,
  validateOperationalHaltMissionCommand,
  validateRestartMissionCommand,
} from "../src/mission/validation.ts";
import { validateCreateReportCommand } from "../src/reporting-evidence/validation.ts";
import { validateCreateTimelineCommand } from "../src/timeline/validation.ts";
import { validateCreateTaskCommand } from "../src/work/validation.ts";
import { createMissionCommand, createReportCommand, createTaskCommand, createTimelineCommand, missionCommand, testId } from "./fixtures.ts";

type Validator = (value: unknown) => void;

function rejectsInvalid(validator: Validator, value: unknown): void {
  assert.throws(
    () => validator(value),
    (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT",
  );
}

describe("strict command envelope validation", () => {
  it("accepts valid commands from every executable context", () => {
    validateCreateMissionCommand(createMissionCommand());
    validateCreateTaskCommand(createTaskCommand());
    validateCreateTimelineCommand(createTimelineCommand());
    validateCreateReportCommand(createReportCommand());
  });

  it("rejects unknown envelope properties in every executable context", () => {
    const cases: Array<[Validator, object]> = [
      [validateCreateMissionCommand, createMissionCommand()],
      [validateCreateTaskCommand, createTaskCommand()],
      [validateCreateTimelineCommand, createTimelineCommand()],
      [validateCreateReportCommand, createReportCommand()],
    ];
    for (const [validator, command] of cases) rejectsInvalid(validator, {...command, extension: true});
  });

  it("enforces actor, authority proof, reference, epoch, and vector-clock schemas", () => {
    const base = createMissionCommand();
    const invalidCommands = [
      {...base, actor_context: {...base.actor_context, actor_type: "ROBOT"}},
      {...base, actor_context: {...base.actor_context, extension: true}},
      {...base, actor_context: {...base.actor_context, device_id: "not-a-uuid"}},
      {...base, authority_proof: {...base.authority_proof, proof_ref: ""}},
      {...base, authority_proof: {...base.authority_proof, scope: ["mission:create", "mission:create"]}},
      {...base, authority_proof: {...base.authority_proof, scope: [""]}},
      {...base, authority_proof: {...base.authority_proof, extension: true}},
      {...base, target: {...base.target, extension: true}},
      {...base, causation_id: "not-a-uuid"},
      {...base, expected_lifecycle_epoch: -1},
      {...base, expected_authority_epoch: 1.5},
      {...base, vector_clock: {"replica-a": 0}},
      {...base, vector_clock: {"replica-a": 1.5}},
      {...base, vector_clock: []},
    ];
    for (const command of invalidCommands) rejectsInvalid(validateCreateMissionCommand, command);
  });

  it("accepts every optional envelope field when it is schema-valid", () => {
    const base = createMissionCommand();
    validateCreateMissionCommand({
      ...base,
      causation_id: base.command_id,
      expected_lifecycle_epoch: 0,
      expected_authority_epoch: 0,
      actor_context: {
        ...base.actor_context,
        device_id: base.command_id,
        membership_id: base.operation_id,
      },
    });
  });

  it("strictly validates the completed mission lifecycle payloads", () => {
    const halt = missionCommand(
      "OperationalHaltMission",
      80,
      {mission_id: testId(14), reason_code: "INCIDENT", reason: "Operational boundary", incident_id: testId(401)},
      "mission:halt",
      4,
    );
    const restart = missionCommand(
      "RestartMission",
      81,
      {mission_id: testId(14), restart_note: "Boundary cleared", timeline_id: testId(402)},
      "mission:restart",
      5,
    );
    const close = missionCommand(
      "CloseMission",
      82,
      {mission_id: testId(14), outcome_code: "COMPLETED", outcome_summary: "Objective met"},
      "mission:close",
      6,
    );
    validateOperationalHaltMissionCommand(halt);
    validateRestartMissionCommand(restart);
    validateCloseMissionCommand(close);
    rejectsInvalid(validateOperationalHaltMissionCommand, {...halt, payload: {...halt.payload, extension: true}});
    rejectsInvalid(validateRestartMissionCommand, {...restart, payload: {...restart.payload, restart_note: ""}});
    rejectsInvalid(validateCloseMissionCommand, {...close, payload: {...close.payload, outcome_summary: ""}});
  });
});

describe("strict event envelope validation", () => {
  it("accepts emitted events and verifies their integrity digest", async () => {
    const service = new MissionService({
      repository: new InMemoryMissionRepository(),
      now: () => new Date("2026-07-29T20:00:01.000Z"),
    });
    const event = await service.execute(createMissionCommand());

    validateEventEnvelope(event, "MissionCreated", "Mission");
  });

  it("rejects malformed event envelopes and content tampering", async () => {
    const service = new MissionService({
      repository: new InMemoryMissionRepository(),
      now: () => new Date("2026-07-29T20:00:01.000Z"),
    });
    const event = await service.execute(createMissionCommand());
    const validate = (value: unknown): void => void validateEventEnvelope(value, "MissionCreated", "Mission");
    const invalidEvents = [
      {...event, extension: true},
      {...event, aggregate: {...event.aggregate, extension: true}},
      {...event, aggregate: {...event.aggregate, aggregate_type: "Task"}},
      {...event, aggregate_version: -1},
      {...event, occurred_at: "2026-07-29T20:00:01Z"},
      {...event, vector_clock: {"replica-a": 0}},
      {...event, audit: {...event.audit, extension: true}},
      {...event, audit: {...event.audit, integrity_digest: "0".repeat(64)}},
      {...event, payload: {...event.payload, title: "tampered after signing"}},
    ];
    for (const invalidEvent of invalidEvents) rejectsInvalid(validate, invalidEvent);
  });

  it("turns emitted-event violations into internal failures", () => {
    assert.throws(
      () => assertEmittedEvent({}, "MissionCreated", "Mission"),
      (error: unknown) => error instanceof Error && !(error instanceof OnyxError),
    );
  });
});
