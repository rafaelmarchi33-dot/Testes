import fs from "node:fs";
import path from "node:path";
import { db } from "../db/index.ts";
import { config } from "../config.ts";
import { logger } from "../lib/logger.ts";

const dir = path.join(config.dataDir, "backups");

/**
 * Backup consistente do SQLite com VACUUM INTO (seguro com o banco em uso).
 * Os tokens no backup continuam criptografados; guarde a ENCRYPTION_KEY separadamente.
 */
export function runBackup(): string {
  const file = path.join(dir, `mli-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = listBackups();
  for (const old of files.slice(config.backup.keep)) fs.unlinkSync(path.join(dir, old.file));
  logger.info("backup_done", { file: path.basename(file) });
  return path.basename(file);
}

export function listBackups() {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort().reverse().map((f) => ({ file: f, size: fs.statSync(path.join(dir, f)).size }));
}
