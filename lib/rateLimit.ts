/**
 * In-process sliding-window rate limiter. One instance per limit policy
 * (e.g. one for signup, one for placeBet). Keys are arbitrary strings —
 * use IP for unauthenticated routes and userId for authenticated ones.
 *
 * For a multi-instance deployment, swap the Map for Redis (e.g.
 * @upstash/ratelimit). The interface stays the same.
 */
export class RateLimiter {
  private buckets = new Map<string, number[]>();
  // Cap the number of distinct keys we track to bound memory under abuse.
  // Oldest-touched key wins eviction (rough LRU via insertion order).
  private readonly maxKeys = 100_000;

  constructor(
    /** Window length in milliseconds. */
    private readonly windowMs: number,
    /** Max requests permitted per key per window. */
    private readonly maxRequests: number,
  ) {}

  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = this.buckets.get(key);
    if (timestamps) {
      // Drop expired entries before counting.
      while (timestamps.length && timestamps[0] <= cutoff) timestamps.shift();
    } else {
      timestamps = [];
    }

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      return { allowed: false, retryAfterMs: oldest + this.windowMs - now };
    }

    timestamps.push(now);
    // Re-insert to keep insertion-order-based LRU semantics.
    this.buckets.delete(key);
    this.buckets.set(key, timestamps);

    if (this.buckets.size > this.maxKeys) {
      // Evict the least-recently-touched key.
      const firstKey = this.buckets.keys().next().value;
      if (firstKey !== undefined) this.buckets.delete(firstKey);
    }
    return { allowed: true, retryAfterMs: 0 };
  }
}

/**
 * Best-effort client IP from a Next.js Request. Trusts forwarder headers —
 * fine behind a single trusted proxy (Vercel, Cloudflare). For untrusted
 * environments use only `request.ip` from the runtime instead.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}

/** 429 helper used by all HTTP rate-limited routes. */
export function tooManyRequests(retryAfterMs: number): Response {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    { error: "rate limited", retryAfterSec },
    {
      status: 429,
      headers: { "retry-after": String(retryAfterSec) },
    },
  );
}
