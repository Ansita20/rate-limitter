/**
 * One shared Redis connection for the whole app.
 *
 * Every module used to do `const redis = new Redis()`, which opened a
 * separate connection per file AND hardcoded localhost:6379 — so the
 * only way to run this was "Redis on the same machine, default port."
 * That breaks the moment you deploy anywhere (Docker, Render, Railway,
 * a managed Redis instance, etc).
 *
 * Fix: one connection, configured via REDIS_URL, shared everywhere.
 *
 *   REDIS_URL=redis://127.0.0.1:6379          (local dev, default)
 *   REDIS_URL=redis://:password@host:6379/0   (with auth + db index)
 *   REDIS_URL=rediss://host:6379              (TLS, e.g. most managed providers)
 */

const Redis = require('ioredis');

const url = (process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim();

if (!process.env.REDIS_URL) {
  console.warn('[redis] REDIS_URL is not set — falling back to localhost:6379 (only works in local dev)');
}

const parsed = new URL(url);

// Upstash (and most managed providers) only accept TLS connections. A plain
// redis:// URL to them connects and then hangs, which surfaces as the vague
// "Reached the max retries per request limit" error — so force TLS for them.
const needsTls = parsed.protocol === 'rediss:' || /upstash\.io$/.test(parsed.hostname);

const redis = new Redis(url, {
  maxRetriesPerRequest: 3,
  connectTimeout: 10_000,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  ...(needsTls && { tls: {} }),
});

redis.on('error', (err) => {
  console.error(`[redis] connection error (${parsed.hostname}:${parsed.port || 6379}):`, err.message);
});

// Safe-to-expose summary for /health — never includes the password.
redis.info_summary = {
  host: parsed.hostname,
  port: Number(parsed.port || 6379),
  tls: needsTls,
  urlSet: Boolean(process.env.REDIS_URL),
};

module.exports = redis;
