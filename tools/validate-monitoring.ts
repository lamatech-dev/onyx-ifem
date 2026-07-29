import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboardPath = new URL("../deploy/monitoring/grafana-dashboard.json", import.meta.url);
const rulesPath = new URL("../deploy/monitoring/prometheus-rules.yaml", import.meta.url);

interface DashboardTarget {
  expr?: unknown;
}

interface DashboardPanel {
  id?: unknown;
  targets?: DashboardTarget[];
}

interface Dashboard {
  panels?: DashboardPanel[];
  schemaVersion?: unknown;
  title?: unknown;
  uid?: unknown;
}

const dashboard = JSON.parse(await readFile(dashboardPath, "utf8")) as Dashboard;
const rules = await readFile(rulesPath, "utf8");

assert.equal(dashboard.uid, "onyx-ifem-operations");
assert.equal(dashboard.title, "ONYX IFEM Operations");
assert.equal(typeof dashboard.schemaVersion, "number");
assert.ok((dashboard.schemaVersion as number) >= 41);
assert.ok(Array.isArray(dashboard.panels) && dashboard.panels.length >= 10);

const panelIds = dashboard.panels.map((panel) => panel.id);
assert.ok(panelIds.every((id) => Number.isInteger(id)));
assert.equal(new Set(panelIds).size, panelIds.length);
for (const panel of dashboard.panels) {
  assert.ok(Array.isArray(panel.targets) && panel.targets.length > 0);
  assert.ok(panel.targets.every((target) => typeof target.expr === "string" && target.expr.trim().length > 0));
}

const monitoringSource = `${JSON.stringify(dashboard)}\n${rules}`;
for (const metric of [
  "onyx_http_requests_total",
  "onyx_http_request_duration_seconds_bucket",
  "onyx_http_admission_rejections_total",
  "onyx_persistence_durable",
  "onyx_outbox_messages",
  "onyx_outbox_oldest_pending_age_seconds",
  "onyx_inbox_receipts",
]) {
  assert.match(monitoringSource, new RegExp(`\\b${metric}\\b`));
}

for (const rule of [
  "job:onyx_http_requests:rate5m",
  "job:onyx_http_server_errors:ratio_rate5m",
  "job:onyx_http_request_duration_seconds:p95_rate5m",
  "job:onyx_http_admission_rejections:rate5m",
  "OnyxHighServerErrorRatio",
  "OnyxHighP95Latency",
  "OnyxAdmissionRejections",
  "OnyxOutboxDeadLetters",
  "OnyxOutboxBacklogStale",
  "OnyxInboxFailures",
  "OnyxPersistenceNotDurable",
]) {
  assert.match(rules, new RegExp(`\\b${rule}\\b`));
}

assert.doesNotMatch(monitoringSource, /organization_id|aggregate_id|request_id|tenant_id/);
console.log(`validated ${dashboard.panels.length} dashboard panels and 11 Prometheus rules`);
