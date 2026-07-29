# Production deployment

ONYX runs as one HTTP process with an optional transactional-outbox worker. Production mode requires file-backed SQLite, required bearer authentication, TLS termination for inbound traffic, and an HTTPS event receiver.

For the non-root production image, read-only container invocation, GHCR release artifacts, and SBOM/provenance verification, see [Container and release supply chain](container-and-release.md).

For the production Kustomize base, singleton SQLite storage model, Kubernetes security context, probes, and network policy, see [Kubernetes deployment](kubernetes.md).

## API configuration

```bash
ONYX_HOST=0.0.0.0
ONYX_PORT=3000
ONYX_DB_PATH=/var/lib/onyx/onyx.db
ONYX_AUTH_MODE=required
ONYX_AUTH_PUBLIC_KEY_PATH=/run/secrets/onyx-auth-public.pem
ONYX_AUTH_ISSUER=https://identity.example.com
ONYX_AUTH_AUDIENCE=onyx-ifem-api
npm start
```

Terminate inbound TLS at a trusted proxy or service mesh and do not expose an authentication-disabled instance outside a development environment. Persist the database and its WAL files on durable storage; do not place SQLite on a filesystem with unreliable locking semantics.

Request admission, proxy trust, parser timeouts, and concurrency controls are documented in [HTTP resilience and overload protection](http-resilience.md).

For zero-downtime signing-key rotation, replace the single PEM path with `ONYX_AUTH_JWKS_PATH` and use the public-only static key-ring procedure in [Authentication and authorization](authentication.md).

## Outbox worker

Set `ONYX_OUTBOX_WEBHOOK_URL` to enable the worker in the API process. The worker requires a file-backed `ONYX_DB_PATH`; it cannot share SQLite's isolated `:memory:` databases.

```bash
ONYX_OUTBOX_WEBHOOK_URL=https://events.example.com/onyx
ONYX_OUTBOX_BEARER_TOKEN=replace-with-secret-manager-value
ONYX_OUTBOX_WORKER_ID=onyx-api-1
ONYX_OUTBOX_BATCH_SIZE=10
ONYX_OUTBOX_POLL_MS=1000
ONYX_OUTBOX_ERROR_DELAY_MS=5000
ONYX_OUTBOX_TIMEOUT_MS=10000
ONYX_OUTBOX_LEASE_MS=120000
ONYX_OUTBOX_MAX_ATTEMPTS=10
```

The webhook receives the exact canonical event as its JSON body. Headers include `idempotency-key` with the stable event ID, context, aggregate ID, and aggregate version. Redirect following is disabled so bearer credentials cannot be forwarded to another origin. Only credential-free HTTPS URLs are accepted.

`ONYX_OUTBOX_LEASE_MS` must be greater than `ONYX_OUTBOX_BATCH_SIZE × ONYX_OUTBOX_TIMEOUT_MS`. This preserves lease ownership for the worst-case sequential batch. Use a unique worker ID for every live process.

## Shutdown

On `SIGTERM` or `SIGINT`, ONYX:

1. stops accepting new HTTP connections;
2. stops scheduling new outbox batches;
3. waits for active HTTP requests and the current publication batch;
4. closes the worker and application database connections;
5. exits successfully.

`ONYX_SHUTDOWN_TIMEOUT_MS` bounds the entire drain (120 seconds by default). If active HTTP requests or the current publication batch do not finish before that deadline, ONYX logs `application.shutdown.forced`, closes HTTP connections, and exits unsuccessfully so the supervisor can report the failed drain. The publisher timeout still bounds how long a single event can delay shutdown. The process supervisor's termination grace period must exceed the shutdown timeout and leave time for signal delivery and forced process cleanup.

## Operational checks

Use `/healthz` for process liveness and `/readyz` for persistence readiness. Alert on dead letters and sustained backlog growth. The event receiver must deduplicate with `idempotency-key`; delivery remains at least once when publication succeeds immediately before acknowledgement is interrupted.

Use the Online Backup API tooling rather than copying a live WAL database. Backup verification, restore rehearsal, and production cutover are covered in [Backup and disaster recovery](disaster-recovery.md).
