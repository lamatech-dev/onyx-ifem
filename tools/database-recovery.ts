import { createVerifiedBackup, restoreVerifiedBackup, verifyBackup } from "../src/infrastructure/sqlite/recovery.ts";

const [command, first, second, third, ...extra] = process.argv.slice(2);

try {
  if (extra.length > 0) usage();
  if (command === "backup" && first && second && third === undefined) {
    const manifest = await createVerifiedBackup({sourcePath: first, destinationPath: second});
    print({status: "created", backup: second, manifest: `${second}.manifest.json`, details: manifest});
  } else if (command === "verify" && first && third === undefined) {
    const manifest = await verifyBackup(first, second);
    print({status: "verified", backup: first, details: manifest});
  } else if (command === "restore" && first && second && extra.length === 0) {
    const manifest = await restoreVerifiedBackup({backupPath: first, destinationPath: second, ...(third ? {manifestPath: third} : {})});
    print({status: "restored", backup: first, database: second, details: manifest});
  } else {
    usage();
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function usage(): never {
  throw new Error([
    "usage:",
    "  npm run db:backup -- <source.db> <backup.db>",
    "  npm run db:verify -- <backup.db> [manifest.json]",
    "  npm run db:restore -- <backup.db> <destination.db> [manifest.json]",
  ].join("\n"));
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
