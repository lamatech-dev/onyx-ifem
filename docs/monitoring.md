# Production monitoring

ONYX ships a portable Grafana dashboard and Prometheus recording and alerting rules. They operate only on bounded operational labels and never require tenant identifiers.

## Install

Add `deploy/monitoring/prometheus-rules.yaml` to the Prometheus `rule_files` configuration or load it through the equivalent Prometheus Operator resource. Validate it before deployment:

```bash
promtool check rules deploy/monitoring/prometheus-rules.yaml
```

Import `deploy/monitoring/grafana-dashboard.json`, or provision it with Grafana's dashboard provider. Select the Prometheus data source and the desired scrape job from the dashboard variables. The repository validates the dashboard structure and queries in `npm run check`; CI additionally validates the rule syntax and PromQL with Prometheus 3.12.0.

The included thresholds are safe starting points, not universal service-level objectives. Tune them from observed load, delivery latency, and explicit availability objectives. Target absence should be covered by the platform's standard `up == 0` alert because scrape job and ownership conventions belong to the deployment environment.

## High server error ratio

Confirm which routes and status codes increased in the dashboard, correlate the time window with structured logs by `x-request-id`, and inspect dependency or persistence errors. Stop a bad rollout if the increase began with a release. Do not suppress the alert until the ratio and request rate have recovered.

## High p95 latency

Compare latency with request rate, in-flight requests, admission rejections, and SQLite storage latency. Reduce upstream load or roll back a regression before raising concurrency limits; higher concurrency can increase SQLite contention. Verify recovery across at least one full five-minute evaluation window.

## Admission rejections

Break down rejections by `reason`. Rate-limit rejections indicate a sustained caller budget violation; concurrency-limit rejections indicate work is occupying all execution slots. Identify the noisy route and coordinate retry backoff with callers. Change capacity limits only after confirming CPU, memory, and database headroom.

## Outbox dead letters

Inspect publisher logs and the destination response before replaying anything. Correct authentication, TLS, payload acceptance, or endpoint availability first. Preserve stable event identifiers and use the documented recovery workflow so downstream consumers can deduplicate; never delete dead letters simply to clear the alert.

## Stale outbox backlog

Check publisher health, webhook reachability, leases, retry scheduling, and dead-letter counts. A zero age means no pending message. Restore delivery, then verify the oldest age trends down to zero. Restart only after ruling out a persistent downstream or configuration fault.

## Inbox failures

Find the affected consumer and error class in redaction-safe logs, verify whether the input is permanently invalid or the dependency failure is transient, and fix the handler before replay. Keep the original message identity to preserve deduplication guarantees.

## Persistence not durable

Treat this as a production configuration fault. Verify `ONYX_DB_PATH`, persistent-volume attachment, file permissions, and the `/readyz` response. Move traffic away from the in-memory instance; do not rely on a restart to recover data that was never durably written.
