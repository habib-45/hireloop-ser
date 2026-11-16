import { HttpError } from "../lib/http-error.js";

/**
 * Small dependency-free fixed-window rate limiter. It is intentionally
 * in-memory; deployments with multiple instances should use a shared store.
 */
export function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 300,
  name = "api",
  enabled = true,
} = {}) {
  const hits = new Map();

  function cleanup(now) {
    if (hits.size < 1000) {
      return;
    }

    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) {
        hits.delete(key);
      }
    }
  }

  return function rateLimiter(req, res, next) {
    if (!enabled) {
      return next();
    }

    const now = Date.now();
    cleanup(now);

    const key = `${name}:${req.ip ?? req.socket?.remoteAddress ?? "unknown"}`;
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (entry.count > max) {
      res.setHeader("Retry-After", String(resetSeconds));
      throw new HttpError(
        429,
        "RATE_LIMITED",
        "Too many requests. Please try again shortly."
      );
    }

    next();
  };
}
