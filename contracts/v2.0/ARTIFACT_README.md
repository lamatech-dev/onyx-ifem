# ONYX IFEM Machine-Readable Contract Artifact Package v2.0

Actual machine-consumable bundle containing 294 command/event JSON Schemas across 18 bounded contexts, shared envelopes and types, query and DTO schemas, error and compatibility registries, OpenAPI, AsyncAPI, Protocol Buffers, Rust and TypeScript packages, fixtures, and executable validation tests.

`FIELD_COMPLETE` means the payload is now closed by exact required/optional properties in this repository. The imported baseline supplied directly frozen payloads for its initial subset; the formerly `NAME_FROZEN_PAYLOAD_OPEN` entries were completed as repository-native v2.0 contract decisions together with their validators, runtime behavior, persistence, API/OpenAPI surface, UI controls, documentation, and tests. The final manifest contains no permissive payloads.

The repository keeps the package-integrated paths at `contracts/v2.0`, `codegen`, and `validation`. The original package inventory and README are preserved as `contracts/v2.0/UPSTREAM_SHA256SUMS` and `contracts/v2.0/UPSTREAM_README.md`; the checksum file is an immutable inventory of the supplied baseline, while evolved field-complete schemas intentionally no longer match the baseline hashes.

Run all artifact gates from the repository root:

```sh
npm run check:artifacts
```
