import type { IdentityEvent, UserIdentity, UserIdentityView } from "./types.ts";

export interface IdentityOperationRecord { fingerprint: string; event: IdentityEvent }
export interface IdentityRepository {
  find(userId: string): Promise<UserIdentity | undefined>;
  list(organizationId: string, afterId: string | undefined, limit: number): Promise<UserIdentity[]>;
  history(userId: string, afterVersion?: number, limit?: number): Promise<IdentityEvent[]>;
  findOperation(operationId: string): Promise<IdentityOperationRecord | undefined>;
  commit(state: UserIdentity, event: IdentityEvent, operationId: string, record: IdentityOperationRecord, create: boolean): Promise<void>;
}
export class InMemoryIdentityRepository implements IdentityRepository {
  readonly #states = new Map<string, UserIdentity>(); readonly #events = new Map<string, IdentityEvent[]>(); readonly #operations = new Map<string, IdentityOperationRecord>();
  async find(id: string) { const value = this.#states.get(id); return value && structuredClone(value); }
  async list(organizationId: string, afterId: string | undefined, limit: number) { return [...this.#states.values()].filter((value) => value.organizationId === organizationId && (afterId === undefined || value.userId > afterId)).sort((a, b) => a.userId.localeCompare(b.userId)).slice(0, limit).map((value) => structuredClone(value)); }
  async history(id: string, afterVersion = 0, limit = 100) { return (this.#events.get(id) ?? []).filter((event) => event.aggregate_version > afterVersion).slice(0, limit).map((event) => structuredClone(event)); }
  async findOperation(id: string) { const value = this.#operations.get(id); return value && structuredClone(value); }
  async commit(state: UserIdentity, event: IdentityEvent, operationId: string, record: IdentityOperationRecord, create: boolean) { if (create === this.#states.has(state.userId)) throw new Error(create ? "user already exists" : "user not found"); if (this.#operations.has(operationId)) throw new Error("operation already exists"); this.#states.set(state.userId, structuredClone(state)); this.#events.set(state.userId, [...(this.#events.get(state.userId) ?? []), structuredClone(event)]); this.#operations.set(operationId, structuredClone(record)); }
}
export function toUserIdentityView(state: UserIdentity): UserIdentityView { return {user_id: state.userId, organization_id: state.organizationId, email: state.email, display_name: state.displayName, status: state.status, version: state.version, lifecycle_epoch: state.lifecycleEpoch, authority_epoch: state.authorityEpoch, roles: Object.fromEntries(Object.entries(state.roles).map(([id, item]) => [id, {role_id: item.roleId, assigned_at: item.assignedAt}])), devices: Object.fromEntries(Object.entries(state.devices).map(([id, item]) => [id, {device_id: item.deviceId, name: item.name, public_key_thumbprint: item.publicKeyThumbprint, status: item.status}])), delegations: Object.fromEntries(Object.entries(state.delegations).map(([id, item]) => [id, {delegation_id: item.delegationId, delegatee_id: item.delegateeId, scopes: [...item.scopes], expires_at: item.expiresAt, status: item.status}]))}; }
