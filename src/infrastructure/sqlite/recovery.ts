import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, link, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { SQLITE_SCHEMA_VERSION } from "./database.ts";

const REQUIRED_TABLES = [
  "onyx_aggregates",
  "onyx_events",
  "onyx_inbox",
  "onyx_operations",
  "onyx_outbox",
  "onyx_schema_migrations",
] as const;

export interface DatabaseVerification {
  integrity: "ok";
  foreignKeyViolations: number;
  schemaVersions: number[];
  sqliteVersion: string;
  tables: string[];
}

export interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  databaseFile: string;
  sha256: string;
  bytes: number;
  pages: number;
  verification: DatabaseVerification;
}

export interface CreateBackupOptions {
  sourcePath: string;
  destinationPath: string;
  now?: () => Date;
  rate?: number;
}

export interface RestoreBackupOptions {
  backupPath: string;
  destinationPath: string;
  manifestPath?: string;
  rate?: number;
}

export async function createVerifiedBackup(options: CreateBackupOptions): Promise<BackupManifest> {
  const sourcePath = databasePath(options.sourcePath, "sourcePath");
  const destinationPath = databasePath(options.destinationPath, "destinationPath");
  assertDifferent(sourcePath, destinationPath);
  await requireExistingFile(sourcePath, "source database");
  const manifestPath = `${destinationPath}.manifest.json`;
  await requireAbsent(destinationPath, "backup destination");
  await requireAbsent(manifestPath, "backup manifest destination");
  await mkdir(dirname(destinationPath), {recursive: true});
  const temporaryDatabase = temporaryPath(destinationPath);
  const temporaryManifest = temporaryPath(manifestPath);
  const source = new DatabaseSync(sourcePath);
  let publishedDatabase = false;
  try {
    const pages = await backup(source, temporaryDatabase, {rate: backupRate(options.rate)});
    await chmod(temporaryDatabase, 0o600);
    const verification = verifyDatabase(temporaryDatabase);
    const file = await fileIdentity(temporaryDatabase);
    const manifest: BackupManifest = {
      formatVersion: 1,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      databaseFile: basename(destinationPath),
      sha256: file.sha256,
      bytes: file.bytes,
      pages,
      verification,
    };
    await writeDurableJson(temporaryManifest, manifest);
    await publishExclusive(temporaryDatabase, destinationPath);
    publishedDatabase = true;
    await publishExclusive(temporaryManifest, manifestPath);
    return manifest;
  } catch (error) {
    if (publishedDatabase) await unlink(destinationPath).catch(() => undefined);
    throw error;
  } finally {
    source.close();
    await unlink(temporaryDatabase).catch(() => undefined);
    await unlink(temporaryManifest).catch(() => undefined);
  }
}

export async function verifyBackup(backupPathInput: string, manifestPathInput?: string): Promise<BackupManifest> {
  const backupPath = databasePath(backupPathInput, "backupPath");
  const manifestPath = resolve(manifestPathInput ?? `${backupPath}.manifest.json`);
  await requireExistingFile(backupPath, "backup database");
  await requireExistingFile(manifestPath, "backup manifest");
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  if (manifest.databaseFile !== basename(backupPath)) throw new Error("backup manifest databaseFile does not match the backup filename");
  const identity = await fileIdentity(backupPath);
  if (identity.bytes !== manifest.bytes) throw new Error("backup byte length does not match its manifest");
  if (identity.sha256 !== manifest.sha256) throw new Error("backup SHA-256 does not match its manifest");
  const verification = verifyDatabase(backupPath);
  if (JSON.stringify(verification.schemaVersions) !== JSON.stringify(manifest.verification.schemaVersions)) {
    throw new Error("backup schema versions do not match its manifest");
  }
  return manifest;
}

export async function restoreVerifiedBackup(options: RestoreBackupOptions): Promise<BackupManifest> {
  const backupPath = databasePath(options.backupPath, "backupPath");
  const destinationPath = databasePath(options.destinationPath, "destinationPath");
  assertDifferent(backupPath, destinationPath);
  await requireAbsent(destinationPath, "restore destination");
  const manifest = await verifyBackup(backupPath, options.manifestPath);
  await mkdir(dirname(destinationPath), {recursive: true});
  const temporaryDatabase = temporaryPath(destinationPath);
  const source = new DatabaseSync(backupPath, {readOnly: true});
  try {
    await backup(source, temporaryDatabase, {rate: backupRate(options.rate)});
    await chmod(temporaryDatabase, 0o600);
    const restored = verifyDatabase(temporaryDatabase);
    if (JSON.stringify(restored.schemaVersions) !== JSON.stringify(manifest.verification.schemaVersions)) {
      throw new Error("restored schema versions differ from the verified backup");
    }
    await publishExclusive(temporaryDatabase, destinationPath);
    return manifest;
  } finally {
    source.close();
    await unlink(temporaryDatabase).catch(() => undefined);
  }
}

export function verifyDatabase(pathInput: string): DatabaseVerification {
  const path = databasePath(pathInput, "database path");
  const database = new DatabaseSync(path, {readOnly: true});
  try {
    const integrityRows = database.prepare("PRAGMA integrity_check").all() as Array<{integrity_check: string}>;
    if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== "ok") {
      throw new Error(`database integrity check failed: ${integrityRows.map((row) => row.integrity_check).join("; ")}`);
    }
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all().length;
    if (foreignKeyViolations !== 0) throw new Error(`database has ${foreignKeyViolations} foreign-key violation(s)`);
    const tables = (database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as Array<{name: string}>)
      .map((row) => row.name);
    for (const table of REQUIRED_TABLES) if (!tables.includes(table)) throw new Error(`database is missing required table: ${table}`);
    const schemaVersions = (database.prepare("SELECT version FROM onyx_schema_migrations ORDER BY version").all() as Array<{version: number}>)
      .map((row) => row.version);
    const supportedVersions = Array.from({length: SQLITE_SCHEMA_VERSION}, (_, index) => index + 1);
    if (JSON.stringify(schemaVersions) !== JSON.stringify(supportedVersions)) {
      throw new Error(`database schema migrations are incompatible with supported version ${SQLITE_SCHEMA_VERSION}`);
    }
    const version = database.prepare("SELECT sqlite_version() AS version").get() as {version: string};
    return {integrity: "ok", foreignKeyViolations, schemaVersions, sqliteVersion: version.version, tables};
  } finally {
    database.close();
  }
}

async function fileIdentity(path: string): Promise<{sha256: string; bytes: number}> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    hash.update(buffer);
  }
  return {sha256: hash.digest("hex"), bytes};
}

async function publishExclusive(temporary: string, destination: string): Promise<void> {
  await link(temporary, destination);
  await unlink(temporary);
}

async function writeDurableJson(path: string, value: unknown): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function requireExistingFile(path: string, label: string): Promise<void> {
  const details = await stat(path).catch(() => undefined);
  if (!details?.isFile()) throw new Error(`${label} must be an existing file`);
}

async function requireAbsent(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`${label} already exists`);
}

function databasePath(value: string, name: string): string {
  if (!value || value === ":memory:") throw new Error(`${name} must be a file-backed SQLite path`);
  return resolve(value);
}

function assertDifferent(left: string, right: string): void {
  if (left === right) throw new Error("source and destination database paths must differ");
}

function backupRate(value = 100): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) throw new Error("backup rate must be an integer from 1 through 10000");
  return value;
}

function temporaryPath(destination: string): string {
  return `${destination}.partial-${randomUUID()}`;
}

function parseManifest(value: unknown): BackupManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("backup manifest must be an object");
  const manifest = value as Record<string, unknown>;
  const keys = ["formatVersion", "createdAt", "databaseFile", "sha256", "bytes", "pages", "verification"];
  if (Object.keys(manifest).sort().join() !== keys.sort().join()) throw new Error("backup manifest has unexpected fields");
  if (manifest.formatVersion !== 1 || typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error("backup manifest version or timestamp is invalid");
  }
  if (typeof manifest.databaseFile !== "string" || !/^[^/\\]+$/.test(manifest.databaseFile)) throw new Error("backup manifest filename is invalid");
  if (typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.sha256)) throw new Error("backup manifest SHA-256 is invalid");
  if (!Number.isInteger(manifest.bytes) || (manifest.bytes as number) < 1 || !Number.isInteger(manifest.pages) || (manifest.pages as number) < 1) {
    throw new Error("backup manifest size or page count is invalid");
  }
  const verification = manifest.verification as Record<string, unknown>;
  if (verification === null || typeof verification !== "object") throw new Error("backup manifest verification is invalid");
  if (verification.integrity !== "ok" || verification.foreignKeyViolations !== 0 || typeof verification.sqliteVersion !== "string") {
    throw new Error("backup manifest verification result is invalid");
  }
  if (!Array.isArray(verification.schemaVersions) || verification.schemaVersions.some((item) => !Number.isInteger(item))) {
    throw new Error("backup manifest schema versions are invalid");
  }
  if (!Array.isArray(verification.tables) || verification.tables.some((item) => typeof item !== "string")) {
    throw new Error("backup manifest table list is invalid");
  }
  return value as BackupManifest;
}
