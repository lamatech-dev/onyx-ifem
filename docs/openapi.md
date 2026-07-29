# OpenAPI description

ONYX publishes an OpenAPI 3.1.2 description for every implemented HTTP operation. OpenAPI 3.1 uses JSON Schema Draft 2020-12 semantics, matching the machine-readable IFEM contract baseline.

## Access and export

With the API running:

```text
GET /openapi.json
```

To print the same document without starting a server:

```bash
npm run openapi
```

The returned document is cloned for each application request so a caller cannot mutate the process-wide source description.

## Contract bundling

Command and event schemas are loaded from `contracts/v2.0` and bundled into `components.schemas`. References to the shared command envelope, event envelope, and shared type definitions are rewritten as local component references. The resulting document is self-contained and does not depend on the private repository or `contracts.onyx.local` being reachable.

The document currently describes:

- 11 command operations with their exact frozen request and emitted-event schemas;
- Mission, Task, Timeline, and Report collection, item, and history queries;
- liveness, readiness, and OpenAPI discovery endpoints;
- reusable identifiers, query parameters, views, and canonical error responses.

Protected operations declare the `BearerAuth` security scheme and document 401 and 403 responses. Liveness, readiness, and OpenAPI discovery remain public.

## Drift validation

```bash
npm run validate:openapi
```

The validator fails when:

- a `FIELD_COMPLETE` command is missing or an open command is advertised;
- an operation lacks a unique `operationId`;
- a schema reference remains external or cannot be resolved;
- the OpenAPI or JSON Schema dialect version changes unexpectedly.

This validation is part of `npm run check` and therefore runs in GitHub Actions.

The version choice follows the [OpenAPI 3.1.2 specification](https://spec.openapis.org/oas/v3.1.2.html), whose Schema Object model uses JSON Schema Draft 2020-12.
