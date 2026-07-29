import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { InMemoryMissionRepository } from "../src/mission/repository.ts";
import { MissionService } from "../src/mission/service.ts";
import { InMemoryWorkRepository } from "../src/work/repository.ts";
import { WorkService } from "../src/work/service.ts";
import { createMissionCommand, createTaskCommand, testId } from "./fixtures.ts";

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

  it("rejects lifecycle commands whose payload contracts remain open", async () => {
    const {work} = await fixture();

    await assert.rejects(
      work.execute({command_type: "StartTask"}),
      (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT",
    );
  });
});
