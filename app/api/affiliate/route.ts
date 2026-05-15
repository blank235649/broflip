import { and, count, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { accounts, users } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const [me] = await db
    .select({ referralCode: users.referralCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [referredCount] = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.referredById, userId));

  const [affiliateAccount] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.type, "affiliate"),
        eq(accounts.currency, "USD"),
      ),
    )
    .limit(1);

  return Response.json({
    referralCode: me?.referralCode ?? null,
    referredCount: Number(referredCount?.value ?? 0),
    affiliateBalance: affiliateAccount?.balance ?? "0",
  });
}
