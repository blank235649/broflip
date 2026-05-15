import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { accounts, entries, transactions, users } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      totalWagered: users.totalWagered,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // Total bets = count of `bet`-kind transactions where this user's wallet
  // is debited. One row per bet placement.
  const [{ count }] = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM ${transactions} t
    JOIN ${entries} e ON e.transaction_id = t.id AND e.direction = 'debit'
    JOIN ${accounts} a ON a.id = e.account_id AND a.user_id = ${userId}::uuid
    WHERE t.kind = 'bet'
  `).then((r) => ({ count: Number(r.rows[0]?.count ?? 0) }))
   .then((v) => [v]);

  return Response.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email.split("@")[0],
    totalWagered: user.totalWagered,
    betCount: count,
    createdAt: user.createdAt,
  });
}
