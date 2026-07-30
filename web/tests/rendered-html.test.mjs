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
  assert.match(page, /CreateOrganization/);
  assert.match(page, /CreateWorkspace/);
  assert.match(page, /CreateDepartment/);
  assert.match(page, /CreateTeam/);
  assert.match(page, /CreateGroup/);
  assert.match(page, /MoveTeam/);
  assert.match(page, /ArchiveDepartment/);
  assert.match(page, /ArchiveOrganization/);
  assert.match(page, /OrganizationPanel/);
  assert.match(page, /IdentityPanel/);
  assert.match(page, /CreateUser/);
  assert.match(page, /AssignRole/);
  assert.match(page, /RevokeRole/);
  assert.match(page, /RegisterDevice/);
  assert.match(page, /RevokeDevice/);
  assert.match(page, /DelegateAuthority/);
  assert.match(page, /RevokeDelegation/);
  assert.match(page, /DisableUser/);
  assert.match(page, /EnableUser/);
  assert.match(page, /ContextGraphPanel/);
  assert.match(page, /CreateContextLink/);
  assert.match(page, /UpdateContextMetadata/);
  assert.match(page, /ChangeContextStrength/);
  assert.match(page, /ArchiveContextLink/);
  assert.match(page, /RestoreContextLink/);
  assert.match(page, /MissionDetail/);
  assert.match(page, /RecordDetail/);
  assert.match(page, /MissionBlueprintRevisionCreated/);
  assert.match(page, /Approve & activate/);
  assert.match(page, /\/v1\/tasks\/\$\{id\}\/history/);
  assert.match(page, /\/v1\/timelines\/\$\{id\}\/history/);
  assert.match(page, /\/v1\/reports\/\$\{id\}\/history/);
  assert.match(page, /SubmitCompletion/);
  assert.match(page, /LIFECYCLE CONTROL/);
  assert.match(page, /parseSubjectRef/);
  assert.match(page, /Operational subject/);
  assert.match(page, /Timeline:\$\{timeline\.timeline_id\}/);
  assert.match(page, /CONNECTED RECORDS/);
  assert.match(page, /DOWNSTREAM RECORDS/);
  assert.match(page, /next_cursor/);
  assert.match(page, /mergeUnique/);
  assert.match(page, /Load more/);
  assert.match(page, /history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(page, /popstate/);
  assert.match(page, /record.*mission:/s);
  assert.match(layout, /ONYX — IFEM Operations Command Center/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /x-forwarded-host/);
  assert.match(layout, /\/og\.png/);
  assert.match(route, /ALLOWED_PREFIXES/);
  assert.match(route, /http:\/\/127\.0\.0\.1:3001/);
  assert.match(packageJson, /"name": "onyx-ifem-console"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
