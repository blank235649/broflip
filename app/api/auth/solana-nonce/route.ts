import { issueNonce } from "@/lib/solanaSignIn";
import { RateLimiter, getClientIp, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

// 30 nonces per IP per minute. Enough for normal client retries but caps
// memory growth from a noisy actor — each nonce sits in our Map for 5 min.
const nonceLimiter = new RateLimiter(60_000, 30);

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = nonceLimiter.check(ip);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterMs);
  return Response.json({ nonce: issueNonce() });
}
