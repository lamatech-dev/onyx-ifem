import type { CommandEnvelope, EventEnvelope, UuidV7 } from "../contracts/envelopes.ts";

export interface CreateUserPayload { user_id: UuidV7; email: string; display_name: string }
export interface AssignRolePayload { user_id: UuidV7; role_id: string }
export interface RevokeRolePayload { user_id: UuidV7; role_id: string; reason: string }
export interface RegisterDevicePayload { user_id: UuidV7; device_id: UuidV7; name: string; public_key_thumbprint: string }
export interface RevokeDevicePayload { user_id: UuidV7; device_id: UuidV7; reason: string }
export interface DelegateAuthorityPayload { user_id: UuidV7; delegation_id: UuidV7; delegatee_id: UuidV7; scopes: string[]; expires_at: string }
export interface RevokeDelegationPayload { user_id: UuidV7; delegation_id: UuidV7; reason: string }
export interface DisableUserPayload { user_id: UuidV7; reason: string }
export interface EnableUserPayload { user_id: UuidV7; reason: string }

export type IdentityCommand = CommandEnvelope<"CreateUser", CreateUserPayload> |
  CommandEnvelope<"AssignRole", AssignRolePayload> | CommandEnvelope<"RevokeRole", RevokeRolePayload> |
  CommandEnvelope<"RegisterDevice", RegisterDevicePayload> | CommandEnvelope<"RevokeDevice", RevokeDevicePayload> |
  CommandEnvelope<"DelegateAuthority", DelegateAuthorityPayload> | CommandEnvelope<"RevokeDelegation", RevokeDelegationPayload> |
  CommandEnvelope<"DisableUser", DisableUserPayload> | CommandEnvelope<"EnableUser", EnableUserPayload>;

export type IdentityEvent = EventEnvelope<"UserCreated", CreateUserPayload> |
  EventEnvelope<"RoleAssigned", AssignRolePayload> | EventEnvelope<"RoleRevoked", RevokeRolePayload> |
  EventEnvelope<"DeviceRegistered", RegisterDevicePayload> | EventEnvelope<"DeviceRevoked", RevokeDevicePayload> |
  EventEnvelope<"AuthorityDelegated", DelegateAuthorityPayload> | EventEnvelope<"DelegationRevoked", RevokeDelegationPayload> |
  EventEnvelope<"UserDisabled", DisableUserPayload> | EventEnvelope<"UserEnabled", EnableUserPayload>;

export interface UserIdentity {
  userId: UuidV7; organizationId: UuidV7; email: string; displayName: string; status: "ACTIVE" | "DISABLED";
  version: number; lifecycleEpoch: number; authorityEpoch: number;
  roles: Record<string, {roleId: string; assignedAt: string}>;
  devices: Record<UuidV7, {deviceId: UuidV7; name: string; publicKeyThumbprint: string; status: "ACTIVE" | "REVOKED"}>;
  delegations: Record<UuidV7, {delegationId: UuidV7; delegateeId: UuidV7; scopes: string[]; expiresAt: string; status: "ACTIVE" | "REVOKED"}>;
}

export interface UserIdentityView {
  user_id: UuidV7; organization_id: UuidV7; email: string; display_name: string; status: "ACTIVE" | "DISABLED";
  version: number; lifecycle_epoch: number; authority_epoch: number;
  roles: Record<string, {role_id: string; assigned_at: string}>;
  devices: Record<string, {device_id: UuidV7; name: string; public_key_thumbprint: string; status: "ACTIVE" | "REVOKED"}>;
  delegations: Record<string, {delegation_id: UuidV7; delegatee_id: UuidV7; scopes: string[]; expires_at: string; status: "ACTIVE" | "REVOKED"}>;
}
