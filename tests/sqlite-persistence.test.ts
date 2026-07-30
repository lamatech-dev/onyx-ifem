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
