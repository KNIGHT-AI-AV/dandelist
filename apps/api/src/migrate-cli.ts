import { migrate, pgDb } from "./db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first.");
  process.exit(1);
}
const db = pgDb(url);
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
await db.end();
