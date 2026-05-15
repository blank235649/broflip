import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  getRpcUrl,
  getSolUsdPrice,
  userDepositAddress,
} from "@/lib/solanaCustody";
import { getOnChainBalance } from "@/lib/solanaOps";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const [user] = await db
    .select({ accountIndex: users.solanaAccountIndex })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!user) {
    return Response.json({ error: "user not found" }, { status: 404 });
  }

  const address = userDepositAddress(user.accountIndex);
  const onChain = await getOnChainBalance(user.accountIndex).catch(() => null);

  return Response.json({
    address,
    accountIndex: user.accountIndex,
    network: getRpcUrl().includes("devnet") ? "devnet" : "mainnet-beta",
    solUsdPrice: getSolUsdPrice(),
    pendingOnChain: onChain ?? null,
  });
}
