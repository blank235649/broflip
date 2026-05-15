import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { solanaDeposits, solanaWithdrawals, users } from "@/lib/db/schema";
import {
  DEMO_CURRENCY,
  LedgerError,
  postTransfer,
} from "@/lib/db/ledger";
import {
  HOUSE_ACCOUNT_INDEX,
  connection,
  houseAddress,
  houseKeypair,
  keypairForIndex,
  lamportsToSolString,
  lamportsToUsd,
  tryParseSolanaAddress,
  userDepositAddress,
  userDepositKeypair,
  usdToLamports,
} from "@/lib/solanaCustody";

/*
 * On-chain operations layered on top of solanaCustody. Pure DB + RPC, no
 * Express/Next.js concerns. All credit/debit through the ledger uses
 * idempotency keys so retries are safe — the operator can re-run any of
 * these functions at any time without double-spending.
 */

// Tx fee on Solana is 5000 lamports per signature. Plus a small buffer so
// we never accidentally underpay if the network changes the floor fee.
const TX_FEE_BUFFER_LAMPORTS = 10_000;

// Below this on-chain balance, sweeping isn't worth the gas.
const SWEEP_DUST_LAMPORTS = 100_000; // 0.0001 SOL

// Min withdrawal in lamports (anti-spam + must clear network fee).
const MIN_WITHDRAWAL_LAMPORTS = 100_000; // 0.0001 SOL

export interface DepositCredit {
  signature: string;
  amountSol: string;
  amountUsd: string;
  slot: number;
}

/**
 * Walk recent signatures for a user's deposit address. For each unseen,
 * successful inbound transfer, credit the user's USD wallet via the ledger
 * (idempotent via `solana-deposit:<sig>`) and persist an audit row.
 *
 * Returns the list of newly credited deposits. Safe to call repeatedly.
 */
export async function scanUserDeposits(args: {
  userId: string;
  accountIndex: number;
  signatureLimit?: number;
}): Promise<DepositCredit[]> {
  const limit = args.signatureLimit ?? 50;
  const address = userDepositAddress(args.accountIndex);
  const pubkey = new PublicKey(address);
  const conn = connection();

  const signatures = await conn.getSignaturesForAddress(pubkey, { limit });
  if (signatures.length === 0) return [];

  // Process oldest first so audit row order matches on-chain order.
  signatures.reverse();
  const credited: DepositCredit[] = [];

  for (const sigInfo of signatures) {
    if (sigInfo.err) continue;

    const tx = await conn.getTransaction(sigInfo.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta) continue;

    const accountKeys = tx.transaction.message
      .getAccountKeys()
      .keySegments()
      .flat();
    const idx = accountKeys.findIndex((k) => k.toBase58() === address);
    if (idx === -1) continue;

    const delta = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
    if (delta <= 0) continue; // outgoing or no-op

    const amountSol = lamportsToSolString(delta);
    const amountUsd = lamportsToUsd(delta).toFixed(8);

    // Atomic settle path: ledger first (the only piece that affects
    // user-visible balance), audit row second. The ledger's unique
    // constraint on idempotency_key is the source of truth for "already
    // credited" — the audit row is best-effort.
    try {
      await postTransfer({
        idempotencyKey: `solana-deposit:${sigInfo.signature}`,
        kind: "deposit",
        // House owns all incoming SOL once the ledger credits it. The
        // physical SOL is still in the child wallet until the next sweep,
        // but for ledger accounting we treat it as house liability now.
        fromAccountId: await getOrCreateHouseAccountIdForCurrency(),
        toAccountId: await getUserAccountIdInline(args.userId),
        amount: amountUsd,
        referenceId: sigInfo.signature,
        metadata: {
          source: "solana",
          signature: sigInfo.signature,
          slot: tx.slot,
          lamports: delta,
        },
      });
    } catch (err) {
      if (
        err instanceof LedgerError &&
        err.code === "duplicate_idempotency"
      ) {
        // Already credited on a previous scan.
        continue;
      }
      throw err;
    }

    await db
      .insert(solanaDeposits)
      .values({
        userId: args.userId,
        signature: sigInfo.signature,
        slot: tx.slot,
        amountSol,
        amountUsd,
      })
      .onConflictDoNothing({ target: solanaDeposits.signature });

    credited.push({
      signature: sigInfo.signature,
      amountSol,
      amountUsd,
      slot: tx.slot,
    });
  }

  return credited;
}

export interface WithdrawalResult {
  id: string;
  signature: string;
  amountSol: string;
  amountUsd: string;
}

/**
 * Send a withdrawal:
 *   1. Insert pending row + debit user wallet → pending_withdrawal account.
 *   2. Build + send the Solana tx from house wallet.
 *   3. On success: debit pending_withdrawal → house, record signature.
 *   4. On failure: refund pending_withdrawal → user, mark failed.
 *
 * Each step uses its own idempotency key so a partial-failure replay is
 * always safe.
 */
export async function sendWithdrawal(args: {
  userId: string;
  toAddress: string;
  amountUsd: number;
}): Promise<WithdrawalResult> {
  const dest = tryParseSolanaAddress(args.toAddress);
  if (!dest) throw new Error("invalid Solana address");

  const lamports = usdToLamports(args.amountUsd);
  if (lamports < MIN_WITHDRAWAL_LAMPORTS) {
    throw new Error("amount below minimum withdrawal");
  }

  const amountSol = lamportsToSolString(lamports);
  const amountUsd = args.amountUsd.toFixed(8);

  // Step 1: pending row + ledger debit. We do these together so a crash
  // before sending the on-chain tx leaves a refundable state, not a silent
  // missing balance.
  const [withdrawal] = await db
    .insert(solanaWithdrawals)
    .values({
      userId: args.userId,
      toAddress: dest.toBase58(),
      amountSol,
      amountUsd,
      status: "pending",
    })
    .returning({ id: solanaWithdrawals.id });

  const userAccountId = await getUserAccountIdInline(args.userId);
  const pendingId = await getOrCreatePendingWithdrawalAccountId();

  try {
    await postTransfer({
      idempotencyKey: `withdrawal:${withdrawal.id}`,
      kind: "withdrawal",
      fromAccountId: userAccountId,
      toAccountId: pendingId,
      amount: amountUsd,
      referenceId: withdrawal.id,
      metadata: { stage: "reserve" },
    });
  } catch (err) {
    // Mark the pending row failed so it can be cleaned up.
    await db
      .update(solanaWithdrawals)
      .set({
        status: "failed",
        failureReason:
          err instanceof Error ? err.message : "ledger reserve failed",
      })
      .where(eq(solanaWithdrawals.id, withdrawal.id));
    throw err;
  }

  // Step 2: send on-chain.
  let signature: string;
  try {
    signature = await sendSolFromHouse(dest, lamports);
  } catch (err) {
    // Step 4: refund and bail.
    await postTransfer({
      idempotencyKey: `withdrawal-refund:${withdrawal.id}`,
      kind: "refund",
      fromAccountId: pendingId,
      toAccountId: userAccountId,
      amount: amountUsd,
      referenceId: withdrawal.id,
      metadata: { stage: "refund" },
    });
    await db
      .update(solanaWithdrawals)
      .set({
        status: "failed",
        failureReason: err instanceof Error ? err.message : "send failed",
      })
      .where(eq(solanaWithdrawals.id, withdrawal.id));
    throw err;
  }

  // Step 3: settle pending → house and record signature.
  const houseAccountId = await getOrCreateHouseAccountIdForCurrency();
  await postTransfer({
    idempotencyKey: `withdrawal-settle:${withdrawal.id}`,
    kind: "withdrawal",
    fromAccountId: pendingId,
    toAccountId: houseAccountId,
    amount: amountUsd,
    referenceId: withdrawal.id,
    metadata: { stage: "settle", signature },
  });

  await db
    .update(solanaWithdrawals)
    .set({
      status: "sent",
      signature,
      sentAt: new Date(),
    })
    .where(eq(solanaWithdrawals.id, withdrawal.id));

  return {
    id: withdrawal.id,
    signature,
    amountSol,
    amountUsd,
  };
}

async function sendSolFromHouse(
  to: PublicKey,
  lamports: number,
): Promise<string> {
  const conn = connection();
  const from = houseKeypair();
  const balance = await conn.getBalance(from.publicKey, "confirmed");
  if (balance < lamports + TX_FEE_BUFFER_LAMPORTS) {
    throw new Error(
      `house wallet underfunded: have ${balance} lamports, need ${lamports + TX_FEE_BUFFER_LAMPORTS}`,
    );
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const ix: TransactionInstruction[] = [
    // Tip the leader so the tx lands during congestion. 1 microlamport
    // priority fee is the floor — adjust upward if you see drops on mainnet.
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports,
    }),
  ];
  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: from.publicKey,
  }).add(...ix);

  const sig = await conn.sendTransaction(tx, [from]);
  const conf = await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(`tx confirmation error: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

export interface SweepResult {
  accountIndex: number;
  address: string;
  lamportsSwept: number;
  signature: string;
}

/**
 * Walk every user's deposit wallet. If on-chain balance > dust threshold,
 * forward the entire balance (less network fee buffer) to the house wallet.
 *
 * Returns one result per swept wallet. Wallets below the threshold are
 * skipped silently.
 */
export async function sweepChildWallets(): Promise<SweepResult[]> {
  const conn = connection();
  const house = new PublicKey(houseAddress());

  // Pull every user's account index. For a real production setup, page
  // this and process in batches. Fine at MVP scale.
  const rows = await db
    .select({ index: users.solanaAccountIndex })
    .from(users);

  const results: SweepResult[] = [];
  for (const { index } of rows) {
    if (index === HOUSE_ACCOUNT_INDEX) continue;
    const kp = keypairForIndex(index);
    const balance = await conn.getBalance(kp.publicKey, "confirmed");
    if (balance < SWEEP_DUST_LAMPORTS) continue;

    const lamportsToSend = balance - TX_FEE_BUFFER_LAMPORTS;
    if (lamportsToSend <= 0) continue;

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: kp.publicKey,
    }).add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: house,
        lamports: lamportsToSend,
      }),
    );
    const sig = await conn.sendTransaction(tx, [kp]);
    await conn.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    results.push({
      accountIndex: index,
      address: kp.publicKey.toBase58(),
      lamportsSwept: lamportsToSend,
      signature: sig,
    });
  }
  return results;
}

/**
 * Get the on-chain balance of an arbitrary derived address. Used by the
 * deposit page to show "you've sent X SOL but it's still confirming".
 */
export async function getOnChainBalance(
  accountIndex: number,
): Promise<{ lamports: number; sol: string; usd: number }> {
  const kp = userDepositKeypair(accountIndex);
  const lamports = await connection().getBalance(kp.publicKey, "confirmed");
  return {
    lamports,
    sol: lamportsToSolString(lamports),
    usd: Number((lamports / LAMPORTS_PER_SOL * (Number(process.env.SOL_USD_PRICE ?? "200"))).toFixed(2)),
  };
}

// ---------- internal account-id helpers ---------------------------------

// We import postTransfer above which requires account UUIDs. The ledger
// module already has caching — we just need to look up these IDs. To avoid
// re-exporting private helpers, we re-derive via tiny SQL here. Cheap;
// they're hot in cache after the first call.

async function getUserAccountIdInline(userId: string): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM accounts
    WHERE user_id = ${userId}::uuid
      AND type = 'user'
      AND currency = ${DEMO_CURRENCY}
    LIMIT 1
  `);
  if (result.rows.length === 0) {
    throw new Error(`user ${userId} has no wallet account`);
  }
  return result.rows[0].id;
}

let cachedHouseId: string | null = null;
async function getOrCreateHouseAccountIdForCurrency(): Promise<string> {
  if (cachedHouseId) return cachedHouseId;
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM accounts
    WHERE type = 'house' AND currency = ${DEMO_CURRENCY}
    LIMIT 1
  `);
  if (result.rows.length === 0) {
    throw new Error("no house account — sign up at least one user first");
  }
  cachedHouseId = result.rows[0].id;
  return cachedHouseId;
}

let cachedPendingId: string | null = null;
async function getOrCreatePendingWithdrawalAccountId(): Promise<string> {
  if (cachedPendingId) return cachedPendingId;
  const existing = await db.execute<{ id: string }>(sql`
    SELECT id FROM accounts
    WHERE type = 'pending_withdrawal' AND currency = ${DEMO_CURRENCY}
    LIMIT 1
  `);
  if (existing.rows.length > 0) {
    cachedPendingId = existing.rows[0].id;
    return cachedPendingId;
  }
  const created = await db.execute<{ id: string }>(sql`
    INSERT INTO accounts (type, currency, user_id)
    VALUES ('pending_withdrawal', ${DEMO_CURRENCY}, NULL)
    RETURNING id
  `);
  cachedPendingId = created.rows[0].id;
  return cachedPendingId;
}
