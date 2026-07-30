import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { EXECUTABLE_EVENT_PROFILES } from "../src/infrastructure/sqlite/database.ts";

const root = resolve("contracts/v2.0");
const manifestPath = join(root, "manifests/package-manifest.json");

interface Artifact {
  completeness: "FIELD_COMPLETE" | "NAME_FROZEN_PAYLOAD_OPEN";
  context: string;
  kind: "command" | "event";
  name: string;
  path: string;
}

async function json(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

const manifest = await json(manifestPath) as {artifacts: Artifact[]};
const failures: string[] = [];
const ids = new Set<string>();

for (const artifact of manifest.artifacts) {
  const path = join(root, artifact.path.replace(/^contracts\//, ""));
  const schema = await json(path);
  const typeField = artifact.kind === "command" ? "command_type" : "event_type";
  const specialization = schema.allOf?.[1]?.properties;
  const checks: Array<[boolean, string]> = [
    [schema["x-onyx-context"] === artifact.context, "context metadata mismatch"],
    [schema["x-onyx-completeness"] === artifact.completeness, "completeness metadata mismatch"],
    [specialization?.[typeField]?.const === artifact.name, "contract name mismatch"],
    [schema.$schema === "https://json-schema.org/draft/2020-12/schema", "schema draft mismatch"],
  ];
  for (const [valid, message] of checks) if (!valid) failures.push(`${artifact.path}: ${message}`);
  if (ids.has(schema.$id)) failures.push(`${artifact.path}: duplicate $id ${schema.$id}`);
  ids.add(schema.$id);
  if (artifact.completeness === "FIELD_COMPLETE" && specialization?.payload?.additionalProperties !== false) {
    failures.push(`${artifact.path}: FIELD_COMPLETE payload must reject unknown properties`);
  }
  if (artifact.completeness === "FIELD_COMPLETE") {
    const payload = specialization?.payload;
    if (payload?.type !== "object") failures.push(`${artifact.path}: FIELD_COMPLETE payload must be an object`);
    if (!Array.isArray(payload?.required) || payload.required.length === 0) {
      failures.push(`${artifact.path}: FIELD_COMPLETE payload must declare required fields`);
    }
    for (const field of payload?.required ?? []) {
      if (payload?.properties?.[field] === undefined) failures.push(`${artifact.path}: required payload field is undefined: ${field}`);
    }
  }
}

const expectedEventTypes = new Map<string, Set<string>>();
for (const artifact of manifest.artifacts.filter((entry) => entry.kind === "event")) {
  const context = artifact.path.split("/")[2];
  if (!context) {
    failures.push(`${artifact.path}: event context cannot be derived from manifest path`);
    continue;
  }
  const names = expectedEventTypes.get(context) ?? new Set<string>();
  names.add(artifact.name);
  expectedEventTypes.set(context, names);
}
for (const [context, expected] of expectedEventTypes) {
  const profile = EXECUTABLE_EVENT_PROFILES[context];
  if (!profile) {
    failures.push(`${context}: SQLite executable event profile is missing`);
    continue;
  }
  for (const eventType of expected) if (!profile.eventTypes.has(eventType)) failures.push(`${context}: SQLite profile is missing ${eventType}`);
  for (const eventType of profile.eventTypes) if (!expected.has(eventType)) failures.push(`${context}: SQLite profile contains non-contract event ${eventType}`);
}
for (const context of Object.keys(EXECUTABLE_EVENT_PROFILES)) {
  if (!expectedEventTypes.has(context)) failures.push(`${context}: SQLite profile has no manifest context`);
}

const contractFiles = (await walk(root))
  .filter((path) => path.endsWith(".json"));
for (const path of contractFiles) {
  try {
    await json(path);
  } catch (error) {
    failures.push(`${relative(root, path)}: invalid JSON: ${(error as Error).message}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  const complete = manifest.artifacts.filter((artifact) => artifact.completeness === "FIELD_COMPLETE").length;
  console.log(`PASS: ${contractFiles.length} JSON files parsed`);
  console.log(`PASS: ${manifest.artifacts.length} command/event manifest entries reconciled`);
  console.log(`INFO: ${complete} FIELD_COMPLETE; ${manifest.artifacts.length - complete} payload-open`);
}
