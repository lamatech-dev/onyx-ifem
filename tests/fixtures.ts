import type { CreateMissionCommand, MissionCommand } from "../src/mission/types.ts";
import type { CreateTaskCommand } from "../src/work/types.ts";
import type { CreateTimelineCommand } from "../src/timeline/types.ts";
import type { CreateReportCommand } from "../src/reporting-evidence/types.ts";

export function testId(sequence: number): string {
  return `018f1c2a-7b3d-7abc-8def-${sequence.toString(16).padStart(12, "0")}`;
}

export function createMissionCommand(overrides: Partial<CreateMissionCommand> = {}): CreateMissionCommand {
  return {
    actor_context: {
      actor_type: "USER",
      principal_id: testId(15),
    },
    authority_proof: {
      authority_epoch: 0,
      expires_at: "2030-01-01T00:00:00.000000Z",
      proof_ref: "proof:test",
      scope: ["mission:create"],
    },
    command_id: testId(11),
    command_type: "CreateMission",
    correlation_id: testId(200),
    issued_at: "2026-07-29T20:00:00.000000Z",
    operation_id: testId(12),
    organization_id: testId(13),
    payload: {
      mission_id: testId(14),
      objective: "Establish an independently executable mission.",
      owner_id: testId(15),
      settings: {},
    },
    schema_version: 1,
    target: {
      aggregate_type: "Mission",
      object_id: testId(14),
    },
    vector_clock: {"replica-a": 1},
    ...overrides,
  };
}

export function missionCommand<TType extends MissionCommand["command_type"], TPayload>(
  type: TType,
  sequence: number,
  payload: TPayload,
  scope: string,
  expectedVersion: number,
): Extract<MissionCommand, {command_type: TType}> {
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)},
    authority_proof: {
      authority_epoch: 0,
      expires_at: "2030-01-01T00:00:00.000000Z",
      proof_ref: `proof:${type}`,
      scope: [scope],
    },
    command_id: testId(100 + sequence),
    command_type: type,
    correlation_id: testId(200),
    expected_authority_epoch: 0,
    expected_lifecycle_epoch: 0,
    expected_version: expectedVersion,
    issued_at: "2026-07-29T20:00:00.000000Z",
    operation_id: testId(200 + sequence),
    organization_id: testId(13),
    payload,
    schema_version: 1,
    target: {aggregate_type: "Mission", object_id: testId(14)},
    vector_clock: {"replica-a": sequence},
  } as unknown as Extract<MissionCommand, {command_type: TType}>;
}

export function createTaskCommand(overrides: Partial<CreateTaskCommand> = {}): CreateTaskCommand {
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)},
    authority_proof: {
      authority_epoch: 0,
      expires_at: "2030-01-01T00:00:00.000000Z",
      proof_ref: "proof:work-create",
      scope: ["work:create"],
    },
    command_id: testId(401),
    command_type: "CreateTask",
    correlation_id: testId(200),
    expected_version: 0,
    issued_at: "2026-07-29T20:00:00.000000Z",
    operation_id: testId(402),
    organization_id: testId(13),
    payload: {
      task_id: testId(400),
      mission_id: testId(14),
      title: "Implement the Mission adapter",
      description: "Build and verify the first dependent Work item.",
      owner_id: testId(15),
      priority: "HIGH",
      estimate: {value: 3, unit: "POINT"},
    },
    schema_version: 1,
    target: {aggregate_type: "Task", object_id: testId(400)},
    vector_clock: {"replica-a": 1},
    ...overrides,
  };
}

export function createTimelineCommand(overrides: Partial<CreateTimelineCommand> = {}): CreateTimelineCommand {
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)},
    authority_proof: {
      authority_epoch: 0,
      expires_at: "2030-01-01T00:00:00.000000Z",
      proof_ref: "proof:timeline-create",
      scope: ["timeline:create"],
    },
    command_id: testId(501),
    command_type: "CreateTimeline",
    correlation_id: testId(200),
    expected_version: 0,
    issued_at: "2026-07-29T20:00:00.000000Z",
    operation_id: testId(502),
    organization_id: testId(13),
    payload: {
      timeline_id: testId(500),
      subject_ref: {aggregate_type: "Mission", object_id: testId(14)},
      timezone: "Asia/Tehran",
    },
    schema_version: 1,
    target: {aggregate_type: "Timeline", object_id: testId(500)},
    vector_clock: {"replica-a": 1},
    ...overrides,
  };
}

export function createReportCommand(overrides: Partial<CreateReportCommand> = {}): CreateReportCommand {
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)},
    authority_proof: {
      authority_epoch: 0,
      expires_at: "2030-01-01T00:00:00.000000Z",
      proof_ref: "proof:report-create",
      scope: ["reporting-evidence:create"],
    },
    command_id: testId(601),
    command_type: "CreateReport",
    correlation_id: testId(200),
    expected_version: 0,
    issued_at: "2026-07-29T20:00:00.000000Z",
    operation_id: testId(602),
    organization_id: testId(13),
    payload: {
      report_id: testId(600),
      report_type: "MISSION_STATUS",
      subject_ref: {aggregate_type: "Mission", object_id: testId(14)},
      author_id: testId(15),
      title: "Mission status report",
    },
    schema_version: 1,
    target: {aggregate_type: "Report", object_id: testId(600)},
    vector_clock: {"replica-a": 1},
    ...overrides,
  };
}
