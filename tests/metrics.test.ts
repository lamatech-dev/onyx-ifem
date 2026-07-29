import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrometheusMetrics, metricRoute } from "../src/infrastructure/observability/metrics.ts";

describe("Prometheus metrics", () => {
  it("normalizes unbounded paths into fixed route templates", () => {
    assert.equal(metricRoute("/v1/mission/commands/CreateMission"), "/v1/{context}/commands/{command_type}");
    assert.equal(metricRoute("/v1/reports/private-object-id?organization_id=private-org"), "/v1/{resource}/{object_id}");
    assert.equal(metricRoute("/v1/reports/private-object-id/history"), "/v1/{resource}/{object_id}/history");
    assert.equal(metricRoute("/attacker-controlled"), "unmatched");
  });

  it("renders counters, cumulative histograms, rejection totals, and durable messaging gauges", () => {
    const metrics = new PrometheusMetrics(() => 42);
    const first = metrics.startHttpRequest();
    first.finish({
      method: "POST",
      path: "/v1/mission/commands/CreateMission?organization_id=private-org",
      status: 202,
      durationSeconds: 0.02,
    });
    first.finish({method: "POST", path: "/must-not-double-count", status: 500, durationSeconds: 1});
    metrics.recordAdmissionRejection("rate_limited");
    metrics.recordAdmissionRejection("concurrency_limited");

    const output = metrics.render({
      durable: true,
      now: new Date("2026-07-30T00:00:10.000Z"),
      messaging: {
        outbox: {
          pending: 2,
          ready: 1,
          leased: 1,
          delivered: 3,
          deadLettered: 0,
          oldestPendingAt: "2026-07-30T00:00:00.000Z",
        },
        inbox: {processing: 1, retryable: 2, completed: 3, failed: 4},
      },
    });

    assert.match(output, /onyx_process_uptime_seconds 42\n/);
    assert.match(output, /onyx_persistence_durable 1\n/);
    assert.match(output, /onyx_http_requests_in_flight 0\n/);
    assert.match(output, /onyx_http_requests_total\{method="POST",route="\/v1\/\{context\}\/commands\/\{command_type\}",status_code="202"\} 1/);
    assert.match(output, /onyx_http_request_duration_seconds_bucket\{method="POST",route="[^"]+",le="0.01"\} 0/);
    assert.match(output, /onyx_http_request_duration_seconds_bucket\{method="POST",route="[^"]+",le="0.025"\} 1/);
    assert.match(output, /onyx_http_request_duration_seconds_bucket\{method="POST",route="[^"]+",le="\+Inf"\} 1/);
    assert.match(output, /onyx_http_request_duration_seconds_count\{method="POST",route="[^"]+"\} 1/);
    assert.match(output, /onyx_http_admission_rejections_total\{reason="rate_limited"\} 1/);
    assert.match(output, /onyx_outbox_messages\{state="pending"\} 2/);
    assert.match(output, /onyx_inbox_receipts\{state="failed"\} 4/);
    assert.match(output, /onyx_outbox_oldest_pending_age_seconds 10/);
    assert.doesNotMatch(output, /private-org|CreateMission/);
    assert.equal(output.endsWith("\n"), true);
  });
});
