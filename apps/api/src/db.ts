import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** The slice of a Postgres client the API uses; node-postgres and PGlite both satisfy it. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

export function pgDb(connectionString: string): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    query: async <T>(text: string, params?: unknown[]) => {
      const r = await pool.query(text, params as unknown[]);
      return { rows: r.rows as T[] };
    },
    exec: (sql: string) => pool.query(sql),
    end: () => pool.end(),
  };
}

const SQL_DIR = fileURLToPath(new URL("../sql", import.meta.url));

/** Applies every sql/NNN_*.sql file once, in name order. */
export async function migrate(db: Db, dir = SQL_DIR): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ id: string }>("select id from schema_migrations")).rows.map((r) => r.id));
  const files = (await readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    await db.exec(await readFile(join(dir, f), "utf8"));
    await db.query("insert into schema_migrations (id) values ($1)", [f]);
    applied.push(f);
  }
  return applied;
}
