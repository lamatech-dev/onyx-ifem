import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { validateCreateMissionCommand } from "../src/mission/validation.ts";
import { validateCreateReportCommand } from "../src/reporting-evidence/validation.ts";
import { validateCreateTimelineCommand } from "../src/timeline/validation.ts";
import { validateCreateTaskCommand } from "../src/work/validation.ts";
import { createMissionCommand, createReportCommand, createTaskCommand, createTimelineCommand } from "./fixtures.ts";

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
    const cases: Array<[Validator, Record<string, unknown>]> = [
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
});
