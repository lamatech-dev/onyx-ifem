import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the ONYX operations command center", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ONYX — IFEM Operations Command Center<\/title>/i);
  assert.match(html, /Command center/);
  assert.match(html, /MISSION PORTFOLIO/);
  assert.match(html, /Mission · Work · Timeline · Evidence|mission, work item, timeline and evidence/i);
  assert.match(html, /New mission/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps product metadata and the local API proxy production-safe", async () => {
  const [page, layout, route, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/onyx/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /CreateMission/);
  assert.match(page, /CreateTask/);
  assert.match(page, /CreateTimeline/);
  assert.match(page, /CreateReport/);
  assert.match(page, /MissionDetail/);
  assert.match(page, /MissionBlueprintRevisionCreated/);
  assert.match(page, /Approve & activate/);
  assert.match(layout, /ONYX — IFEM Operations Command Center/);
  assert.match(route, /ALLOWED_PREFIXES/);
  assert.match(route, /http:\/\/127\.0\.0\.1:3001/);
  assert.match(packageJson, /"name": "onyx-ifem-console"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
