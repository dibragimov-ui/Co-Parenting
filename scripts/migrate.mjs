// Applies database migrations before each build, so a deploy sets up or
// updates the database without anyone running a command by hand.
// Skipped when no database is configured (for example a local build).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Neon's Vercel integration provides a direct (unpooled) URL for schema changes.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL set, skipping");
  process.exit(0);
}
const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle({ client }), { migrationsFolder: "./drizzle" });
  console.log("migrate: database is up to date");
} finally {
  await client.end();
}
