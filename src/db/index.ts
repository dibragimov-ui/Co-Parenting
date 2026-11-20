import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

// postgres() connects lazily, on the first query, so importing this module
// at build time is safe. prepare: false keeps pooled connections working.
const client = (globalForDb.pg ??= postgres(process.env.DATABASE_URL ?? "", {
  prepare: false,
  max: 5,
}));

export const db = drizzle({ client, schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
