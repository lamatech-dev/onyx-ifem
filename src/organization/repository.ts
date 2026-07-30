import type { OrganizationEvent, OrganizationStructure, OrganizationView } from "./types.ts";

export interface OrganizationOperationRecord { fingerprint: string; event: OrganizationEvent }
export interface OrganizationRepository {
  find(organizationId: string): Promise<OrganizationStructure | undefined>;
  list(organizationId: string, afterId: string | undefined, limit: number): Promise<OrganizationStructure[]>;
  history(organizationId: string, afterVersion?: number, limit?: number): Promise<OrganizationEvent[]>;
  findOperation(operationId: string): Promise<OrganizationOperationRecord | undefined>;
  commit(state: OrganizationStructure, event: OrganizationEvent, operationId: string, record: OrganizationOperationRecord, create: boolean): Promise<void>;
}
export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly #states = new Map<string, OrganizationStructure>(); readonly #events = new Map<string, OrganizationEvent[]>(); readonly #operations = new Map<string, OrganizationOperationRecord>();
  async find(id: string) { const value = this.#states.get(id); return value && structuredClone(value); }
  async list(organizationId: string, afterId: string | undefined, limit: number) { return [...this.#states.values()].filter((value) => value.organizationId === organizationId && (afterId === undefined || value.organizationId > afterId)).sort((a, b) => a.organizationId.localeCompare(b.organizationId)).slice(0, limit).map((value) => structuredClone(value)); }
  async history(id: string, afterVersion = 0, limit = 100) { return (this.#events.get(id) ?? []).filter((event) => event.aggregate_version > afterVersion).slice(0, limit).map((event) => structuredClone(event)); }
  async findOperation(id: string) { const value = this.#operations.get(id); return value && structuredClone(value); }
  async commit(state: OrganizationStructure, event: OrganizationEvent, operationId: string, record: OrganizationOperationRecord, create: boolean) { if (create === this.#states.has(state.organizationId)) throw new Error(create ? "organization already exists" : "organization not found"); if (this.#operations.has(operationId)) throw new Error("operation already exists"); this.#states.set(state.organizationId, structuredClone(state)); this.#events.set(state.organizationId, [...(this.#events.get(state.organizationId) ?? []), structuredClone(event)]); this.#operations.set(operationId, structuredClone(record)); }
}
export function toOrganizationView(state: OrganizationStructure): OrganizationView { return {organization_id: state.organizationId, name: state.name, slug: state.slug, status: state.status, version: state.version, lifecycle_epoch: state.lifecycleEpoch, authority_epoch: state.authorityEpoch, workspaces: Object.fromEntries(Object.entries(state.workspaces).map(([id, item]) => [id, {workspace_id: item.workspaceId, name: item.name}])), departments: Object.fromEntries(Object.entries(state.departments).map(([id, item]) => [id, {department_id: item.departmentId, name: item.name, ...(item.parentDepartmentId ? {parent_department_id: item.parentDepartmentId} : {}), status: item.status}])), teams: Object.fromEntries(Object.entries(state.teams).map(([id, item]) => [id, {team_id: item.teamId, department_id: item.departmentId, name: item.name}])), groups: Object.fromEntries(Object.entries(state.groups).map(([id, item]) => [id, {group_id: item.groupId, name: item.name}]))}; }
