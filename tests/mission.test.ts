import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { InMemoryMissionRepository } from "../src/mission/repository.ts";
import { MissionService } from "../src/mission/service.ts";
import { createMissionCommand } from "./fixtures.ts";

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

