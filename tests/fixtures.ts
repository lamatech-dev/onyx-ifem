import type { CreateMissionCommand, MissionCommand } from "../src/mission/types.ts";
import type { CreateTaskCommand, WorkCommand } from "../src/work/types.ts";
import type { CreateTimelineCommand, TimelineCommand } from "../src/timeline/types.ts";
import type { CreateReportCommand, ReportingCommand } from "../src/reporting-evidence/types.ts";
import type { OrganizationCommand } from "../src/organization/types.ts";
import type { IdentityCommand } from "../src/identity-authority/types.ts";
import type { ContextLinkCommand } from "../src/context-link/types.ts";
import type { MeetingCommand } from "../src/meeting/types.ts";
import type{ConversationCommand}from"../src/conversation/types.ts";

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

export function workCommand<TType extends WorkCommand["command_type"], TPayload>(
  type: TType,
  sequence: number,
  taskId: string,
  payload: TPayload,
  scope: string,
  expectedVersion: number,
): Extract<WorkCommand, {command_type: TType}> {
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)},
    authority_proof: {authority_epoch: 0, expires_at: "2030-01-01T00:00:00.000000Z", proof_ref: `proof:${type}`, scope: [scope]},
    command_id: testId(700 + sequence), command_type: type, correlation_id: testId(200),
    expected_authority_epoch: 0, expected_lifecycle_epoch: 0, expected_version: expectedVersion,
    issued_at: "2026-07-29T20:00:00.000000Z", operation_id: testId(800 + sequence), organization_id: testId(13),
    payload, schema_version: 1, target: {aggregate_type: "Task", object_id: taskId}, vector_clock: {"replica-a": sequence},
  } as unknown as Extract<WorkCommand, {command_type: TType}>;
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

export function timelineCommand<TType extends TimelineCommand["command_type"], TPayload>(type: TType, sequence: number, payload: TPayload, scope: string, expectedVersion: number): Extract<TimelineCommand, {command_type: TType}> {
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)},
    authority_proof: {authority_epoch: 0, expires_at: "2030-01-01T00:00:00.000000Z", proof_ref: `proof:${type}`, scope: [scope]},
    command_id: testId(1_000 + sequence), command_type: type, correlation_id: testId(200), expected_authority_epoch: 0,
    expected_lifecycle_epoch: 0, expected_version: expectedVersion, issued_at: "2026-07-29T20:00:00.000000Z",
    operation_id: testId(1_100 + sequence), organization_id: testId(13), payload, schema_version: 1,
    target: {aggregate_type: "Timeline", object_id: testId(500)}, vector_clock: {"replica-a": sequence},
  } as unknown as Extract<TimelineCommand, {command_type: TType}>;
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

export function reportingCommand<TType extends ReportingCommand["command_type"], TPayload>(type: TType, sequence: number, payload: TPayload, scope: string, expectedVersion: number): Extract<ReportingCommand, {command_type: TType}> {
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)}, authority_proof: {authority_epoch: 0, expires_at: "2030-01-01T00:00:00.000000Z", proof_ref: `proof:${type}`, scope: [scope]},
    command_id: testId(1_300 + sequence), command_type: type, correlation_id: testId(200), expected_authority_epoch: 0, expected_lifecycle_epoch: 0,
    expected_version: expectedVersion, issued_at: "2026-07-29T20:00:00.000000Z", operation_id: testId(1_400 + sequence), organization_id: testId(13), payload,
    schema_version: 1, target: {aggregate_type: "Report", object_id: testId(600)}, vector_clock: {"replica-a": sequence},
  } as unknown as Extract<ReportingCommand, {command_type: TType}>;
}

export function organizationCommand<TType extends OrganizationCommand["command_type"], TPayload>(type: TType, sequence: number, aggregateType: string, objectId: string, payload: TPayload, scope: string, expectedVersion: number): Extract<OrganizationCommand, {command_type: TType}> {
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)}, authority_proof: {authority_epoch: 0, expires_at: "2030-01-01T00:00:00.000000Z", proof_ref: `proof:${type}`, scope: [scope]},
    command_id: testId(1_600 + sequence), command_type: type, correlation_id: testId(200), expected_authority_epoch: 0, expected_lifecycle_epoch: 0, expected_version: expectedVersion,
    issued_at: "2026-07-29T20:00:00.000000Z", operation_id: testId(1_700 + sequence), organization_id: testId(13), payload, schema_version: 1,
    target: {aggregate_type: aggregateType, object_id: objectId}, vector_clock: {"replica-a": sequence},
  } as unknown as Extract<OrganizationCommand, {command_type: TType}>;
}

export function identityCommand<TType extends IdentityCommand["command_type"], TPayload>(type: TType, sequence: number, payload: TPayload, scope: string, expectedVersion: number, lifecycleEpoch = 0, authorityEpoch = 0): Extract<IdentityCommand, {command_type: TType}> {
  const userId = (payload as {user_id: string}).user_id;
  return {
    actor_context: {actor_type: "USER", principal_id: testId(15)}, authority_proof: {authority_epoch: authorityEpoch, expires_at: "2030-01-01T00:00:00.000000Z", proof_ref: `proof:${type}`, scope: [scope]},
    command_id: testId(2_000 + sequence), command_type: type, correlation_id: testId(200), expected_authority_epoch: authorityEpoch, expected_lifecycle_epoch: lifecycleEpoch, expected_version: expectedVersion,
    issued_at: "2026-07-29T20:00:00.000000Z", operation_id: testId(2_100 + sequence), organization_id: testId(13), payload, schema_version: 1,
    target: {aggregate_type: "User", object_id: userId}, vector_clock: {"replica-a": sequence},
  } as unknown as Extract<IdentityCommand, {command_type: TType}>;
}

export function contextLinkCommand<TType extends ContextLinkCommand["command_type"], TPayload>(type: TType, sequence: number, payload: TPayload, scope: string, expectedVersion: number, lifecycleEpoch = 0): Extract<ContextLinkCommand, {command_type: TType}> {
  const id = (payload as {context_link_id: string}).context_link_id;
  return {actor_context:{actor_type:"USER",principal_id:testId(15)},authority_proof:{authority_epoch:0,expires_at:"2030-01-01T00:00:00.000000Z",proof_ref:`proof:${type}`,scope:[scope]},command_id:testId(2_300+sequence),command_type:type,correlation_id:testId(200),expected_authority_epoch:0,expected_lifecycle_epoch:lifecycleEpoch,expected_version:expectedVersion,issued_at:"2026-07-29T20:00:00.000000Z",operation_id:testId(2_400+sequence),organization_id:testId(13),payload,schema_version:1,target:{aggregate_type:"ContextLink",object_id:id},vector_clock:{"replica-a":sequence}} as unknown as Extract<ContextLinkCommand,{command_type:TType}>;
}

export function meetingCommand<TType extends MeetingCommand["command_type"],TPayload>(type:TType,sequence:number,payload:TPayload,scope:string,expectedVersion:number,lifecycleEpoch=0):Extract<MeetingCommand,{command_type:TType}>{const id=(payload as{meeting_id:string}).meeting_id;return{actor_context:{actor_type:"USER",principal_id:testId(800)},authority_proof:{authority_epoch:0,expires_at:"2030-01-01T00:00:00.000000Z",proof_ref:`proof:${type}`,scope:[scope]},command_id:testId(2_600+sequence),command_type:type,correlation_id:testId(200),expected_authority_epoch:0,expected_lifecycle_epoch:lifecycleEpoch,expected_version:expectedVersion,issued_at:"2026-07-29T20:00:00.000000Z",operation_id:testId(2_700+sequence),organization_id:testId(13),payload,schema_version:1,target:{aggregate_type:"Meeting",object_id:id},vector_clock:{"replica-a":sequence}}as unknown as Extract<MeetingCommand,{command_type:TType}>}
export function conversationCommand<TType extends ConversationCommand["command_type"],TPayload>(type:TType,sequence:number,payload:TPayload,scope:string,expectedVersion:number,lifecycleEpoch=0):Extract<ConversationCommand,{command_type:TType}>{const id=(payload as{conversation_id:string}).conversation_id;return{actor_context:{actor_type:"USER",principal_id:testId(800)},authority_proof:{authority_epoch:0,expires_at:"2030-01-01T00:00:00.000000Z",proof_ref:`proof:${type}`,scope:[scope]},command_id:testId(2_900+sequence),command_type:type,correlation_id:testId(200),expected_authority_epoch:0,expected_lifecycle_epoch:lifecycleEpoch,expected_version:expectedVersion,issued_at:"2026-07-29T20:00:00.000000Z",operation_id:testId(3_000+sequence),organization_id:testId(13),payload,schema_version:1,target:{aggregate_type:"Conversation",object_id:id},vector_clock:{"replica-a":sequence}}as unknown as Extract<ConversationCommand,{command_type:TType}>}
