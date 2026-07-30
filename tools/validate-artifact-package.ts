import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Artifact {
  kind: "command" | "event";
  name: string;
  path: string;
}

const root = resolve(".");
const failures: string[] = [];

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function expectedRepositoryPath(upstreamPath: string): string {
  if (upstreamPath === "README.md") return "contracts/v2.0/ARTIFACT_README.md";
  if (upstreamPath.startsWith("contracts/")) return `contracts/v2.0/${upstreamPath.slice("contracts/".length)}`;
  return upstreamPath;
}

function quotedUnion(source: string, typeName: string): Set<string> {
  const match = source.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  if (!match) {
    failures.push(`codegen/typescript/src/index.ts: missing ${typeName}`);
    return new Set();
  }
  return new Set([...match[1]!.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!));
}

function rustEnum(source: string, typeName: string): Set<string> {
  const match = source.match(new RegExp(`enum ${typeName}\\s*\\{([^}]*)\\}`));
  if (!match) {
    failures.push(`codegen/rust/src/lib.rs: missing ${typeName}`);
    return new Set();
  }
  return new Set(match[1]!.split(",").map((entry) => entry.trim()).filter(Boolean));
}

function compareSet(label: string, actual: Set<string>, expected: Set<string>): void {
  for (const name of expected) if (!actual.has(name)) failures.push(`${label}: missing ${name}`);
  for (const name of actual) if (!expected.has(name)) failures.push(`${label}: unexpected ${name}`);
}

const inventoryPath = "contracts/v2.0/UPSTREAM_SHA256SUMS";
if (!existsSync(resolve(root, inventoryPath))) {
  failures.push(`${inventoryPath}: upstream inventory is missing`);
} else {
  const inventory = read(inventoryPath)
    .split("\n")
    .map((line) => line.match(/^[a-f0-9]{64}\s{2}(.+)$/)?.[1])
    .filter((path): path is string => path !== undefined);
  if (inventory.length !== 372) failures.push(`${inventoryPath}: expected 372 upstream files, found ${inventory.length}`);
  for (const upstreamPath of inventory) {
    const repositoryPath = expectedRepositoryPath(upstreamPath);
    if (!existsSync(resolve(root, repositoryPath))) failures.push(`${repositoryPath}: missing upstream artifact (${upstreamPath})`);
  }
}

const requiredPackageFiles = [
  "codegen/rust/Cargo.toml",
  "codegen/rust/Cargo.lock",
  "codegen/rust/src/lib.rs",
  "codegen/typescript/package.json",
  "codegen/typescript/package-lock.json",
  "codegen/typescript/tsconfig.json",
  "codegen/typescript/src/index.ts",
  "validation/requirements.txt",
  "validation/tests/test_contracts.py",
  "validation/fixtures/valid/CreateMission.json",
  "validation/fixtures/valid/MissionCreated.json",
  "validation/fixtures/invalid/CreateMission_missing_objective.json",
];
for (const path of requiredPackageFiles) if (!existsSync(resolve(root, path))) failures.push(`${path}: required package file is missing`);

const manifest = JSON.parse(read("contracts/v2.0/manifests/package-manifest.json")) as {artifacts: Artifact[]; formats: string[]};
const commandNames = new Set(manifest.artifacts.filter((artifact) => artifact.kind === "command").map((artifact) => artifact.name));
const eventNames = new Set(manifest.artifacts.filter((artifact) => artifact.kind === "event").map((artifact) => artifact.name));
if (commandNames.size !== 144) failures.push(`manifest: expected 144 commands, found ${commandNames.size}`);
if (eventNames.size !== 150) failures.push(`manifest: expected 150 events, found ${eventNames.size}`);

const typescriptSource = read("codegen/typescript/src/index.ts");
compareSet("TypeScript CommandType", quotedUnion(typescriptSource, "CommandType"), commandNames);
compareSet("TypeScript EventType", quotedUnion(typescriptSource, "EventType"), eventNames);
if (!typescriptSource.includes("interface CommandEnvelope")) failures.push("TypeScript: CommandEnvelope is missing");
if (!typescriptSource.includes("interface EventEnvelope")) failures.push("TypeScript: EventEnvelope is missing");

const rustSource = read("codegen/rust/src/lib.rs");
compareSet("Rust CommandType", rustEnum(rustSource, "CommandType"), commandNames);
compareSet("Rust EventType", rustEnum(rustSource, "EventType"), eventNames);
if (!rustSource.includes("struct CommandEnvelope")) failures.push("Rust: CommandEnvelope is missing");
if (!rustSource.includes("struct EventEnvelope")) failures.push("Rust: EventEnvelope is missing");

for (const format of ["Rust", "TypeScript", "Protocol Buffers 3", "AsyncAPI 3.0", "OpenAPI 3.1", "JSON Schema 2020-12"]) {
  if (!manifest.formats.includes(format)) failures.push(`manifest: format is not declared: ${format}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS: all 372 upstream package files are represented in the repository");
  console.log(`PASS: Rust and TypeScript codegen match ${commandNames.size} commands and ${eventNames.size} events`);
  console.log("PASS: validation fixtures and every declared contract format are present");
}
