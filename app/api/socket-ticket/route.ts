import { auth } from "@/auth";
import { signSocketTicket } from "@/lib/socketAuth";
import { RateLimiter, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

// 30 ticket requests per user per minute. Tickets are minted on socket
// (re)connect, so a flapping client could legitimately rotate fast.
const ticketLimiter = new RateLimiter(60 * 1000, 30);

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const limit = ticketLimiter.check(session.user.id);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterMs);

  const token = await signSocketTicket({
    userId: session.user.id,
    email: session.user.email,
  });
  return Response.json({ token });
}
