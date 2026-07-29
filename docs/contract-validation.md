# Runtime contract validation

Every executable command passes through a shared strict-envelope validator before context-specific payload validation or repository access.

## Shared envelope guarantees

The runtime enforces the v2.0 command envelope constraints for:

- exact top-level, target, actor, and authority-proof property sets;
- canonical UUIDv7 identifiers, including optional identifiers;
- supported actor types and valid optional device and membership identifiers;
- non-empty, unique authority scopes and non-empty proof references;
- canonical UTC instants;
- non-negative integer expected versions and epochs;
- positive integer vector-clock counters;
- object-shaped payloads and aggregate targets.

Each bounded context then validates its frozen payload fields, exact payload property set, target identity, and command/schema specialization.

## Failure behavior

Malformed commands fail with `INVALID_ARGUMENT` before authority checks, cross-context lookups, state transitions, or writes. Negative conformance tests cover all executable contexts and the shared envelope constraints.
