import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// All monetary amounts are stored as numeric(38, 8) — enough headroom for
// satoshi precision (1e-8 BTC) and far above any realistic balance. Amounts
// are always positive; direction (debit/credit) is tracked on the entry row.

export const accountType = pgEnum("account_type", [
  "user",
  "house",
  "fees",
  "escrow",
  "pending_withdrawal",
  "bonus",
  "affiliate",
]);

export const transactionKind = pgEnum("transaction_kind", [
  "deposit",
  "withdrawal",
  "bet",
  "payout",
  "bonus",
  "adjustment",
  "refund",
  "affiliate_share",
]);

export const entryDirection = pgEnum("entry_direction", ["debit", "credit"]);

export const outcomeEnum = pgEnum("round_outcome", ["HH", "TT", "MIXED"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // Nullable: Google-OAuth and wallet-only accounts have no password.
  passwordHash: text("password_hash"),
  // Solana wallet bound to this account, base58. Unique so a wallet can
  // only ever map to one user. Nullable for email/Google-only accounts.
  solanaAddress: text("solana_address").unique(),
  displayName: text("display_name"),
  isAdmin: boolean("is_admin").notNull().default(false),
  // Short shareable code other users can sign up under.
  referralCode: text("referral_code").unique(),
  // Self-FK to the user who referred this account, if any.
  referredById: uuid("referred_by_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  // Lifetime sum of bet stakes. Incremented inside place_bet so it stays
  // perfectly in sync with the ledger. Level is derived from this — never
  // stored — to prevent drift.
  totalWagered: numeric("total_wagered", { precision: 38, scale: 8 })
    .notNull()
    .default("0"),
  // Auto-incrementing index used to derive this user's Solana deposit
  // address from the master mnemonic via path m/44'/501'/N'/0'. Permanent
  // and unique — never recycled, even if a user is deleted.
  solanaAccountIndex: serial("solana_account_index").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    type: accountType("type").notNull(),
    currency: text("currency").notNull(),
    // Denormalized balance for fast reads. Must always be updated in the same
    // SQL transaction as the entries that change it; reconcile periodically
    // against SUM(entries) to catch drift.
    balance: numeric("balance", { precision: 38, scale: 8 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_user_currency_type_uq").on(t.userId, t.currency, t.type),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Idempotency key — required on every write so retries can't double-spend.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    kind: transactionKind("kind").notNull(),
    // Free-form ref to the domain object (round id, deposit txid, etc.)
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("transactions_kind_idx").on(t.kind, t.createdAt)],
);

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    direction: entryDirection("direction").notNull(),
    amount: numeric("amount", { precision: 38, scale: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("entries_transaction_idx").on(t.transactionId),
    index("entries_account_idx").on(t.accountId, t.createdAt),
  ],
);

// One row per UTC day. server_seed is kept secret until revealed_at is set;
// only server_seed_hash is published while the period is active. Every round
// during the day uses (server_seed, client_seed, nonce) with nonce
// auto-incrementing per round.
export const seedPeriods = pgTable(
  "seed_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodDate: date("period_date").notNull().unique(),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    nextNonce: integer("next_nonce").notNull().default(0),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("seed_periods_revealed_idx").on(t.revealedAt)],
);

// Persisted round outcomes — once seed_periods.revealed_at is set, anyone can
// recompute these from the (now-public) server seed.
export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seedPeriodId: uuid("seed_period_id")
      .notNull()
      .references(() => seedPeriods.id, { onDelete: "restrict" }),
    nonce: integer("nonce").notNull(),
    coinA: text("coin_a").notNull(),
    coinB: text("coin_b").notNull(),
    outcome: outcomeEnum("outcome").notNull(),
    flippedAt: timestamp("flipped_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rounds_period_nonce_uq").on(t.seedPeriodId, t.nonce),
  ],
);

// One row per detected on-chain deposit. signature is the Solana tx hash;
// the unique constraint dedupes — the scan poller is allowed to re-process
// the same address indefinitely without double-crediting.
export const solanaDeposits = pgTable(
  "solana_deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    signature: text("signature").notNull().unique(),
    slot: integer("slot").notNull(),
    amountSol: numeric("amount_sol", { precision: 38, scale: 9 }).notNull(),
    amountUsd: numeric("amount_usd", { precision: 38, scale: 8 }).notNull(),
    creditedAt: timestamp("credited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("solana_deposits_user_idx").on(t.userId, t.creditedAt)],
);

export const withdrawalStatus = pgEnum("withdrawal_status", [
  "pending",
  "sent",
  "failed",
]);

export const solanaWithdrawals = pgTable(
  "solana_withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    toAddress: text("to_address").notNull(),
    amountSol: numeric("amount_sol", { precision: 38, scale: 9 }).notNull(),
    amountUsd: numeric("amount_usd", { precision: 38, scale: 8 }).notNull(),
    signature: text("signature"), // null until the on-chain send succeeds
    status: withdrawalStatus("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("solana_withdrawals_user_idx").on(t.userId, t.requestedAt)],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Entry = typeof entries.$inferSelect;
export type SeedPeriod = typeof seedPeriods.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type SolanaDeposit = typeof solanaDeposits.$inferSelect;
export type SolanaWithdrawal = typeof solanaWithdrawals.$inferSelect;
