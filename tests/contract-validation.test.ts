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
import { validateIdentityCommand } from "../src/identity-authority/validation.ts";
import { validateContextLinkCommand } from "../src/context-link/validation.ts";
import {validateMeetingCommand}from"../src/meeting/validation.ts";
import{validateConversationCommand}from"../src/conversation/validation.ts";
import{validateFileCommand}from"../src/file/validation.ts";
import{validateApprovalCommand}from"../src/approval/validation.ts";
import{validateCapacityCommand}from"../src/capacity/validation.ts";
import{validateForecastCommand}from"../src/forecast/validation.ts";
import{validateAutomationCommand}from"../src/automation/validation.ts";
import{validateNotificationCommand}from"../src/notification/validation.ts";
import { contextLinkCommand, conversationCommand, createMissionCommand, createReportCommand, createTaskCommand, createTimelineCommand, identityCommand, meetingCommand, missionCommand, testId } from "./fixtures.ts";

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
    validateIdentityCommand(identityCommand("CreateUser", 1, {user_id: testId(800), email: "lead@onyx.example", display_name: "Lead"}, "identity-authority:user:create", 0));
    validateContextLinkCommand(contextLinkCommand("CreateContextLink",1,{context_link_id:testId(850),source_ref:{aggregate_type:"Mission",object_id:testId(14)},target_ref:{aggregate_type:"Task",object_id:testId(400)},relation_type:"DELIVERS",strength:"NORMAL",metadata:{}},"context:create",0));
    validateMeetingCommand(meetingCommand("CreateMeeting",1,{meeting_id:testId(900),title:"Review",organizer_id:testId(800),scheduled_start_at:"2026-08-01T10:00:00.000000Z",timezone:"UTC"},"meeting:create",0));
    validateConversationCommand(conversationCommand("CreateConversation",1,{conversation_id:testId(950),title:"Room",creator_id:testId(800)},"communication:create",0));
    validateFileCommand({...conversationCommand("CreateConversation",2,{conversation_id:testId(951),title:"x",creator_id:testId(800)},"communication:create",0),command_type:"CreateFileAsset",target:{aggregate_type:"FileAsset",object_id:testId(951)},payload:{file_id:testId(951),name:"x.txt",media_type:"text/plain",owner_id:testId(800)},authority_proof:{...conversationCommand("CreateConversation",2,{conversation_id:testId(951),title:"x",creator_id:testId(800)},"communication:create",0).authority_proof,scope:["file:create"]}});
    validateApprovalCommand({...conversationCommand("CreateConversation",3,{conversation_id:testId(952),title:"x",creator_id:testId(800)},"communication:create",0),command_type:"CreateApproval",target:{aggregate_type:"Approval",object_id:testId(952)},payload:{approval_id:testId(952),title:"Review",subject_ref:{aggregate_type:"FileAsset",object_id:testId(951)},requester_id:testId(800),required_approvals:1},authority_proof:{...conversationCommand("CreateConversation",3,{conversation_id:testId(952),title:"x",creator_id:testId(800)},"communication:create",0).authority_proof,scope:["approval:create"]}});
    validateCapacityCommand({...conversationCommand("CreateConversation",4,{conversation_id:testId(953),title:"x",creator_id:testId(800)},"communication:create",0),command_type:"CreateCapacityProfile",target:{aggregate_type:"CapacityProfile",object_id:testId(953)},payload:{capacity_profile_id:testId(953),name:"Lead",resource_ref:{aggregate_type:"User",object_id:testId(800)},unit:"HOURS"},authority_proof:{...conversationCommand("CreateConversation",4,{conversation_id:testId(953),title:"x",creator_id:testId(800)},"communication:create",0).authority_proof,scope:["capacity:create"]}});
    validateForecastCommand({...conversationCommand("CreateConversation",5,{conversation_id:testId(954),title:"x",creator_id:testId(800)},"communication:create",0),command_type:"GenerateForecast",target:{aggregate_type:"Forecast",object_id:testId(954)},payload:{forecast_id:testId(954),title:"Outlook",subject_ref:{aggregate_type:"CapacityProfile",object_id:testId(953)},horizon_start:"2026-08-01T00:00:00.000000Z",horizon_end:"2026-09-01T00:00:00.000000Z",method:"LINEAR",baseline_value:1},authority_proof:{...conversationCommand("CreateConversation",5,{conversation_id:testId(954),title:"x",creator_id:testId(800)},"communication:create",0).authority_proof,scope:["forecast:generate"]}});
    validateAutomationCommand({...conversationCommand("CreateConversation",6,{conversation_id:testId(955),title:"x",creator_id:testId(800)},"communication:create",0),command_type:"CreateAutomationRule",target:{aggregate_type:"AutomationRule",object_id:testId(955)},payload:{automation_rule_id:testId(955),name:"Notify",owner_id:testId(800),trigger_type:"EVENT",trigger_expression:"TaskBlocked",action_type:"NOTIFICATION",action_config:{channel:"ops"}},authority_proof:{...conversationCommand("CreateConversation",6,{conversation_id:testId(955),title:"x",creator_id:testId(800)},"communication:create",0).authority_proof,scope:["automation:create"]}});
    validateNotificationCommand({...conversationCommand("CreateConversation",7,{conversation_id:testId(956),title:"x",creator_id:testId(800)},"communication:create",0),command_type:"CreateNotification",target:{aggregate_type:"Notification",object_id:testId(956)},payload:{notification_id:testId(956),title:"Notice",body:"Body",severity:"INFO",created_by_id:testId(800)},authority_proof:{...conversationCommand("CreateConversation",7,{conversation_id:testId(956),title:"x",creator_id:testId(800)},"communication:create",0).authority_proof,scope:["notification:create"]}});
  });

  it("rejects unknown envelope properties in every executable context", () => {
    const cases: Array<[Validator, object]> = [
      [validateCreateMissionCommand, createMissionCommand()],
      [validateCreateTaskCommand, createTaskCommand()],
      [validateCreateTimelineCommand, createTimelineCommand()],
      [validateCreateReportCommand, createReportCommand()],
      [validateIdentityCommand, identityCommand("CreateUser", 1, {user_id: testId(800), email: "lead@onyx.example", display_name: "Lead"}, "identity-authority:user:create", 0)],
      [validateContextLinkCommand, contextLinkCommand("CreateContextLink",1,{context_link_id:testId(850),source_ref:{aggregate_type:"Mission",object_id:testId(14)},target_ref:{aggregate_type:"Task",object_id:testId(400)},relation_type:"DELIVERS",strength:"NORMAL",metadata:{}},"context:create",0)],
      [validateMeetingCommand,meetingCommand("CreateMeeting",1,{meeting_id:testId(900),title:"Review",organizer_id:testId(800),scheduled_start_at:"2026-08-01T10:00:00.000000Z",timezone:"UTC"},"meeting:create",0)],
      [validateConversationCommand,conversationCommand("CreateConversation",1,{conversation_id:testId(950),title:"Room",creator_id:testId(800)},"communication:create",0)],
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
