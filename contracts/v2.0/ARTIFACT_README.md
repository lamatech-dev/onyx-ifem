# ONYX IFEM Machine-Readable Contract Artifact Package v2.0

Actual machine-consumable bundle containing 294 command/event JSON Schemas across 18 bounded contexts, shared envelopes and types, query and DTO schemas, error and compatibility registries, OpenAPI, AsyncAPI, Protocol Buffers, Rust and TypeScript packages, fixtures, and executable validation tests.

`FIELD_COMPLETE` means payload fields were directly supported by the surfaced frozen registry. `NAME_FROZEN_PAYLOAD_OPEN` means the command/event name and canonical envelope are executable, but payload fields remain permissive rather than invented.

Run: `python validation/tests/test_contracts.py`
