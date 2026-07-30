import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { InMemoryMissionRepository } from "../src/mission/repository.ts";
import { MissionService } from "../src/mission/service.ts";
import { InMemoryWorkRepository } from "../src/work/repository.ts";
import { WorkService } from "../src/work/service.ts";
import { createMissionCommand, createTaskCommand, testId, workCommand } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");

async function fixture(): Promise<{mission: MissionService; work: WorkService}> {
  const mission = new MissionService({repository: new InMemoryMissionRepository(), now});
  await mission.execute(createMissionCommand());
  const work = new WorkService({
    repository: new InMemoryWorkRepository(),
    now,
    replicaId: "work-test",
    requireMission: async (organizationId, missionId) => {
      await mission.getMission(organizationId, missionId);
    },
  });
  return {mission, work};
}

describe("WorkService.createTask", () => {
  it("creates a task linked to an existing mission", async () => {
    const {work} = await fixture();
    const command = createTaskCommand();

    const event = await work.execute(command);

    assert.equal(event.event_type, "TaskCreated");
    assert.equal(event.aggregate.object_id, command.payload.task_id);
    assert.equal(event.payload.mission_id, command.payload.mission_id);
    assert.equal(event.vector_clock["work-test"], 1);
    assert.match(event.audit.integrity_digest, /^[0-9a-f]{64}$/);
    assert.equal((await work.getTask(testId(13), testId(400))).status, "DRAFT");
  });

  it("replays an identical operation and rejects changed reuse", async () => {
    const {work} = await fixture();
    const command = createTaskCommand();
    const first = await work.execute(command);

    assert.deepEqual(await work.execute(structuredClone(command)), first);
    await assert.rejects(
      work.execute({...command, payload: {...command.payload, title: "Changed"}}),
      (error: unknown) => error instanceof OnyxError && error.code === "IDEMPOTENCY_KEY_REUSE",
    );
  });

  it("rejects a task linked to an unknown mission", async () => {
    const {work} = await fixture();
    const command = createTaskCommand({
      payload: {...createTaskCommand().payload, mission_id: testId(999)},
    });

    await assert.rejects(
      work.execute(command),
      (error: unknown) => error instanceof OnyxError && error.code === "NOT_FOUND",
    );
  });

  it("exposes organization-scoped list and event history queries", async () => {
    const {work} = await fixture();
    await work.execute(createTaskCommand());

    assert.equal((await work.listTasks(testId(13))).length, 1);
    assert.equal((await work.listTasks(testId(999))).length, 0);
    assert.deepEqual(
      (await work.getHistory(testId(13), testId(400), 0, 10)).map((event) => event.event_type),
      ["TaskCreated"],
    );
  });

  it("executes the complete task lifecycle and preserves epoch fencing", async () => {
    const {work} = await fixture();
    await work.execute(createTaskCommand());
    const taskId = testId(400);
    const commands = [
      workCommand("AssignOwner", 1, taskId, {task_id: taskId, owner_id: testId(16), assignment_note: "New operator"}, "work:owner:assign", 1),
      workCommand("ChangePriority", 2, taskId, {task_id: taskId, priority: "CRITICAL", reason: "Mission path"}, "work:priority:change", 2),
      workCommand("StartTask", 3, taskId, {task_id: taskId, start_note: "Dependencies ready"}, "work:start", 3),
      workCommand("PauseTask", 4, taskId, {task_id: taskId, reason_code: "SHIFT", reason: "Shift handoff"}, "work:pause", 4),
      workCommand("StartTask", 5, taskId, {task_id: taskId, start_note: "New shift"}, "work:start", 5),
      workCommand("BlockTask", 6, taskId, {task_id: taskId, blocker_code: "EXTERNAL", blocker_description: "Waiting on material"}, "work:block", 6),
      workCommand("StartTask", 7, taskId, {task_id: taskId, start_note: "Material received"}, "work:start", 7),
      workCommand("SubmitCompletion", 8, taskId, {task_id: taskId, completion_summary: "Acceptance criteria met", evidence_refs: [testId(901)]}, "work:completion:submit", 8),
      workCommand("ApproveTask", 9, taskId, {task_id: taskId, approval_note: "Verified"}, "work:approve", 9),
      workCommand("CloseTask", 10, taskId, {task_id: taskId, closure_note: "Released"}, "work:close", 10),
    ];
    const events = [];
    for (const command of commands) events.push(await work.execute(command));
    const reopen = workCommand("ReopenTask", 11, taskId, {task_id: taskId, reason: "Follow-up required"}, "work:reopen", 11);
    reopen.expected_lifecycle_epoch = 1;
    events.push(await work.execute(reopen));
    const cancel = workCommand("CancelTask", 12, taskId, {task_id: taskId, reason_code: "SUPERSEDED", reason: "Follow-up moved"}, "work:cancel", 12);
    cancel.expected_lifecycle_epoch = 2;
    events.push(await work.execute(cancel));
    assert.deepEqual(events.map((event) => event.event_type), [
      "TaskOwnerAssigned", "TaskPriorityChanged", "TaskStarted", "TaskPaused", "TaskStarted", "TaskBlocked",
      "TaskStarted", "TaskCompletionSubmitted", "TaskApproved", "TaskClosed", "TaskReopened", "TaskCancelled",
    ]);
    const view = await work.getTask(testId(13), taskId);
    assert.equal(view.status, "CANCELLED"); assert.equal(view.version, 13); assert.equal(view.lifecycle_epoch, 3);
    assert.equal(view.owner_id, testId(16)); assert.equal(view.priority, "CRITICAL");
  });

  it("adds only same-mission dependencies", async () => {
    const {work} = await fixture();
    await work.execute(createTaskCommand());
    const dependentId = testId(410);
    await work.execute(createTaskCommand({
      command_id: testId(411), operation_id: testId(412), target: {aggregate_type: "Task", object_id: dependentId},
      payload: {...createTaskCommand().payload, task_id: dependentId, title: "Dependent task"},
    }));
    const event = await work.execute(workCommand("AddDependency", 20, dependentId, {task_id: dependentId, dependency_task_id: testId(400)}, "work:dependency:add", 1));
    assert.equal(event.event_type, "TaskDependencyAdded");
    assert.deepEqual((await work.getTask(testId(13), dependentId)).dependency_task_ids, [testId(400)]);
  });
});
