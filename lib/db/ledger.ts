import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  accounts,
  entries,
  transactions,
  type Account,
} from "./schema";

const DEMO_CURRENCY = "USD";
const DEMO_DEPOSIT = "1000.00";

export type LedgerKind =
  | "deposit"
  | "withdrawal"
  | "bet"
  | "payout"
  | "bonus"
  | "adjustment"
  | "refund"
  | "affiliate_share";

export type LedgerLeg = {
  accountId: string;
  direction: "debit" | "credit";
  amount: string; // numeric as string to avoid float drift
};

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unbalanced"
      | "insufficient_funds"
      | "duplicate_idempotency",
  ) {
    super(message);
  }
}

// In-process caches. Account IDs never change once created, and the ledger
// is the single writer for balances, so caching IDs is safe. We don't cache
// balances — those come back from postLedger's RETURNING.
const systemAccountIdCache = new Map<string, string>(); // `${type}:${currency}` → id
const userAccountIdCache = new Map<string, string>(); // `${userId}:${currency}` → id

/**
 * Look up the singleton account of a system type for a currency, creating it
 * if missing. Idempotent under concurrent callers.
 */
export async function getOrCreateSystemAccount(
  type: "house" | "fees" | "escrow",
  currency: string,
): Promise<Account> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.type, type), eq(accounts.currency, currency)))
      .limit(1);
    if (existing[0]) return existing[0];

    const [created] = await tx
      .insert(accounts)
      .values({ type, currency, userId: null })
      .returning();
    return created;
  });
}

export async function getOrCreateHouseAccount(
  currency: string,
): Promise<Account> {
  return getOrCreateSystemAccount("house", currency);
}

export async function getOrCreateEscrowAccount(
  currency: string,
): Promise<Account> {
  return getOrCreateSystemAccount("escrow", currency);
}

async function getSystemAccountId(
  type: "house" | "fees" | "escrow",
  currency: string,
): Promise<string> {
  const key = `${type}:${currency}`;
  const cached = systemAccountIdCache.get(key);
  if (cached) return cached;
  const acc = await getOrCreateSystemAccount(type, currency);
  systemAccountIdCache.set(key, acc.id);
  return acc.id;
}

async function getUserAccountId(
  userId: string,
  currency: string,
): Promise<string> {
  const key = `${userId}:${currency}`;
  const cached = userAccountIdCache.get(key);
  if (cached) return cached;
  const acc = await getUserAccount(userId, currency);
  if (!acc) {
    throw new LedgerError("user has no wallet account", "insufficient_funds");
  }
  userAccountIdCache.set(key, acc.id);
  return acc.id;
}

/**
 * Look up the user's wallet account for a currency.
 */
export async function getUserAccount(
  userId: string,
  currency = DEMO_CURRENCY,
): Promise<Account | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.currency, currency),
        eq(accounts.type, "user"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createUserAccount(
  userId: string,
  currency: string,
): Promise<Account> {
  const [created] = await db
    .insert(accounts)
    .values({ type: "user", currency, userId })
    .returning();
  userAccountIdCache.set(`${userId}:${currency}`, created.id);
  return created;
}

/**
 * Post a balanced N-leg transaction. Sum of debits must equal sum of credits.
 * All entries are written and balances updated atomically. User accounts
 * cannot go negative — `insufficient_funds` is thrown if a debit would drive
 * a user account below zero.
 *
 * Returns the post-write balances for every account the transaction touched
 * (keyed by accountId), so callers don't need a follow-up SELECT.
 */
export async function postLedger(args: {
  idempotencyKey: string;
  kind: LedgerKind;
  legs: LedgerLeg[];
  referenceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<Map<string, string>> {
  if (args.legs.length < 2) {
    throw new LedgerError("ledger transaction needs at least 2 legs", "unbalanced");
  }

  let debitSum = 0n;
  let creditSum = 0n;
  for (const leg of args.legs) {
    const scaled = scaleAmount(leg.amount);
    if (leg.direction === "debit") debitSum += scaled;
    else creditSum += scaled;
  }
  if (debitSum !== creditSum) {
    throw new LedgerError(
      `ledger unbalanced: debits=${debitSum}, credits=${creditSum}`,
      "unbalanced",
    );
  }

  // Aggregate net change per account so each account is touched once.
  const net = new Map<string, bigint>();
  for (const leg of args.legs) {
    const sign = leg.direction === "credit" ? 1n : -1n;
    net.set(
      leg.accountId,
      (net.get(leg.accountId) ?? 0n) + sign * scaleAmount(leg.amount),
    );
  }

  const newBalances = new Map<string, string>();

  await db.transaction(async (tx) => {
    let txRow;
    try {
      const [row] = await tx
        .insert(transactions)
        .values({
          idempotencyKey: args.idempotencyKey,
          kind: args.kind,
          referenceId: args.referenceId ?? null,
          metadata: args.metadata ?? null,
        })
        .returning({ id: transactions.id });
      txRow = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new LedgerError(
          `idempotency key already used: ${args.idempotencyKey}`,
          "duplicate_idempotency",
        );
      }
      throw err;
    }

    await tx.insert(entries).values(
      args.legs.map((leg) => ({
        transactionId: txRow.id,
        accountId: leg.accountId,
        direction: leg.direction,
        amount: leg.amount,
      })),
    );

    // Run the balance updates in parallel — they touch disjoint rows.
    await Promise.all(
      Array.from(net.entries()).map(async ([accountId, delta]) => {
        const deltaStr = unscaleAmount(delta);
        const result = await tx
          .update(accounts)
          .set({
            balance: sql`${accounts.balance} + ${deltaStr}::numeric`,
          })
          .where(
            and(
              eq(accounts.id, accountId),
              // Block user-account debits that would go negative. System
              // accounts (house/escrow/fees) are allowed to go negative —
              // the house can owe money during a winning streak.
              sql`(${accounts.type} <> 'user' OR ${accounts.balance} + ${deltaStr}::numeric >= 0)`,
            ),
          )
          .returning({ id: accounts.id, balance: accounts.balance });
        if (result.length === 0) {
          throw new LedgerError(
            `insufficient funds in account ${accountId}`,
            "insufficient_funds",
          );
        }
        newBalances.set(result[0].id, result[0].balance);
      }),
    );
  });

  return newBalances;
}

/**
 * Convenience two-leg transfer. Returns post-write balances keyed by accountId.
 */
export async function postTransfer(args: {
  idempotencyKey: string;
  kind: LedgerKind;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<Map<string, string>> {
  return postLedger({
    idempotencyKey: args.idempotencyKey,
    kind: args.kind,
    referenceId: args.referenceId,
    metadata: args.metadata,
    legs: [
      { accountId: args.fromAccountId, direction: "debit", amount: args.amount },
      { accountId: args.toAccountId, direction: "credit", amount: args.amount },
    ],
  });
}

export async function seedDemoBalance(userAccountId: string): Promise<void> {
  const houseId = await getSystemAccountId("house", DEMO_CURRENCY);
  await postTransfer({
    idempotencyKey: `demo-bonus:${userAccountId}`,
    kind: "bonus",
    fromAccountId: houseId,
    toAccountId: userAccountId,
    amount: DEMO_DEPOSIT,
    metadata: { reason: "demo welcome bonus" },
  });
}

export async function getUserBalance(
  userId: string,
  currency = DEMO_CURRENCY,
): Promise<string> {
  const account = await getUserAccount(userId, currency);
  return account?.balance ?? "0";
}

/**
 * Read balance + total_wagered in a single query, joining the user's wallet
 * to their users row. Used on socket connect and the /api/balance endpoint
 * so the client can display level alongside balance without a second hit.
 */
export async function getUserState(
  userId: string,
  currency = DEMO_CURRENCY,
): Promise<{ balance: string; totalWagered: string }> {
  const result = await db.execute<{
    balance: string | null;
    total_wagered: string | null;
  }>(sql`
    SELECT a.balance, u.total_wagered
    FROM users u
    LEFT JOIN accounts a
      ON a.user_id = u.id AND a.type = 'user' AND a.currency = ${currency}
    WHERE u.id = ${userId}::uuid
    LIMIT 1
  `);
  const row = result.rows[0];
  return {
    balance: String(row?.balance ?? "0"),
    totalWagered: String(row?.total_wagered ?? "0"),
  };
}

/**
 * Reserve funds for a bet: debit user wallet, credit escrow, increment the
 * lifetime wager counter. One round-trip — calls the place_bet stored
 * function which does it all atomically server-side.
 *
 * Returns the user's post-write balance and total_wagered. Throws
 * LedgerError "insufficient_funds" if the user can't cover it.
 */
export async function reserveBet(args: {
  betId: string;
  userId: string;
  amount: string;
  roundId: number;
  column: string;
  currency?: string;
}): Promise<{ userBalance: string; totalWagered: string }> {
  const currency = args.currency ?? DEMO_CURRENCY;
  const [userAccountId, escrowId] = await Promise.all([
    getUserAccountId(args.userId, currency),
    getSystemAccountId("escrow", currency),
  ]);

  try {
    const result = await db.execute<{
      new_balance: string;
      new_total_wagered: string;
    }>(sql`
      SELECT new_balance, new_total_wagered FROM place_bet(
        ${`bet:${args.betId}`},
        ${userAccountId}::uuid,
        ${escrowId}::uuid,
        ${args.amount}::numeric,
        ${args.betId},
        ${args.roundId},
        ${args.column}
      )
    `);
    const row = result.rows[0];
    return {
      userBalance: String(row?.new_balance ?? "0"),
      totalWagered: String(row?.new_total_wagered ?? "0"),
    };
  } catch (err) {
    if (isInsufficientFunds(err)) {
      throw new LedgerError("insufficient_funds", "insufficient_funds");
    }
    if (isUniqueViolation(err)) {
      throw new LedgerError(
        `idempotency key already used: bet:${args.betId}`,
        "duplicate_idempotency",
      );
    }
    throw err;
  }
}

/**
 * Reverse a `bet` transfer for a stake that never made it into a round
 * (phase rolled over before the bet landed). One round-trip; idempotent
 * via `refund:<betId>`.
 */
export async function refundBet(args: {
  betId: string;
  userId: string;
  amount: string;
  currency?: string;
}): Promise<{ userBalance: string }> {
  const currency = args.currency ?? DEMO_CURRENCY;
  const [userAccountId, escrowId] = await Promise.all([
    getUserAccountId(args.userId, currency),
    getSystemAccountId("escrow", currency),
  ]);

  const balances = await postTransfer({
    idempotencyKey: `refund:${args.betId}`,
    kind: "refund",
    fromAccountId: escrowId,
    toAccountId: userAccountId,
    amount: args.amount,
    referenceId: args.betId,
    metadata: { reason: "phase rolled over before bet landed" },
  });
  return { userBalance: balances.get(userAccountId) ?? "0" };
}

/**
 * Pay an affiliate revenue share. Posts a transfer from house to the
 * referrer's affiliate account. Idempotent on `affiliate:<betId>`.
 */
export async function payAffiliateShare(args: {
  betId: string;
  referrerUserId: string;
  amount: string;
  currency?: string;
}): Promise<void> {
  const currency = args.currency ?? DEMO_CURRENCY;
  const houseId = await getSystemAccountId("house", currency);
  const affiliateAccountId = await getOrCreateAffiliateAccountId(
    args.referrerUserId,
    currency,
  );

  await postTransfer({
    idempotencyKey: `affiliate:${args.betId}`,
    kind: "affiliate_share",
    fromAccountId: houseId,
    toAccountId: affiliateAccountId,
    amount: args.amount,
    referenceId: args.betId,
    metadata: { kind: "loss share", referrerUserId: args.referrerUserId },
  });
}

const affiliateAccountCache = new Map<string, string>(); // userId:currency → id

async function getOrCreateAffiliateAccountId(
  userId: string,
  currency: string,
): Promise<string> {
  const key = `${userId}:${currency}`;
  const cached = affiliateAccountCache.get(key);
  if (cached) return cached;

  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.currency, currency),
        eq(accounts.type, "affiliate"),
      ),
    )
    .limit(1);
  if (existing[0]) {
    affiliateAccountCache.set(key, existing[0].id);
    return existing[0].id;
  }

  const [created] = await db
    .insert(accounts)
    .values({ type: "affiliate", currency, userId })
    .returning({ id: accounts.id });
  affiliateAccountCache.set(key, created.id);
  return created.id;
}

/**
 * Settle a single bet outcome. One round-trip via the settle_bet function.
 * Returns the user's post-write balance, or null on a loss.
 */
export async function settleBet(args: {
  betId: string;
  userId: string;
  amount: string; // original stake
  multiplier: number;
  won: boolean;
  roundId: number;
  currency?: string;
}): Promise<{ userBalance: string | null }> {
  const currency = args.currency ?? DEMO_CURRENCY;
  const [userAccountId, escrowId, houseId] = await Promise.all([
    getUserAccountId(args.userId, currency),
    getSystemAccountId("escrow", currency),
    getSystemAccountId("house", currency),
  ]);

  const winnings = args.won ? multiply(args.amount, args.multiplier - 1) : "0";

  try {
    const result = await db.execute<{ settle_bet: string | null }>(sql`
      SELECT settle_bet(
        ${`settle:${args.betId}`},
        ${userAccountId}::uuid,
        ${escrowId}::uuid,
        ${houseId}::uuid,
        ${args.amount}::numeric,
        ${winnings}::numeric,
        ${args.won},
        ${args.betId},
        ${args.roundId}
      ) AS settle_bet
    `);
    const newBalance = result.rows[0]?.settle_bet ?? null;
    return { userBalance: newBalance === null ? null : String(newBalance) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Idempotent retry — settlement already happened.
      return { userBalance: null };
    }
    throw err;
  }
}

// numeric(38, 8) — scale factor 1e8.
const SCALE = 100_000_000n;

function scaleAmount(s: string): bigint {
  const trimmed = s.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ""] = body.split(".");
  const fracPadded = (frac + "00000000").slice(0, 8);
  const value = BigInt(whole) * SCALE + BigInt(fracPadded);
  return negative ? -value : value;
}

function unscaleAmount(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const frac = abs % SCALE;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "") || "0";
  const out = `${whole.toString()}.${fracStr}`;
  return negative ? `-${out}` : out;
}

function multiply(amount: string, factor: number): string {
  // Round half-away-from-zero to 8 decimals.
  const scaled = Number(amount) * factor;
  return scaled.toFixed(8);
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // pg / @neondatabase/serverless surface 23505 for unique_violation
  return (err as { code?: string }).code === "23505";
}

function isInsufficientFunds(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  // Stored function raises with SQLSTATE P0001 + 'INSUFFICIENT_FUNDS'.
  return e.code === "P0001" && (e.message ?? "").includes("INSUFFICIENT_FUNDS");
}

export { DEMO_CURRENCY, DEMO_DEPOSIT };
