/**
 * Tiny in-memory sliding-window rate limiter.
 * Good enough for a single-instance deployment; swap for Redis/Upstash
 * if this ever scales horizontally.
 */

type Window = { hits: number[] };

const buckets = new Map<string, Window>();

// Periodically sweep old buckets so the map never grows unbounded.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = Date.now();

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, win] of buckets) {
    win.hits = win.hits.filter((t) => now - t < windowMs);
    if (win.hits.length === 0) buckets.delete(key);
  }
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now, windowMs);

  const win = buckets.get(key) ?? { hits: [] };
  win.hits = win.hits.filter((t) => now - t < windowMs);

  if (win.hits.length >= limit) {
    const oldest = win.hits[0];
    buckets.set(key, win);
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((windowMs - (now - oldest)) / 1000),
    };
  }

  win.hits.push(now);
  buckets.set(key, win);
  return { ok: true, retryAfterSeconds: 0 };
}
