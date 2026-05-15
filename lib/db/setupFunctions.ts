import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "./index";

let setupPromise: Promise<void> | null = null;

/**
 * Idempotently install the place_bet / settle_bet stored functions. Safe to
 * call repeatedly — the SQL uses CREATE OR REPLACE. Cached so concurrent
 * callers share one round-trip.
 */
export function ensureLedgerFunctions(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      const path = join(process.cwd(), "lib", "db", "functions.sql");
      const ddl = await readFile(path, "utf8");
      await db.execute(sql.raw(ddl));
    })();
  }
  return setupPromise;
}
