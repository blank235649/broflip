import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rounds, seedPeriods } from "@/lib/db/schema";
import { flipCoins, hashServerSeed, outcomeFor } from "@/lib/provablyFair";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ periodDate: string; nonce: string }> },
) {
  const { periodDate, nonce: nonceStr } = await ctx.params;
  const nonce = Number.parseInt(nonceStr, 10);
  if (!Number.isFinite(nonce) || nonce < 0) {
    return Response.json({ error: "invalid nonce" }, { status: 400 });
  }

  const [period] = await db
    .select()
    .from(seedPeriods)
    .where(eq(seedPeriods.periodDate, periodDate))
    .limit(1);
  if (!period) {
    return Response.json({ error: "period not found" }, { status: 404 });
  }

  // Recorded outcome (authoritative for what happened in the live round).
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.seedPeriodId, period.id))
    .limit(1);
  void round;

  const revealed = period.revealedAt !== null;
  if (!revealed) {
    // Period still active — only return the public commit.
    return Response.json({
      periodDate,
      nonce,
      serverSeedHash: period.serverSeedHash,
      clientSeed: period.clientSeed,
      revealed: false,
    });
  }

  // Re-derive the outcome from the now-public seeds. This is the user-facing
  // guarantee — they can verify the same way without trusting our server.
  const coins = flipCoins(period.serverSeed, period.clientSeed, nonce);
  const outcome = outcomeFor(coins);
  const hashOk = hashServerSeed(period.serverSeed) === period.serverSeedHash;

  return Response.json({
    periodDate,
    nonce,
    serverSeed: period.serverSeed,
    serverSeedHash: period.serverSeedHash,
    clientSeed: period.clientSeed,
    coins,
    outcome,
    hashValid: hashOk,
    revealed: true,
  });
}
