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

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

module.exports = redis;
