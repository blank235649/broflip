import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * Server-side guard for admin routes. Redirects unauthenticated users and
 * non-admins back to /. The home page surfaces the auth modal — sending
 * them there lets them sign in without a dead /login route.
 *
 * Use at the top of every admin server component / route handler — never
 * trust the client to enforce admin-only access.
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      isAdmin: users.isAdmin,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user || !user.isAdmin) redirect("/");
  return user;
}
