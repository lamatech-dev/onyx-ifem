import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IMPLEMENTED_COMMAND_ROUTES, OPENAPI_DOCUMENT } from "../src/api/openapi.ts";

type JsonObject = Record<string, any>;

const failures: string[] = [];
const document = OPENAPI_DOCUMENT;
if (document.openapi !== "3.1.2") failures.push("openapi version must be 3.1.2");
if (document.jsonSchemaDialect !== "https://json-schema.org/draft/2020-12/schema") {
  failures.push("jsonSchemaDialect must be JSON Schema Draft 2020-12");
}

const manifest = JSON.parse(readFileSync(resolve("contracts/v2.0/manifests/package-manifest.json"), "utf8")) as JsonObject;
const frozenCommands = new Set<string>(
  manifest.artifacts
    .filter((artifact: JsonObject) => artifact.kind === "command" && artifact.completeness === "FIELD_COMPLETE")
    .map((artifact: JsonObject) => artifact.name as string),
);
const documentedCommands = new Set(IMPLEMENTED_COMMAND_ROUTES.map((route) => route.command));
for (const command of frozenCommands) if (!documentedCommands.has(command)) failures.push(`FIELD_COMPLETE command is undocumented: ${command}`);
for (const command of documentedCommands) if (!frozenCommands.has(command)) failures.push(`documented command is not FIELD_COMPLETE: ${command}`);

const operationIds = new Set<string>();
for (const [path, item] of Object.entries(document.paths as JsonObject)) {
  for (const [method, operation] of Object.entries(item as JsonObject)) {
    const operationId = (operation as JsonObject).operationId;
    if (typeof operationId !== "string" || operationId.length === 0) failures.push(`${method.toUpperCase()} ${path}: operationId is required`);
    else if (operationIds.has(operationId)) failures.push(`duplicate operationId: ${operationId}`);
    else operationIds.add(operationId);
  }
}

function resolveLocalReference(reference: string): unknown {
  let current: unknown = document;
  for (const rawToken of reference.slice(2).split("/")) {
    const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(token in current)) return undefined;
    current = (current as JsonObject)[token];
  }
  return current;
}

function inspect(value: unknown, location: string): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => inspect(child, `${location}/${index}`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key === "$ref") {
      if (typeof child !== "string" || !child.startsWith("#/")) failures.push(`${location}: non-local $ref remains: ${String(child)}`);
      else if (resolveLocalReference(child) === undefined) failures.push(`${location}: unresolved $ref: ${child}`);
    } else {
      inspect(child, `${location}/${key}`);
    }
  }
}
inspect(document, "#");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${Object.keys(document.paths as JsonObject).length} OpenAPI paths validated`);
  console.log(`PASS: ${operationIds.size} unique operations documented`);
  console.log(`PASS: ${documentedCommands.size} FIELD_COMPLETE commands documented`);
  console.log("PASS: all schema references are bundled and resolvable");
}
