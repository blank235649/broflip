import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { DEMO_CURRENCY, postTransfer } from "@/lib/db/ledger";
import { RateLimiter, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

// 5 claims per user per minute. Each claim is a ledger transfer; legitimate
// users won't hit this, but it bounds the blast radius of a stolen session.
const claimLimiter = new RateLimiter(60 * 1000, 5);

/**
 * Move the user's affiliate balance into their main wallet. One-shot transfer
 * — uses a fresh UUID as the idempotency key so multiple claims always
 * succeed (each is its own transaction).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const limit = claimLimiter.check(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterMs);

  const [affiliate] = await db
    .select({ id: accounts.id, balance: accounts.balance })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.type, "affiliate"),
        eq(accounts.currency, DEMO_CURRENCY),
      ),
    )
    .limit(1);

  if (!affiliate || Number(affiliate.balance) <= 0) {
    return Response.json({ error: "nothing to claim" }, { status: 400 });
  }

  const [wallet] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.type, "user"),
        eq(accounts.currency, DEMO_CURRENCY),
      ),
    )
    .limit(1);
  if (!wallet) {
    return Response.json({ error: "no main wallet" }, { status: 500 });
  }

  await postTransfer({
    idempotencyKey: `affiliate-claim:${randomUUID()}`,
    kind: "adjustment",
    fromAccountId: affiliate.id,
    toAccountId: wallet.id,
    amount: affiliate.balance,
    metadata: { reason: "affiliate balance claimed" },
  });

  return Response.json({ claimed: affiliate.balance });
}
