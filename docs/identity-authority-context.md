# Identity and authority context

The Identity/Authority context owns User aggregates and implements all nine v2.0 commands with exact payload schemas.

## Aggregate ownership

Each User stream stores organization ownership, normalized email and display name, status, role assignments, registered devices, and time-bounded authority delegations. Child identifiers remain inside the User aggregate so changes to access state, authority epochs, events, operation receipts, and outbox messages commit atomically.

## Commands and scopes

- `CreateUser` requires `identity-authority:user:create`.
- `AssignRole` and `RevokeRole` require the corresponding role assign/revoke scopes.
- `RegisterDevice` and `RevokeDevice` require device register/revoke scopes.
- `DelegateAuthority` and `RevokeDelegation` require delegation scopes.
- `DisableUser` and `EnableUser` require user lifecycle scopes.

Every command targets the User identified by `payload.user_id`. Email, role names, device thumbprints, delegation scopes and expiry instants are strictly validated. Self-delegation and expired delegation creation are rejected.

## Revocation and fencing

Role revocation, device revocation, delegation revocation, disable, and enable advance the aggregate authority epoch. Disabling or enabling also advances the lifecycle epoch. Subsequent writes must present current optimistic version, lifecycle, and authority fences, preventing stale control surfaces from restoring revoked access.

## Persistence and queries

The in-memory and SQLite repositories preserve snapshots, immutable histories, canonical integrity digests, idempotency fingerprints, and transactional outbox records. Collection, item, and bounded history APIs enforce organization ownership. Restart tests verify state, history, and identical-operation replay.

## Graphical control surface

The command center lists users with role, active-device, and active-delegation counts. It exposes controls for all nine commands, including guarded role/device/delegation revocation and user disable/enable transitions.
