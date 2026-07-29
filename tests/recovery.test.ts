import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createVerifiedBackup, restoreVerifiedBackup, verifyBackup, verifyDatabase } from "../src/infrastructure/sqlite/recovery.ts";
import { SqliteDatabase } from "../src/infrastructure/sqlite/database.ts";
import { MissionService } from "../src/mission/service.ts";
import { SqliteMissionRepository } from "../src/mission/sqlite-repository.ts";
import { createMissionCommand, missionCommand, testId } from "./fixtures.ts";

const now = () => new Date("2026-07-29T20:00:01.000Z");

describe("database recovery", () => {
  it("backs up an open WAL database and restores the exact verified snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-recovery-roundtrip-"));
    const sourcePath = join(directory, "source.db");
    const backupPath = join(directory, "snapshots", "backup.db");
    const restoredPath = join(directory, "restored", "onyx.db");
    try {
      const source = new SqliteDatabase(sourcePath);
      const sourceService = new MissionService({repository: new SqliteMissionRepository(source), now});
      const create = createMissionCommand();
      const created = await sourceService.execute(create);

      const manifest = await createVerifiedBackup({sourcePath, destinationPath: backupPath, now});
      assert.equal(manifest.formatVersion, 1);
      assert.equal(manifest.databaseFile, "backup.db");
      assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(manifest.verification.schemaVersions, [1, 2, 3, 4]);
      assert.equal(manifest.verification.integrity, "ok");
      assert.equal(manifest.verification.foreignKeyViolations, 0);

      await sourceService.execute(missionCommand(
        "CancelMission",
        96,
        {mission_id: testId(14), reason_code: "DR_TEST", reason: "Change source after snapshot"},
        "mission:cancel",
        1,
      ));
      assert.equal((await sourceService.getMission(testId(13), testId(14))).status, "CANCELLED");

      assert.deepEqual(await verifyBackup(backupPath), manifest);
      assert.deepEqual(await restoreVerifiedBackup({backupPath, destinationPath: restoredPath}), manifest);
      const restored = new SqliteDatabase(restoredPath);
      const restoredService = new MissionService({repository: new SqliteMissionRepository(restored), now});
      assert.equal((await restoredService.getMission(testId(13), testId(14))).status, "DRAFT");
      assert.deepEqual((await restoredService.getHistory(testId(13), testId(14))).map((event) => event.event_type), ["MissionCreated"]);
      assert.deepEqual(await restoredService.execute(create), created);
      assert.equal(restored.readiness(now()).outbox.pending, 1);
      restored.close();
      source.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("detects backup corruption before restore", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-recovery-corrupt-"));
    const sourcePath = join(directory, "source.db");
    const backupPath = join(directory, "backup.db");
    try {
      const source = new SqliteDatabase(sourcePath);
      await new MissionService({repository: new SqliteMissionRepository(source), now}).execute(createMissionCommand());
      await createVerifiedBackup({sourcePath, destinationPath: backupPath, now});
      source.close();
      await appendFile(backupPath, "corruption");
      await assert.rejects(verifyBackup(backupPath), /byte length does not match/);
      await assert.rejects(
        restoreVerifiedBackup({backupPath, destinationPath: join(directory, "restored.db")}),
        /byte length does not match/,
      );
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("never overwrites existing backup or restore destinations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-recovery-exclusive-"));
    const sourcePath = join(directory, "source.db");
    const backupPath = join(directory, "backup.db");
    try {
      const source = new SqliteDatabase(sourcePath);
      source.close();
      await writeFile(backupPath, "existing backup must survive", "utf8");
      await assert.rejects(createVerifiedBackup({sourcePath, destinationPath: backupPath}), /already exists/);
      assert.equal(await readFile(backupPath, "utf8"), "existing backup must survive");

      await rm(backupPath);
      await createVerifiedBackup({sourcePath, destinationPath: backupPath, now});
      const destination = join(directory, "destination.db");
      await writeFile(destination, "existing restore must survive", "utf8");
      await assert.rejects(restoreVerifiedBackup({backupPath, destinationPath: destination}), /already exists/);
      assert.equal(await readFile(destination, "utf8"), "existing restore must survive");
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("rejects structurally valid SQLite files with foreign-key damage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-recovery-foreign-key-"));
    const path = join(directory, "onyx.db");
    try {
      const database = new SqliteDatabase(path);
      await new MissionService({repository: new SqliteMissionRepository(database), now}).execute(createMissionCommand());
      database.close();
      const damaged = new DatabaseSync(path);
      damaged.exec("PRAGMA foreign_keys = OFF");
      damaged.prepare("DELETE FROM onyx_aggregates WHERE context = ? AND aggregate_id = ?").run("mission", testId(14));
      damaged.close();
      assert.throws(() => verifyDatabase(path), /foreign-key violation/);
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it("rejects a future schema before applying current migrations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onyx-recovery-future-schema-"));
    const path = join(directory, "future.db");
    try {
      const future = new DatabaseSync(path);
      future.exec("CREATE TABLE onyx_schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO onyx_schema_migrations VALUES (5)");
      future.close();
      assert.throws(() => new SqliteDatabase(path), /newer than supported version 4/);
      const unchanged = new DatabaseSync(path, {readOnly: true});
      assert.deepEqual(
        (unchanged.prepare("SELECT version FROM onyx_schema_migrations").all() as Array<{version: number}>).map((row) => row.version),
        [5],
      );
      unchanged.close();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
