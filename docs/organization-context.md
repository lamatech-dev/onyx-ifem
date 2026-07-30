# Organization context

The Organization context owns the tenant hierarchy and implements all eight v2.0 organization commands with exact payload schemas.

## Aggregate model

One `OrganizationStructure` aggregate is keyed by `organization_id`. It contains versioned maps of workspaces, departments, teams, and groups. Departments may form a parent hierarchy; each team belongs to one active department. The read view exposes the complete hierarchy so clients can render an organization tree without reconstructing state from unrelated contexts.

## Commands and events

- `CreateOrganization` emits `OrganizationCreated`.
- `CreateWorkspace` emits `WorkspaceCreated`.
- `CreateDepartment` emits `DepartmentCreated`.
- `CreateTeam` emits `TeamCreated`.
- `CreateGroup` emits `GroupCreated`.
- `MoveTeam` emits `TeamMoved`.
- `ArchiveDepartment` emits `DepartmentArchived`.
- `ArchiveOrganization` emits `OrganizationArchived`.

Each child command targets its child aggregate type and identifier while events are recorded on the owning Organization stream. The payload `organization_id` must match the envelope boundary. Referenced parent departments and destination departments must exist and remain active.

## Safety invariants

A department cannot be archived while it owns teams; teams must first be moved. An archived organization is immutable and increments its lifecycle epoch. Every mutation checks the aggregate version, lifecycle epoch, authority epoch, unexpired command scope, and idempotency fingerprint before atomically persisting the new snapshot, event, operation receipt, and outbox message.

## Authority scopes

The context uses separate scopes for organization creation, workspace, department, team and group creation, team moves, department archival, and organization archival. Read endpoints remain organization-bound and do not permit querying one tenant through another tenant's identifier.

## Query and UI surface

The HTTP API exposes collection, item, and cursor-bounded history routes. The graphical command center renders hierarchy counts and department/team branches and provides controls for every organization command. SQLite restart tests verify state, event history, and idempotent replay.
