import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OnyxError } from "../src/contracts/errors.ts";
import { InMemoryOrganizationRepository } from "../src/organization/repository.ts";
import { OrganizationService } from "../src/organization/service.ts";
import { organizationCommand, testId } from "./fixtures.ts";
const now = () => new Date("2026-07-29T20:00:01.000Z"), org = testId(13);
describe("OrganizationService", () => {
  it("builds, moves, and archives an organization hierarchy", async () => {
    const service = new OrganizationService(new InMemoryOrganizationRepository(), {now, replicaId: "organization-test"});
    const commands = [
      organizationCommand("CreateOrganization", 1, "Organization", org, {organization_id: org, name: "ONYX Labs", slug: "onyx-labs"}, "organization:create", 0),
      organizationCommand("CreateWorkspace", 2, "Workspace", testId(701), {organization_id: org, workspace_id: testId(701), name: "Operations"}, "organization:workspace:create", 1),
      organizationCommand("CreateDepartment", 3, "Department", testId(702), {organization_id: org, department_id: testId(702), name: "Delivery"}, "organization:department:create", 2),
      organizationCommand("CreateDepartment", 4, "Department", testId(703), {organization_id: org, department_id: testId(703), name: "Quality"}, "organization:department:create", 3),
      organizationCommand("CreateTeam", 5, "Team", testId(704), {organization_id: org, team_id: testId(704), department_id: testId(702), name: "Alpha"}, "organization:team:create", 4),
      organizationCommand("CreateGroup", 6, "Group", testId(705), {organization_id: org, group_id: testId(705), name: "Reviewers"}, "organization:group:create", 5),
      organizationCommand("MoveTeam", 7, "Team", testId(704), {organization_id: org, team_id: testId(704), to_department_id: testId(703), reason: "Quality ownership"}, "organization:team:move", 6),
      organizationCommand("ArchiveDepartment", 8, "Department", testId(702), {organization_id: org, department_id: testId(702), reason: "Consolidated"}, "organization:department:archive", 7),
      organizationCommand("ArchiveOrganization", 9, "Organization", org, {organization_id: org, retention_policy_id: testId(706)}, "organization:archive", 8),
    ];
    const events = []; for (const command of commands) events.push(await service.execute(command));
    assert.deepEqual(events.map((event) => event.event_type), ["OrganizationCreated", "WorkspaceCreated", "DepartmentCreated", "DepartmentCreated", "TeamCreated", "GroupCreated", "TeamMoved", "DepartmentArchived", "OrganizationArchived"]);
    const view = await service.getOrganization(org); assert.equal(view.status, "ARCHIVED"); assert.equal(view.version, 9); assert.equal(view.lifecycle_epoch, 1); assert.equal(view.teams[testId(704)]?.department_id, testId(703));
  });
  it("prevents archiving a department that still owns a team", async () => {
    const service = new OrganizationService(new InMemoryOrganizationRepository(), {now}); await service.execute(organizationCommand("CreateOrganization", 20, "Organization", org, {organization_id: org, name: "ONYX", slug: "onyx"}, "organization:create", 0)); await service.execute(organizationCommand("CreateDepartment", 21, "Department", testId(710), {organization_id: org, department_id: testId(710), name: "Delivery"}, "organization:department:create", 1)); await service.execute(organizationCommand("CreateTeam", 22, "Team", testId(711), {organization_id: org, team_id: testId(711), department_id: testId(710), name: "Alpha"}, "organization:team:create", 2));
    await assert.rejects(service.execute(organizationCommand("ArchiveDepartment", 23, "Department", testId(710), {organization_id: org, department_id: testId(710), reason: "Attempt"}, "organization:department:archive", 3)), (error: unknown) => error instanceof OnyxError && error.code === "INVALID_STATE_TRANSITION");
  });
});
