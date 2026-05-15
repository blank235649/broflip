import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getUserState } from "@/lib/db/ledger";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const state = await getUserState(userId);
  // displayName is read on every poll so the header reflects renames
  // without a separate refetch path.
  const [row] = await db
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const displayName =
    row?.displayName ?? row?.email?.split("@")[0] ?? "Player";

  return Response.json({
    balance: state.balance,
    totalWagered: state.totalWagered,
    displayName,
  });
}
