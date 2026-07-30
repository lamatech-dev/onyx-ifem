import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../src/infrastructure/sqlite/database.ts";
import { MissionService } from "../src/mission/service.ts";
import { SqliteMissionRepository } from "../src/mission/sqlite-repository.ts";
import { OrganizationService } from "../src/organization/service.ts";
import { SqliteOrganizationRepository } from "../src/organization/sqlite-repository.ts";
import { IdentityService } from "../src/identity-authority/service.ts";
import { SqliteIdentityRepository } from "../src/identity-authority/sqlite-repository.ts";
import { ContextLinkService } from "../src/context-link/service.ts";
import { SqliteContextLinkRepository } from "../src/context-link/sqlite-repository.ts";
import{MeetingService}from"../src/meeting/service.ts";import{SqliteMeetingRepository}from"../src/meeting/sqlite-repository.ts";
import{ConversationService}from"../src/conversation/service.ts";import{SqliteConversationRepository}from"../src/conversation/sqlite-repository.ts";
import{ApprovalService}from"../src/approval/service.ts";import{SqliteApprovalRepository}from"../src/approval/sqlite-repository.ts";
import{CapacityService}from"../src/capacity/service.ts";import{SqliteCapacityRepository}from"../src/capacity/sqlite-repository.ts";
import{ForecastService}from"../src/forecast/service.ts";import{SqliteForecastRepository}from"../src/forecast/sqlite-repository.ts";
import{AutomationService}from"../src/automation/service.ts";import{SqliteAutomationRepository}from"../src/automation/sqlite-repository.ts";
import{NotificationService}from"../src/notification/service.ts";import{SqliteNotificationRepository}from"../src/notification/sqlite-repository.ts";
import{SynchronizationService}from"../src/synchronization/service.ts";import{SqliteSynchronizationRepository}from"../src/synchronization/sqlite-repository.ts";
import{AuditService}from"../src/audit/service.ts";import{SqliteAuditRepository}from"../src/audit/sqlite-repository.ts";
import { ReportingService } from "../src/reporting-evidence/service.ts";
import { SqliteReportingRepository } from "../src/reporting-evidence/sqlite-repository.ts";
import { TimelineService } from "../src/timeline/service.ts";
import { SqliteTimelineRepository } from "../src/timeline/sqlite-repository.ts";
import { WorkService } from "../src/work/service.ts";
import { SqliteWorkRepository } from "../src/work/sqlite-repository.ts";
import { contextLinkCommand, conversationCommand, createMissionCommand, createReportCommand, createTaskCommand, createTimelineCommand, identityCommand, meetingCommand, missionCommand, organizationCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");

describe("SQLite persistence", () => {
  it("rolls back the aggregate and operation when an event insert fails", async () => {
    const database = new SqliteDatabase(":memory:");
    const eventId = testId(900);
    database.commit({
      context: "test",
      aggregateId: "aggregate-1",
      organizationId: "organization-1",
      version: 1,
      state: {value: "committed"},
      eventId,
      eventVersion: 1,
      event: {event_id: eventId},
      operationId: "operation-1",
      fingerprint: "fingerprint-1",
      create: true,
    });

    assert.throws(() => database.commit({
      context: "test",
      aggregateId: "aggregate-2",
      organizationId: "organization-1",
      version: 1,
      state: {value: "must-roll-back"},
      eventId,
      eventVersion: 1,
      event: {event_id: eventId},
      operationId: "operation-2",
      fingerprint: "fingerprint-2",
      create: true,
    }));
    assert.equal(database.getState("test", "aggregate-2"), undefined);
    assert.equal(database.getOperation("test", "operation-2"), undefined);
    database.close();
  });

  it("restores Mission state, events, and idempotency after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-mission-"));
    const path = join(directory, "onyx.db");
    try {
      const firstDatabase = new SqliteDatabase(path);
      const firstService = new MissionService({repository: new SqliteMissionRepository(firstDatabase), now});
      const create = createMissionCommand();
      const created = await firstService.execute(create);
      await firstService.execute(missionCommand(
        "CancelMission",
        50,
        {mission_id: testId(14), reason_code: "TEST", reason: "Verify persistence"},
        "mission:cancel",
        1,
      ));
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const secondService = new MissionService({repository: new SqliteMissionRepository(secondDatabase), now});
      assert.equal((await secondService.getMission(testId(13), testId(14))).status, "CANCELLED");
      assert.deepEqual((await secondService.getHistory(testId(13), testId(14))).map((event) => event.aggregate_version), [1, 2]);
      assert.deepEqual(await secondService.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("restores Tasks and preserves the Mission reference across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-work-"));
    const path = join(directory, "onyx.db");
    try {
      const firstDatabase = new SqliteDatabase(path);
      const mission = new MissionService({repository: new SqliteMissionRepository(firstDatabase), now});
      await mission.execute(createMissionCommand());
      const work = new WorkService({
        repository: new SqliteWorkRepository(firstDatabase),
        now,
        requireMission: async (organizationId, missionId) => {
          await mission.getMission(organizationId, missionId);
        },
      });
      const create = createTaskCommand();
      const created = await work.execute(create);
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const restoredMission = new MissionService({repository: new SqliteMissionRepository(secondDatabase), now});
      const restoredWork = new WorkService({
        repository: new SqliteWorkRepository(secondDatabase),
        now,
        requireMission: async (organizationId, missionId) => {
          await restoredMission.getMission(organizationId, missionId);
        },
      });
      assert.equal((await restoredWork.getTask(testId(13), testId(400))).mission_id, testId(14));
      assert.deepEqual(await restoredWork.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("restores Timelines, history, and idempotency after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-timeline-"));
    const path = join(directory, "onyx.db");
    try {
      const firstDatabase = new SqliteDatabase(path);
      const firstMission = new MissionService({repository: new SqliteMissionRepository(firstDatabase), now});
      await firstMission.execute(createMissionCommand());
      const firstTimeline = new TimelineService({
        repository: new SqliteTimelineRepository(firstDatabase),
        now,
        requireSubject: async (organizationId, subject) => {
          await firstMission.getMission(organizationId, subject.object_id);
        },
      });
      const create = createTimelineCommand();
      const created = await firstTimeline.execute(create);
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const secondMission = new MissionService({repository: new SqliteMissionRepository(secondDatabase), now});
      const secondTimeline = new TimelineService({
        repository: new SqliteTimelineRepository(secondDatabase),
        now,
        requireSubject: async (organizationId, subject) => {
          await secondMission.getMission(organizationId, subject.object_id);
        },
      });
      assert.equal((await secondTimeline.getTimeline(testId(13), testId(500))).timezone, "Asia/Tehran");
      assert.deepEqual((await secondTimeline.getHistory(testId(13), testId(500))).map((event) => event.event_type), ["TimelineCreated"]);
      assert.deepEqual(await secondTimeline.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("restores Reports, history, and idempotency after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-reporting-"));
    const path = join(directory, "onyx.db");
    try {
      const firstDatabase = new SqliteDatabase(path);
      const firstMission = new MissionService({repository: new SqliteMissionRepository(firstDatabase), now});
      await firstMission.execute(createMissionCommand());
      const firstReporting = new ReportingService({
        repository: new SqliteReportingRepository(firstDatabase),
        now,
        requireSubject: async (organizationId, subject) => {
          await firstMission.getMission(organizationId, subject.object_id);
        },
      });
      const create = createReportCommand();
      const created = await firstReporting.execute(create);
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const secondMission = new MissionService({repository: new SqliteMissionRepository(secondDatabase), now});
      const secondReporting = new ReportingService({
        repository: new SqliteReportingRepository(secondDatabase),
        now,
        requireSubject: async (organizationId, subject) => {
          await secondMission.getMission(organizationId, subject.object_id);
        },
      });
      assert.equal((await secondReporting.getReport(testId(13), testId(600))).title, "Mission status report");
      assert.deepEqual((await secondReporting.getHistory(testId(13), testId(600))).map((event) => event.event_type), ["ReportCreated"]);
      assert.deepEqual(await secondReporting.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("restores the Organization hierarchy, history, and idempotency after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-organization-"));
    const path = join(directory, "onyx.db"), organizationId = testId(13), departmentId = testId(720);
    const create = organizationCommand("CreateOrganization", 720, "Organization", organizationId, {organization_id: organizationId, name: "ONYX Labs", slug: "onyx-labs"}, "organization:create", 0);
    try {
      const firstDatabase = new SqliteDatabase(path);
      const firstService = new OrganizationService(new SqliteOrganizationRepository(firstDatabase), {now});
      const created = await firstService.execute(create);
      await firstService.execute(organizationCommand("CreateDepartment", 721, "Department", departmentId, {organization_id: organizationId, department_id: departmentId, name: "Operations"}, "organization:department:create", 1));
      firstDatabase.close();

      const secondDatabase = new SqliteDatabase(path);
      const restored = new OrganizationService(new SqliteOrganizationRepository(secondDatabase), {now});
      const view = await restored.getOrganization(organizationId);
      assert.equal(view.departments[departmentId]?.name, "Operations");
      assert.deepEqual((await restored.getHistory(organizationId)).map((event) => event.event_type), ["OrganizationCreated", "DepartmentCreated"]);
      assert.deepEqual(await restored.execute(create), created);
      secondDatabase.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("restores Identity authority state, history, and idempotency after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-identity-"));
    const path = join(directory, "onyx.db"), userId = testId(800);
    const create = identityCommand("CreateUser", 760, {user_id: userId, email: "lead@onyx.example", display_name: "Lead"}, "identity-authority:user:create", 0);
    try {
      const firstDatabase = new SqliteDatabase(path), first = new IdentityService(new SqliteIdentityRepository(firstDatabase), {now});
      const created = await first.execute(create);
      await first.execute(identityCommand("AssignRole", 761, {user_id: userId, role_id: "operator"}, "identity-authority:role:assign", 1));
      firstDatabase.close();
      const secondDatabase = new SqliteDatabase(path), restored = new IdentityService(new SqliteIdentityRepository(secondDatabase), {now});
      assert.equal((await restored.getUser(testId(13), userId)).roles.operator?.role_id, "operator");
      assert.deepEqual((await restored.getHistory(testId(13), userId)).map((event) => event.event_type), ["UserCreated", "RoleAssigned"]);
      assert.deepEqual(await restored.execute(create), created);
      secondDatabase.close();
    } finally { await rm(directory, {recursive: true, force: true}); }
  });

  it("restores Context Links, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-context-")),path=join(directory,"onyx.db"),id=testId(850);const create=contextLinkCommand("CreateContextLink",780,{context_link_id:id,source_ref:{aggregate_type:"Mission",object_id:testId(14)},target_ref:{aggregate_type:"Task",object_id:testId(400)},relation_type:"DELIVERS",strength:"STRONG",metadata:{origin:"persistence"}},"context:create",0);try{const firstDatabase=new SqliteDatabase(path),first=new ContextLinkService({repository:new SqliteContextLinkRepository(firstDatabase),now,requireObject:async()=>undefined});const created=await first.execute(create);await first.execute(contextLinkCommand("UpdateContextMetadata",781,{context_link_id:id,metadata:{origin:"restored"}},"context:metadata:update",1));firstDatabase.close();const secondDatabase=new SqliteDatabase(path),restored=new ContextLinkService({repository:new SqliteContextLinkRepository(secondDatabase),now,requireObject:async()=>undefined});assert.equal((await restored.getContextLink(testId(13),id)).metadata.origin,"restored");assert.deepEqual((await restored.getHistory(testId(13),id)).map((event)=>event.event_type),["ContextLinkCreated","ContextMetadataUpdated"]);assert.deepEqual(await restored.execute(create),created);secondDatabase.close();}finally{await rm(directory,{recursive:true,force:true});}});

  it("restores Meetings, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-meeting-")),path=join(directory,"onyx.db"),id=testId(900),create=meetingCommand("CreateMeeting",790,{meeting_id:id,title:"Review",organizer_id:testId(800),scheduled_start_at:"2026-08-01T10:00:00.000000Z",timezone:"UTC"},"meeting:create",0);try{const firstDatabase=new SqliteDatabase(path),first=new MeetingService({repository:new SqliteMeetingRepository(firstDatabase),now,requireUser:async()=>undefined}),created=await first.execute(create);await first.execute(meetingCommand("StartMeeting",791,{meeting_id:id,started_at:"2026-08-01T10:00:00.000000Z"},"meeting:start",1));firstDatabase.close();const secondDatabase=new SqliteDatabase(path),restored=new MeetingService({repository:new SqliteMeetingRepository(secondDatabase),now,requireUser:async()=>undefined});assert.equal((await restored.getMeeting(testId(13),id)).status,"IN_PROGRESS");assert.deepEqual((await restored.getHistory(testId(13),id)).map(event=>event.event_type),["MeetingCreated","MeetingStarted"]);assert.deepEqual(await restored.execute(create),created);secondDatabase.close()}finally{await rm(directory,{recursive:true,force:true})}});

  it("restores Conversations, messages, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-conversation-")),path=join(directory,"onyx.db"),id=testId(950),create=conversationCommand("CreateConversation",795,{conversation_id:id,title:"Room",creator_id:testId(800)},"communication:create",0);try{const firstDatabase=new SqliteDatabase(path),first=new ConversationService({repository:new SqliteConversationRepository(firstDatabase),now,requireUser:async()=>undefined,requireTopic:async()=>undefined}),created=await first.execute(create);await first.execute(conversationCommand("PostMessage",796,{conversation_id:id,message_id:testId(951),author_id:testId(800),body:"Durable message"},"communication:message:post",1));firstDatabase.close();const secondDatabase=new SqliteDatabase(path),restored=new ConversationService({repository:new SqliteConversationRepository(secondDatabase),now,requireUser:async()=>undefined,requireTopic:async()=>undefined});assert.equal((await restored.getConversation(testId(13),id)).messages[testId(951)]?.body,"Durable message");assert.deepEqual((await restored.getHistory(testId(13),id)).map(event=>event.event_type),["ConversationCreated","MessagePosted"]);assert.deepEqual(await restored.execute(create),created);secondDatabase.close()}finally{await rm(directory,{recursive:true,force:true})}});
  it("restores Approvals, assignments, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-approval-")),path=join(directory,"onyx.db"),id=testId(980),base=conversationCommand("CreateConversation",797,{conversation_id:id,title:"x",creator_id:testId(800)},"communication:create",0),create={...base,command_type:"CreateApproval",target:{aggregate_type:"Approval",object_id:id},payload:{approval_id:id,title:"Durable approval",subject_ref:{aggregate_type:"Mission",object_id:testId(14)},requester_id:testId(800),required_approvals:1},authority_proof:{...base.authority_proof,scope:["approval:create"]}};try{const firstDatabase=new SqliteDatabase(path),first=new ApprovalService({repository:new SqliteApprovalRepository(firstDatabase),now,requireUser:async()=>undefined,requireSubject:async()=>undefined}),created=await first.execute(create);const assigned={...create,command_id:testId(798),operation_id:testId(799),command_type:"AssignApprover",expected_version:1,payload:{approval_id:id,approver_id:testId(801),role:"REVIEWER"},authority_proof:{...create.authority_proof,scope:["approval:approver:assign"]}};await first.execute(assigned);firstDatabase.close();const secondDatabase=new SqliteDatabase(path),restored=new ApprovalService({repository:new SqliteApprovalRepository(secondDatabase),now,requireUser:async()=>undefined,requireSubject:async()=>undefined});assert.equal((await restored.getApproval(testId(13),id)).approvers[testId(801)]?.role,"REVIEWER");assert.deepEqual((await restored.getHistory(testId(13),id)).map(event=>event.event_type),["ApprovalCreated","ApproverAssigned"]);assert.deepEqual(await restored.execute(create),created);secondDatabase.close()}finally{await rm(directory,{recursive:true,force:true})}});
  it("restores Capacity totals, snapshots, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-capacity-")),path=join(directory,"onyx.db"),id=testId(981),base=conversationCommand("CreateConversation",800,{conversation_id:id,title:"x",creator_id:testId(800)},"communication:create",0),create={...base,command_type:"CreateCapacityProfile",target:{aggregate_type:"CapacityProfile",object_id:id},payload:{capacity_profile_id:id,name:"Durable capacity",resource_ref:{aggregate_type:"User",object_id:testId(800)},unit:"HOURS"},authority_proof:{...base.authority_proof,scope:["capacity:create"]}};try{const firstDatabase=new SqliteDatabase(path),first=new CapacityService({repository:new SqliteCapacityRepository(firstDatabase),now,requireResource:async()=>undefined,requireWork:async()=>undefined}),created=await first.execute(create),availability={...create,command_id:testId(802),operation_id:testId(803),command_type:"UpdateAvailability",expected_version:1,payload:{capacity_profile_id:id,period_start:"2026-08-01T00:00:00.000000Z",period_end:"2026-08-02T00:00:00.000000Z",available_units:8},authority_proof:{...create.authority_proof,scope:["capacity:availability:update"]}};await first.execute(availability);firstDatabase.close();const secondDatabase=new SqliteDatabase(path),restored=new CapacityService({repository:new SqliteCapacityRepository(secondDatabase),now,requireResource:async()=>undefined,requireWork:async()=>undefined});assert.equal((await restored.getCapacityProfile(testId(13),id)).totals.available_units,8);assert.deepEqual((await restored.getHistory(testId(13),id)).map(event=>event.event_type),["CapacityProfileCreated","AvailabilityUpdated"]);assert.deepEqual(await restored.execute(create),created);secondDatabase.close()}finally{await rm(directory,{recursive:true,force:true})}});
  it("restores Forecast scenarios, projection, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-forecast-")),path=join(directory,"onyx.db"),id=testId(982),base=conversationCommand("CreateConversation",804,{conversation_id:id,title:"x",creator_id:testId(800)},"communication:create",0),create={...base,command_type:"GenerateForecast",target:{aggregate_type:"Forecast",object_id:id},payload:{forecast_id:id,title:"Durable forecast",subject_ref:{aggregate_type:"Mission",object_id:testId(14)},horizon_start:"2026-08-01T00:00:00.000000Z",horizon_end:"2026-09-01T00:00:00.000000Z",method:"LINEAR",baseline_value:10},authority_proof:{...base.authority_proof,scope:["forecast:generate"]}};try{const firstDatabase=new SqliteDatabase(path),first=new ForecastService({repository:new SqliteForecastRepository(firstDatabase),now,requireSubject:async()=>undefined}),created=await first.execute(create),scenario={...create,command_id:testId(805),operation_id:testId(806),command_type:"CreateScenario",expected_version:1,payload:{forecast_id:id,scenario_id:testId(983),name:"Upside",probability:1,adjustments:{gain:5}},authority_proof:{...create.authority_proof,scope:["forecast:scenario:create"]}};await first.execute(scenario);firstDatabase.close();const secondDatabase=new SqliteDatabase(path),restored=new ForecastService({repository:new SqliteForecastRepository(secondDatabase),now,requireSubject:async()=>undefined});assert.equal((await restored.getForecast(testId(13),id)).scenarios[testId(983)]?.projected_value,15);assert.deepEqual((await restored.getHistory(testId(13),id)).map(event=>event.event_type),["ForecastGenerated","ScenarioCreated"]);assert.deepEqual(await restored.execute(create),created);secondDatabase.close()}finally{await rm(directory,{recursive:true,force:true})}});
  it("restores Automation state, evaluations, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-automation-")),path=join(directory,"onyx.db"),id=testId(984),base=conversationCommand("CreateConversation",807,{conversation_id:id,title:"x",creator_id:testId(800)},"communication:create",0),create={...base,command_type:"CreateAutomationRule",target:{aggregate_type:"AutomationRule",object_id:id},payload:{automation_rule_id:id,name:"Durable rule",owner_id:testId(800),trigger_type:"MANUAL",trigger_expression:"manual",action_type:"COMMAND",action_config:{command:"x"}},authority_proof:{...base.authority_proof,scope:["automation:create"]}};try{const firstDatabase=new SqliteDatabase(path),first=new AutomationService({repository:new SqliteAutomationRepository(firstDatabase),now,requireOwner:async()=>undefined}),created=await first.execute(create),enable={...create,command_id:testId(808),operation_id:testId(809),command_type:"EnableRule",expected_version:1,payload:{automation_rule_id:id,reason:"ready"},authority_proof:{...create.authority_proof,scope:["automation:enable"]}};await first.execute(enable);firstDatabase.close();const secondDatabase=new SqliteDatabase(path),restored=new AutomationService({repository:new SqliteAutomationRepository(secondDatabase),now,requireOwner:async()=>undefined});assert.equal((await restored.getAutomationRule(testId(13),id)).status,"ENABLED");assert.deepEqual((await restored.getHistory(testId(13),id)).map(event=>event.event_type),["AutomationRuleCreated","AutomationRuleEnabled"]);assert.deepEqual(await restored.execute(create),created);secondDatabase.close()}finally{await rm(directory,{recursive:true,force:true})}});
  it("restores Notification recipients, deliveries, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-notification-")),path=join(directory,"onyx.db"),id=testId(986),base=conversationCommand("CreateConversation",810,{conversation_id:id,title:"x",creator_id:testId(800)},"communication:create",0),create={...base,command_type:"CreateNotification",target:{aggregate_type:"Notification",object_id:id},payload:{notification_id:id,title:"Durable notice",body:"Body",severity:"INFO",created_by_id:testId(800)},authority_proof:{...base.authority_proof,scope:["notification:create"]}};try{const firstDatabase=new SqliteDatabase(path),first=new NotificationService({repository:new SqliteNotificationRepository(firstDatabase),now,requireUser:async()=>undefined,requireSource:async()=>undefined}),created=await first.execute(create),resolve={...create,command_id:testId(811),operation_id:testId(812),command_type:"ResolveRecipients",expected_version:1,payload:{notification_id:id,recipient_ids:[testId(801)],channels:["IN_APP"]},authority_proof:{...create.authority_proof,scope:["notification:recipients:resolve"]}};await first.execute(resolve);firstDatabase.close();const secondDatabase=new SqliteDatabase(path),restored=new NotificationService({repository:new SqliteNotificationRepository(secondDatabase),now,requireUser:async()=>undefined,requireSource:async()=>undefined});assert.equal((await restored.getNotification(testId(13),id)).recipients[testId(801)]?.channels[0],"IN_APP");assert.deepEqual((await restored.getHistory(testId(13),id)).map(event=>event.event_type),["NotificationCreated","RecipientsResolved"]);assert.deepEqual(await restored.execute(create),created);secondDatabase.close()}finally{await rm(directory,{recursive:true,force:true})}});
  it("restores Synchronization batches, clocks, history, and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-synchronization-")),path=join(directory,"onyx.db"),id=testId(987),base=conversationCommand("CreateConversation",820,{conversation_id:id,title:"x",creator_id:testId(800)},"communication:create",0),start={...base,command_type:"StartSynchronization",target:{aggregate_type:"Synchronization",object_id:id},payload:{synchronization_id:id,subject_ref:{aggregate_type:"Task",object_id:testId(400)},source_replica_id:"local",target_replica_id:"remote",base_vector_clock:{local:1}},authority_proof:{...base.authority_proof,scope:["synchronization:start"]}};try{const db1=new SqliteDatabase(path),first=new SynchronizationService({repository:new SqliteSynchronizationRepository(db1),now,requireUser:async()=>undefined,requireSubject:async()=>undefined}),created=await first.execute(start),offer={...start,command_id:testId(821),operation_id:testId(822),command_type:"OfferOperationBatch",expected_version:1,payload:{synchronization_id:id,batch_id:testId(988),operation_ids:[testId(989)],offered_vector_clock:{local:2}},authority_proof:{...start.authority_proof,scope:["synchronization:batch:offer"]}};await first.execute(offer);db1.close();const db2=new SqliteDatabase(path),restored=new SynchronizationService({repository:new SqliteSynchronizationRepository(db2),now,requireUser:async()=>undefined,requireSubject:async()=>undefined});assert.equal((await restored.getSynchronization(testId(13),id)).batches[testId(988)]?.status,"OFFERED");assert.deepEqual((await restored.getHistory(testId(13),id)).map(e=>e.event_type),["SynchronizationStarted","OperationBatchOffered"]);assert.deepEqual(await restored.execute(start),created);db2.close()}finally{await rm(directory,{recursive:true,force:true})}});
  it("restores Audit entries and idempotency after restart",async()=>{const directory=await mkdtemp(join(tmpdir(),"onyx-sqlite-audit-")),path=join(directory,"onyx.db"),id=testId(991),base=conversationCommand("CreateConversation",830,{conversation_id:id,title:"x",creator_id:testId(800)},"communication:create",0),append={...base,command_type:"AppendAuditEntry",target:{aggregate_type:"AuditPartition",object_id:id},payload:{audit_partition_id:id,entry_id:testId(992),subject_ref:{aggregate_type:"Task",object_id:testId(400)},action:"Created",actor_id:testId(800),occurred_at:"2026-07-29T20:00:00.000000Z",integrity_digest:"a".repeat(64)},authority_proof:{...base.authority_proof,scope:["audit:entry:append"]}};try{const db1=new SqliteDatabase(path),first=new AuditService(new SqliteAuditRepository(db1),{now}),created=await first.execute(append);db1.close();const db2=new SqliteDatabase(path),restored=new AuditService(new SqliteAuditRepository(db2),{now});assert.equal((await restored.getAuditPartition(testId(13),id)).entries.length,1);assert.deepEqual(await restored.execute(append),created);db2.close()}finally{await rm(directory,{recursive:true,force:true})}});

  it("fails closed when stored event content or row metadata is corrupted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-sqlite-integrity-"));
    const path = join(directory, "onyx.db");
    try {
      const command = createMissionCommand();
      const initial = new SqliteDatabase(path);
      const service = new MissionService({repository: new SqliteMissionRepository(initial), now});
      const event = await service.execute(command);
      initial.close();

      const raw = new DatabaseSync(path);
      raw.exec(`
        UPDATE onyx_events
        SET event_json = json_set(event_json, '$.payload.objective', 'corrupted');
        UPDATE onyx_operations
        SET event_json = json_set(event_json, '$.payload.objective', 'corrupted');
        UPDATE onyx_outbox
        SET event_type = 'MissionPaused';
      `);
      raw.close();

      const corrupted = new SqliteDatabase(path);
      const restored = new MissionService({repository: new SqliteMissionRepository(corrupted), now});
      await assert.rejects(restored.getHistory(testId(13), testId(14)), /stored event failed integrity validation/);
      await assert.rejects(restored.execute(command), /stored event failed integrity validation/);
      assert.throws(
        () => corrupted.getOutboxMessage(event.event_id),
        /stored event failed integrity validation/,
      );
      assert.throws(
        () => corrupted.claimOutbox({workerId: "worker-a", now: new Date("2030-01-01"), leaseDurationMs: 1_000, limit: 1}),
        /stored event failed integrity validation/,
      );
      corrupted.close();

      const verifyLease = new DatabaseSync(path, {readOnly: true});
      const attempt = verifyLease.prepare("SELECT attempt_count FROM onyx_outbox").get() as {attempt_count: number};
      assert.equal(attempt.attempt_count, 0);
      verifyLease.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
