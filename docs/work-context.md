# Work context

The Work context owns Task aggregates. The initial vertical slice implements only `CreateTask`, because it is the only Work command whose v2.0 payload is marked `FIELD_COMPLETE`.

## Cross-context boundary

Work references a Mission but never modifies Mission state. `WorkService` depends on a narrow `requireMission(organizationId, missionId)` port. The current composition maps that port to the Mission query service; a future deployment can replace it with a remote contract adapter without changing Work domain logic.

Creation is rejected when:

- the referenced Mission does not exist;
- the Mission belongs to another organization;
- the caller lacks an unexpired `work:create` authority proof;
- the Task identifier already exists;
- `expected_version`, when supplied, is not zero;
- the operation identifier was previously used with different content.

## Persistence boundary

Task state, the `TaskCreated` event, and the idempotency record are committed through one repository operation. The in-memory adapter demonstrates the contract; a durable adapter must preserve the same atomic behavior.

## Query surface

- get a Task by identifier and organization;
- list Tasks inside an organization;
- read aggregate event history using `after_version` and `limit` bounds.

## Deferred lifecycle

The event registry names later Task states, but the corresponding command payloads remain open. The implementation therefore does not guess fields for ownership changes, dependencies, priority changes, execution, completion, approval, closure, cancellation, or reopening.

