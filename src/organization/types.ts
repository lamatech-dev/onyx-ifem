import type { CommandEnvelope, EventEnvelope, UuidV7 } from "../contracts/envelopes.ts";

export interface CreateOrganizationPayload { organization_id: UuidV7; name: string; slug: string }
export interface CreateWorkspacePayload { organization_id: UuidV7; workspace_id: UuidV7; name: string }
export interface CreateDepartmentPayload { organization_id: UuidV7; department_id: UuidV7; name: string; parent_department_id?: UuidV7 }
export interface CreateTeamPayload { organization_id: UuidV7; team_id: UuidV7; department_id: UuidV7; name: string }
export interface CreateGroupPayload { organization_id: UuidV7; group_id: UuidV7; name: string }
export interface MoveTeamPayload { organization_id: UuidV7; team_id: UuidV7; to_department_id: UuidV7; reason: string }
export interface ArchiveDepartmentPayload { organization_id: UuidV7; department_id: UuidV7; reason: string }
export interface ArchiveOrganizationPayload { organization_id: UuidV7; retention_policy_id: UuidV7 }

export type OrganizationCommand = CommandEnvelope<"CreateOrganization", CreateOrganizationPayload> |
  CommandEnvelope<"CreateWorkspace", CreateWorkspacePayload> | CommandEnvelope<"CreateDepartment", CreateDepartmentPayload> |
  CommandEnvelope<"CreateTeam", CreateTeamPayload> | CommandEnvelope<"CreateGroup", CreateGroupPayload> |
  CommandEnvelope<"MoveTeam", MoveTeamPayload> | CommandEnvelope<"ArchiveDepartment", ArchiveDepartmentPayload> |
  CommandEnvelope<"ArchiveOrganization", ArchiveOrganizationPayload>;

export type OrganizationEvent = EventEnvelope<"OrganizationCreated", CreateOrganizationPayload> |
  EventEnvelope<"WorkspaceCreated", CreateWorkspacePayload> | EventEnvelope<"DepartmentCreated", CreateDepartmentPayload> |
  EventEnvelope<"TeamCreated", CreateTeamPayload> | EventEnvelope<"GroupCreated", CreateGroupPayload> |
  EventEnvelope<"TeamMoved", {team_id: UuidV7; department_id: UuidV7}> |
  EventEnvelope<"DepartmentArchived", {department_id: UuidV7; new_status: "ARCHIVED"}> |
  EventEnvelope<"OrganizationArchived", {new_status: "ARCHIVED"}>;

export interface OrganizationStructure {
  organizationId: UuidV7; name: string; slug: string; status: "ACTIVE" | "ARCHIVED"; version: number; lifecycleEpoch: number; authorityEpoch: number;
  workspaces: Record<UuidV7, {workspaceId: UuidV7; name: string}>;
  departments: Record<UuidV7, {departmentId: UuidV7; name: string; parentDepartmentId?: UuidV7; status: "ACTIVE" | "ARCHIVED"}>;
  teams: Record<UuidV7, {teamId: UuidV7; departmentId: UuidV7; name: string}>;
  groups: Record<UuidV7, {groupId: UuidV7; name: string}>;
}

export interface OrganizationView {
  organization_id: UuidV7; name: string; slug: string; status: "ACTIVE" | "ARCHIVED"; version: number; lifecycle_epoch: number; authority_epoch: number;
  workspaces: Record<string, {workspace_id: UuidV7; name: string}>;
  departments: Record<string, {department_id: UuidV7; name: string; parent_department_id?: UuidV7; status: "ACTIVE" | "ARCHIVED"}>;
  teams: Record<string, {team_id: UuidV7; department_id: UuidV7; name: string}>;
  groups: Record<string, {group_id: UuidV7; name: string}>;
}
