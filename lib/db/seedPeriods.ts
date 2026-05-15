import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "./index";
import { rounds, seedPeriods, type SeedPeriod } from "./schema";
import {
  generateServerSeed,
  hashServerSeed,
} from "../provablyFair";
import type { CoinSide, Outcome } from "../types";

/** UTC date string YYYY-MM-DD for the given epoch ms (defaults to now). */
export function utcDateString(epochMs = Date.now()): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Idempotently fetch (or create) the active seed period for today's UTC date.
 * If a previous period exists and is still un-revealed, mark it revealed
 * before creating the new one. Cached in-process for fast subsequent reads.
 */
let activePeriodCache: SeedPeriod | null = null;

export async function getActiveSeedPeriod(): Promise<SeedPeriod> {
  const today = utcDateString();
  if (activePeriodCache && activePeriodCache.periodDate === today) {
    return activePeriodCache;
  }

  // Reveal any prior unrevealed periods before opening today's. This makes
  // verification immediate and bounds how long any seed stays secret.
  await db
    .update(seedPeriods)
    .set({ revealedAt: new Date() })
    .where(
      and(isNull(seedPeriods.revealedAt), lt(seedPeriods.periodDate, today)),
    );

  const existing = await db
    .select()
    .from(seedPeriods)
    .where(eq(seedPeriods.periodDate, today))
    .limit(1);
  if (existing[0]) {
    activePeriodCache = existing[0];
    return existing[0];
  }

  const serverSeed = generateServerSeed();
  const clientSeed = generateServerSeed().slice(0, 16);
  const [created] = await db
    .insert(seedPeriods)
    .values({
      periodDate: today,
      serverSeed,
      serverSeedHash: hashServerSeed(serverSeed),
      clientSeed,
    })
    .returning();
  activePeriodCache = created;
  return created;
}

/**
 * Atomically increment + return the nonce that should be used for the next
 * round. Single SQL UPDATE...RETURNING so concurrent callers can't collide.
 */
export async function reserveNonce(seedPeriodId: string): Promise<number> {
  const result = await db.execute<{ next_nonce: number }>(sql`
    UPDATE seed_periods
    SET next_nonce = next_nonce + 1
    WHERE id = ${seedPeriodId}::uuid
    RETURNING next_nonce
  `);
  if (result.rows.length === 0) {
    throw new Error("seed period not found");
  }
  const postIncrement = Number(result.rows[0].next_nonce);
  // Round uses (postIncrement - 1) since we incremented before returning.
  const nonce = postIncrement - 1;
  if (activePeriodCache?.id === seedPeriodId) {
    activePeriodCache = { ...activePeriodCache, nextNonce: postIncrement };
  }
  return nonce;
}

/**
 * Persist a round outcome. Run after the round resolves so the public
 * /verify pages can show it. Idempotent on (seed_period_id, nonce).
 */
export async function recordRound(args: {
  seedPeriodId: string;
  nonce: number;
  coins: [CoinSide, CoinSide];
  outcome: Outcome;
}): Promise<void> {
  await db
    .insert(rounds)
    .values({
      seedPeriodId: args.seedPeriodId,
      nonce: args.nonce,
      coinA: args.coins[0],
      coinB: args.coins[1],
      outcome: args.outcome,
    })
    .onConflictDoNothing({ target: [rounds.seedPeriodId, rounds.nonce] });
}

/**
 * Force-reveal the active period. Used by the cron / scheduled rotation.
 * After reveal, any caller of getActiveSeedPeriod will mint a new one.
 */
export async function revealActivePeriod(): Promise<void> {
  const today = utcDateString();
  await db
    .update(seedPeriods)
    .set({ revealedAt: new Date() })
    .where(eq(seedPeriods.periodDate, today));
  activePeriodCache = null;
}
