import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sweepChildWallets } from "@/lib/solanaOps";
import { houseAddress } from "@/lib/solanaCustody";

export const runtime = "nodejs";
export const maxDuration = 60; // sweep can be slow; bump server timeout

/**
 * Consolidate every user's deposit wallet into the house wallet. Idempotent
 * in spirit — a wallet already at dust is skipped, and the on-chain tx is
 * the source of truth. Safe to call repeatedly.
 *
 * Hits one Solana RPC call per user (getBalance), plus 2 per swept user
 * (recent blockhash + send + confirm). For the MVP this runs synchronously
 * on demand. Production should drive it from a cron + queue.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const [admin] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!admin?.isAdmin) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const swept = await sweepChildWallets();
    return Response.json({
      house: houseAddress(),
      swept,
      totalLamports: swept.reduce((s, x) => s + x.lamportsSwept, 0),
    });
  } catch (err) {
    console.error("[admin/sweep] failed", err);
    const message = err instanceof Error ? err.message : "sweep failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
