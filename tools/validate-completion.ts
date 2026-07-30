import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { IMPLEMENTED_COMMAND_ROUTES, OPENAPI_DOCUMENT } from "../src/api/openapi.ts";

interface Artifact {
  completeness: string;
  context: string;
  kind: "command" | "event";
  name: string;
  path: string;
}

interface ContextProfile {
  source: string;
  document: string;
}

const profiles: Readonly<Record<string, ContextProfile>> = {
  mission: {source: "mission", document: "mission-context.md"},
  work: {source: "work", document: "work-context.md"},
  organization: {source: "organization", document: "organization-context.md"},
  "identity-authority": {source: "identity-authority", document: "identity-authority-context.md"},
  context: {source: "context-link", document: "context-link-context.md"},
  meeting: {source: "meeting", document: "meeting-context.md"},
  communication: {source: "conversation", document: "conversation-context.md"},
  file: {source: "file", document: "file-context.md"},
  "reporting-evidence": {source: "reporting-evidence", document: "reporting-evidence-context.md"},
  approval: {source: "approval", document: "approval-context.md"},
  timeline: {source: "timeline", document: "timeline-context.md"},
  capacity: {source: "capacity", document: "capacity-context.md"},
  forecasting: {source: "forecast", document: "forecast-context.md"},
  automation: {source: "automation", document: "automation-context.md"},
  notification: {source: "notification", document: "notification-context.md"},
  synchronization: {source: "synchronization", document: "synchronization-context.md"},
  audit: {source: "audit", document: "audit-context.md"},
  policy: {source: "policy", document: "policy-context.md"},
};

const root = resolve(".");
const manifest = JSON.parse(readFileSync(resolve(root, "contracts/v2.0/manifests/package-manifest.json"), "utf8")) as {artifacts: Artifact[]};
const ui = readFileSync(resolve(root, "web/app/page.tsx"), "utf8");
const failures: string[] = [];
const contexts = new Map<string, Artifact[]>();

for (const artifact of manifest.artifacts) {
  const context = artifact.path.split("/")[2];
  if (!context) {
    failures.push(`${artifact.path}: cannot derive contract context`);
    continue;
  }
  const entries = contexts.get(context) ?? [];
  entries.push(artifact);
  contexts.set(context, entries);
}

if (manifest.artifacts.length !== 294) failures.push(`manifest must contain 294 command/event artifacts, found ${manifest.artifacts.length}`);
if (contexts.size !== 18) failures.push(`manifest must contain 18 executable contexts, found ${contexts.size}`);

const routes = new Map(IMPLEMENTED_COMMAND_ROUTES.map((route) => [route.command, route]));
for (const [context, artifacts] of contexts) {
  const profile = profiles[context];
  if (!profile) {
    failures.push(`${context}: completion profile is missing`);
    continue;
  }
  const sourceRoot = resolve(root, "src", profile.source);
  const requiredSourceFiles = ["types.ts", "validation.ts", "service.ts", "repository.ts", "sqlite-repository.ts"];
  for (const file of requiredSourceFiles) if (!existsSync(resolve(sourceRoot, file))) failures.push(`${context}: missing src/${profile.source}/${file}`);
  const source = requiredSourceFiles
    .filter((file) => existsSync(resolve(sourceRoot, file)))
    .map((file) => readFileSync(resolve(sourceRoot, file), "utf8"))
    .join("\n");
  if (!existsSync(resolve(root, "docs", profile.document))) failures.push(`${context}: missing docs/${profile.document}`);

  const queryRoot = resolve(root, "contracts/v2.0/queries", context);
  if (!existsSync(queryRoot)) failures.push(`${context}: query directory is missing`);
  const queryNames = existsSync(queryRoot) ? readdirSync(queryRoot) : [];
  if (queryNames.filter((name) => name.endsWith(".json")).length !== 3) failures.push(`${context}: expected exactly three query contracts`);

  for (const artifact of artifacts) {
    if (artifact.kind === "command") {
      const route = routes.get(artifact.name);
      if (!route) failures.push(`${context}/${artifact.name}: runtime/OpenAPI route is missing`);
      else if (route.context !== context) failures.push(`${context}/${artifact.name}: route uses context ${route.context}`);
      if (!source.includes(artifact.name)) failures.push(`${context}/${artifact.name}: command is missing from context runtime source`);
      if (!ui.includes(artifact.name)) failures.push(`${context}/${artifact.name}: graphical UI action is missing`);
    } else {
      if (!source.includes(artifact.name)) failures.push(`${context}/${artifact.name}: event is missing from context runtime source`);
      if ((OPENAPI_DOCUMENT.components as Record<string, any>)?.schemas?.[artifact.name] === undefined) {
        failures.push(`${context}/${artifact.name}: OpenAPI component schema is missing`);
      }
    }
  }
}

for (const context of Object.keys(profiles)) if (!contexts.has(context)) failures.push(`${context}: completion profile has no manifest context`);
for (const route of IMPLEMENTED_COMMAND_ROUTES) {
  if (!manifest.artifacts.some((artifact) => artifact.kind === "command" && artifact.name === route.command)) {
    failures.push(`${route.context}/${route.command}: runtime route has no manifest command`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  const commands = manifest.artifacts.filter((artifact) => artifact.kind === "command").length;
  const events = manifest.artifacts.filter((artifact) => artifact.kind === "event").length;
  console.log(`PASS: ${contexts.size} executable contexts have source, SQLite repositories, docs, and query contracts`);
  console.log(`PASS: ${commands} commands have runtime/OpenAPI routes and graphical UI actions`);
  console.log(`PASS: ${events} events have runtime handling and OpenAPI schemas`);
}
