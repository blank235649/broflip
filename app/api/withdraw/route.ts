import { auth } from "@/auth";
import { sendWithdrawal } from "@/lib/solanaOps";
import { tryParseSolanaAddress } from "@/lib/solanaCustody";
import { LedgerError } from "@/lib/db/ledger";
import { RateLimiter, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

// 3 attempts per user per 5 min. Withdrawals are the most abused action;
// also gives the operator a window to notice anomalies before they pile up.
const withdrawLimiter = new RateLimiter(5 * 60_000, 3);

interface Body {
  toAddress?: unknown;
  amountUsd?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const limit = withdrawLimiter.check(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterMs);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const toAddress =
    typeof body.toAddress === "string" ? body.toAddress.trim() : "";
  const amountUsd = Number(body.amountUsd);

  if (!tryParseSolanaAddress(toAddress)) {
    return Response.json({ error: "invalid Solana address" }, { status: 400 });
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return Response.json({ error: "invalid amount" }, { status: 400 });
  }

  try {
    const result = await sendWithdrawal({ userId, toAddress, amountUsd });
    return Response.json(result);
  } catch (err) {
    if (err instanceof LedgerError && err.code === "insufficient_funds") {
      return Response.json(
        { error: "insufficient balance" },
        { status: 400 },
      );
    }
    console.error("[withdraw] failed", err);
    const message = err instanceof Error ? err.message : "withdrawal failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
