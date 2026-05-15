import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { RateLimiter, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

// 5 name changes per user per hour. Renames are cheap but high-spam risk
// (alt accounts, impersonation, harassment).
const renameLimiter = new RateLimiter(60 * 60 * 1000, 5);

const MIN_LEN = 3;
const MAX_LEN = 24;
// Letters, numbers, underscore, dot, hyphen, single internal spaces.
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{1,22}[A-Za-z0-9])?$/;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const limit = renameLimiter.check(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterMs);

  let body: { displayName?: unknown };
  try {
    body = (await request.json()) as { displayName?: unknown };
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const raw = typeof body.displayName === "string" ? body.displayName.trim() : "";
  // Collapse internal whitespace to single spaces — no trailing/leading or
  // double-space tricks.
  const displayName = raw.replace(/\s+/g, " ");
  if (displayName.length < MIN_LEN || displayName.length > MAX_LEN) {
    return Response.json(
      { error: `name must be ${MIN_LEN}-${MAX_LEN} characters` },
      { status: 400 },
    );
  }
  if (!NAME_RE.test(displayName)) {
    return Response.json(
      { error: "letters, numbers, spaces, . _ - only" },
      { status: 400 },
    );
  }

  await db
    .update(users)
    .set({ displayName })
    .where(eq(users.id, userId));

  return Response.json({ displayName });
}
