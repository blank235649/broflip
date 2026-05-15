import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { scanUserDeposits } from "@/lib/solanaOps";
import { RateLimiter, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Each scan does multiple RPC + DB round trips. 4/min/user is enough for
// "I just sent it, why isn't it credited" while protecting our RPC budget.
const scanLimiter = new RateLimiter(60_000, 4);

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const limit = scanLimiter.check(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterMs);

  const [user] = await db
    .select({ accountIndex: users.solanaAccountIndex })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    return Response.json({ error: "user not found" }, { status: 404 });
  }

  try {
    const credited = await scanUserDeposits({
      userId,
      accountIndex: user.accountIndex,
    });
    return Response.json({ credited });
  } catch (err) {
    console.error("[deposit/scan] failed", err);
    const message = err instanceof Error ? err.message : "scan failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
