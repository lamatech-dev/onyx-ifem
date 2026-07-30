import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { IdentityService } from "../src/identity-authority/service.ts";
import { InMemoryIdentityRepository } from "../src/identity-authority/repository.ts";
import { identityCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z"), userId = testId(800);
describe("IdentityService", () => {
  it("executes roles, devices, delegation, and user lifecycle with epoch fencing", async () => {
    const service = new IdentityService(new InMemoryIdentityRepository(), {now, replicaId: "identity-test"});
    const commands = [
      identityCommand("CreateUser", 1, {user_id: userId, email: "LEAD@ONYX.EXAMPLE", display_name: "Operations Lead"}, "identity-authority:user:create", 0),
      identityCommand("AssignRole", 2, {user_id: userId, role_id: "operations-lead"}, "identity-authority:role:assign", 1),
      identityCommand("RevokeRole", 3, {user_id: userId, role_id: "operations-lead", reason: "Rotation"}, "identity-authority:role:revoke", 2),
      identityCommand("RegisterDevice", 4, {user_id: userId, device_id: testId(801), name: "Secure terminal", public_key_thumbprint: "a".repeat(64)}, "identity-authority:device:register", 3, 0, 1),
      identityCommand("RevokeDevice", 5, {user_id: userId, device_id: testId(801), reason: "Retired"}, "identity-authority:device:revoke", 4, 0, 1),
      identityCommand("DelegateAuthority", 6, {user_id: userId, delegation_id: testId(802), delegatee_id: testId(803), scopes: ["mission:read", "work:create"], expires_at: "2029-01-01T00:00:00.000000Z"}, "identity-authority:delegate", 5, 0, 2),
      identityCommand("RevokeDelegation", 7, {user_id: userId, delegation_id: testId(802), reason: "Assignment ended"}, "identity-authority:delegation:revoke", 6, 0, 2),
      identityCommand("DisableUser", 8, {user_id: userId, reason: "Temporary leave"}, "identity-authority:user:disable", 7, 0, 3),
      identityCommand("EnableUser", 9, {user_id: userId, reason: "Returned"}, "identity-authority:user:enable", 8, 1, 4),
    ];
    const events = []; for (const command of commands) events.push(await service.execute(command));
    assert.deepEqual(events.map((event) => event.event_type), ["UserCreated", "RoleAssigned", "RoleRevoked", "DeviceRegistered", "DeviceRevoked", "AuthorityDelegated", "DelegationRevoked", "UserDisabled", "UserEnabled"]);
    const view = await service.getUser(testId(13), userId);
    assert.equal(view.email, "lead@onyx.example"); assert.equal(view.status, "ACTIVE"); assert.equal(view.version, 9); assert.equal(view.lifecycle_epoch, 2); assert.equal(view.authority_epoch, 5);
    assert.equal(view.devices[testId(801)]?.status, "REVOKED"); assert.equal(view.delegations[testId(802)]?.status, "REVOKED");
    assert.deepEqual((await service.getHistory(testId(13), userId)).map((event) => event.aggregate_version), [1,2,3,4,5,6,7,8,9]);
  });

  it("rejects stale epochs, self delegation, and changed operation replay", async () => {
    const service = new IdentityService(new InMemoryIdentityRepository(), {now});
    const create = identityCommand("CreateUser", 20, {user_id: userId, email: "lead@onyx.example", display_name: "Lead"}, "identity-authority:user:create", 0);
    const created = await service.execute(create); assert.deepEqual(await service.execute(create), created);
    await assert.rejects(service.execute({...create, payload: {...create.payload, display_name: "Changed"}}), (error: unknown) => error instanceof OnyxError && error.code === "IDEMPOTENCY_KEY_REUSE");
    await assert.rejects(service.execute(identityCommand("DelegateAuthority", 21, {user_id: userId, delegation_id: testId(810), delegatee_id: userId, scopes: ["mission:read"], expires_at: "2029-01-01T00:00:00.000000Z"}, "identity-authority:delegate", 1)), (error: unknown) => error instanceof OnyxError && error.code === "INVALID_ARGUMENT");
    await assert.rejects(service.execute(identityCommand("AssignRole", 22, {user_id: userId, role_id: "admin"}, "identity-authority:role:assign", 2)), (error: unknown) => error instanceof OnyxError && error.code === "VERSION_CONFLICT");
    const assigned = identityCommand("AssignRole", 23, {user_id: userId, role_id: "operator"}, "identity-authority:role:assign", 1); await service.execute(assigned);
    await service.execute(identityCommand("RevokeRole", 24, {user_id: userId, role_id: "operator", reason: "Rotation"}, "identity-authority:role:revoke", 2));
    const stale = identityCommand("RegisterDevice", 25, {user_id: userId, device_id: testId(811), name: "Stale device", public_key_thumbprint: "b".repeat(64)}, "identity-authority:device:register", 3);
    delete (stale as {expected_authority_epoch?: number}).expected_authority_epoch;
    await assert.rejects(service.execute(stale), (error: unknown) => error instanceof OnyxError && error.code === "AUTHORITY_EPOCH_MISMATCH");
  });
});
