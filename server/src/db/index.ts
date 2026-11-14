import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import path from "node:path";
import { config } from "../config.ts";
import { migrations } from "./schema.ts";

export type Row = Record<string, any>;
export type Params = SQLInputValue[] | Record<string, SQLInputValue>;

export function openDatabase(file: string) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const current = (db.prepare("SELECT COALESCE(MAX(version),0) v FROM schema_migrations").get() as Row).v as number;
  migrations.forEach((sql, i) => {
    const version = i + 1;
    if (version <= current) return;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  return db;
}

const dbFile = process.env.DB_FILE ?? path.join(config.dataDir, "mli.db");
export const db = openDatabase(dbFile);
export const dbPath = dbFile;

function bind(params?: Params): SQLInputValue[] {
  if (!params) return [];
  return Array.isArray(params) ? params.map(norm) : [Object.fromEntries(Object.entries(params).map(([k, v]) => [k, norm(v)])) as any];
}
function norm(v: any): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

export const q = {
  all<T = Row>(sql: string, params?: Params): T[] {
    return db.prepare(sql).all(...bind(params)) as T[];
  },
  get<T = Row>(sql: string, params?: Params): T | undefined {
    return db.prepare(sql).get(...bind(params)) as T | undefined;
  },
  run(sql: string, params?: Params) {
    return db.prepare(sql).run(...bind(params));
  },
  tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};

export const json = {
  parse<T = any>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  },
  str: (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v)),
};

export function getSetting<T>(key: string, fallback: T): T {
  const r = q.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return r ? json.parse<T>(r.value, fallback) : fallback;
}
export function setSetting(key: string, value: unknown) {
  q.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, JSON.stringify(value)]);
}
