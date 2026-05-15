import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { accounts, users } from "@/lib/db/schema";
import { DEMO_CURRENCY, LedgerError, postTransfer } from "@/lib/db/ledger";
import { RateLimiter, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

// 30 admin adjustments per admin per minute. Real admin work won't hit this;
// containment for a compromised admin session.
const adjustLimiter = new RateLimiter(60 * 1000, 30);

interface Body {
  amount?: unknown;
  reason?: unknown;
  direction?: unknown;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const [adminUser] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!adminUser?.isAdmin) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const limit = adjustLimiter.check(session.user.id);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterMs);

  const { id: targetUserId } = await ctx.params;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const amountRaw = String(body.amount ?? "");
  const amountNum = Number(amountRaw);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return Response.json({ error: "invalid amount" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "";
  if (!reason) {
    return Response.json({ error: "reason required" }, { status: 400 });
  }
  const direction = body.direction === "debit" ? "debit" : "credit";

  // Load the target user's wallet + the house account. House is the
  // counterparty for both directions — credits come from the house, debits
  // go back to it. This keeps the audit trail symmetric.
  const [wallet] = await db
    .select({ id: accounts.id, balance: accounts.balance })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, targetUserId),
        eq(accounts.type, "user"),
        eq(accounts.currency, DEMO_CURRENCY),
      ),
    )
    .limit(1);
  if (!wallet) {
    return Response.json({ error: "user has no wallet" }, { status: 404 });
  }

  const [house] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(eq(accounts.type, "house"), eq(accounts.currency, DEMO_CURRENCY)),
    )
    .limit(1);
  if (!house) {
    return Response.json({ error: "no house account" }, { status: 500 });
  }

  const fromId = direction === "credit" ? house.id : wallet.id;
  const toId = direction === "credit" ? wallet.id : house.id;

  try {
    await postTransfer({
      idempotencyKey: `admin-adjust:${randomUUID()}`,
      kind: "adjustment",
      fromAccountId: fromId,
      toAccountId: toId,
      amount: amountNum.toFixed(2),
      metadata: {
        reason,
        adminId: session.user.id,
        targetUserId,
        direction,
      },
    });
  } catch (err) {
    if (err instanceof LedgerError && err.code === "insufficient_funds") {
      return Response.json(
        { error: "user balance can't go negative" },
        { status: 400 },
      );
    }
    console.error("[admin] adjust failed", err);
    return Response.json({ error: "adjustment failed" }, { status: 500 });
  }

  // Re-read the new balance for the response.
  const [refreshed] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.id, wallet.id))
    .limit(1);

  return Response.json({ ok: true, balance: refreshed?.balance ?? "0" });
}
