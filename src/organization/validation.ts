import { exactKeys, fail, object, text, uuid, validateCommandEnvelope } from "../contracts/validation.ts";
import type { OrganizationCommand } from "./types.ts";
const types: Record<OrganizationCommand["command_type"], string> = {CreateOrganization: "Organization", CreateWorkspace: "Workspace", CreateDepartment: "Department", CreateTeam: "Team", CreateGroup: "Group", MoveTeam: "Team", ArchiveDepartment: "Department", ArchiveOrganization: "Organization"};
function body(command: Record<string, any>, keys: string[], idField: string) { const payload = object(command.payload, "payload"); exactKeys(payload, keys, "payload"); uuid(payload.organization_id, "payload.organization_id"); if (command.organization_id !== payload.organization_id) fail("payload organization_id must match envelope organization_id"); uuid(payload[idField], `payload.${idField}`); if (command.target.object_id !== payload[idField]) fail(`target object must match payload ${idField}`); return payload; }
export function validateOrganizationCommand(value: unknown): asserts value is OrganizationCommand {
  const type = (value as {command_type?: string})?.command_type as OrganizationCommand["command_type"]; if (!(type in types)) fail("command is not implemented"); const command = validateCommandEnvelope(value, type, types[type]!); let payload: Record<string, any>;
  switch (type) {
    case "CreateOrganization": payload = body(command, ["organization_id", "name", "slug"], "organization_id"); text(payload.name, "payload.name", 200); if (typeof payload.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)) fail("payload.slug is invalid"); return;
    case "CreateWorkspace": payload = body(command, ["organization_id", "workspace_id", "name"], "workspace_id"); text(payload.name, "payload.name", 200); return;
    case "CreateDepartment": payload = body(command, ["organization_id", "department_id", "name", "parent_department_id"], "department_id"); text(payload.name, "payload.name", 200); if (payload.parent_department_id !== undefined) uuid(payload.parent_department_id, "payload.parent_department_id"); return;
    case "CreateTeam": payload = body(command, ["organization_id", "team_id", "department_id", "name"], "team_id"); uuid(payload.department_id, "payload.department_id"); text(payload.name, "payload.name", 200); return;
    case "CreateGroup": payload = body(command, ["organization_id", "group_id", "name"], "group_id"); text(payload.name, "payload.name", 200); return;
    case "MoveTeam": payload = body(command, ["organization_id", "team_id", "to_department_id", "reason"], "team_id"); uuid(payload.to_department_id, "payload.to_department_id"); text(payload.reason, "payload.reason", 2000); return;
    case "ArchiveDepartment": payload = body(command, ["organization_id", "department_id", "reason"], "department_id"); text(payload.reason, "payload.reason", 2000); return;
    case "ArchiveOrganization": payload = body(command, ["organization_id", "retention_policy_id"], "organization_id"); uuid(payload.retention_policy_id, "payload.retention_policy_id"); return;
  }
}
