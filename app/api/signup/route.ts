import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { bootstrapNewUser } from "@/lib/userBootstrap";
import { RateLimiter, getClientIp, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// 5 signups per IP per hour. Tight on purpose — signup is high-value and
// abuse is cheap (each one creates a user + ledger account + bonus payout).
const signupLimiter = new RateLimiter(60 * 60 * 1000, 5);

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = signupLimiter.check(ip);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterMs);

  let body: {
    email?: unknown;
    password?: unknown;
    displayName?: unknown;
    ref?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  const refCode =
    typeof body.ref === "string" ? body.ref.trim().toUpperCase() : "";

  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "invalid email" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return Response.json(
      { error: `password must be at least ${MIN_PASSWORD} chars` },
      { status: 400 },
    );
  }
  if (!displayName) {
    return Response.json({ error: "username required" }, { status: 400 });
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length) {
    return Response.json({ error: "email already registered" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await bootstrapNewUser({
    email,
    passwordHash,
    displayName,
    referralCode: refCode || null,
  });

  return Response.json(
    { id: user.id, email: user.email, referralCode: user.referralCode },
    { status: 201 },
  );
}
