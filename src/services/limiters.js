/**
 * The 5 rate-limiting algorithms. Same logic as before, but each
 * function takes an explicit `key` (already namespaced per project)
 * instead of building its own key — the caller (server.js) decides
 * the multi-tenant key structure.
 */

const redis = require('../clients/redisClient');

/* ---------------- 1. Fixed window ---------------- */
const fixedWindowScript = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowSec = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, windowSec)
end
local ttl = redis.call('TTL', key)

if current > limit then
  return {0, 0, ttl}
else
  return {1, limit - current, ttl}
end
`;

async function fixedWindow(key, { limit, windowSec }) {
  const [allowed, remaining, ttl] = await redis.eval(fixedWindowScript, 1, key, limit, windowSec);
  return { allowed: allowed === 1, remaining, resetMs: ttl * 1000 };
}

/* ---------------- 2. Sliding window log ---------------- */
const slidingLogScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

local windowStart = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, now .. '-' .. math.random())
  redis.call('PEXPIRE', key, windowMs)
  return {1, limit - count - 1}
else
  return {0, 0}
end
`;

async function slidingWindowLog(key, { limit, windowMs }) {
  const now = Date.now();
  const [allowed, remaining] = await redis.eval(slidingLogScript, 1, key, now, windowMs, limit);
  return { allowed: allowed === 1, remaining, resetMs: windowMs };
}

/* ---------------- 3. Sliding window counter ---------------- */
const slidingCounterScript = `
local currKey = KEYS[1]
local prevKey = KEYS[2]
local now = tonumber(ARGV[1])
local windowSec = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

local currCount = tonumber(redis.call('GET', currKey) or '0')
local prevCount = tonumber(redis.call('GET', prevKey) or '0')

local elapsed = (now % (windowSec * 1000)) / (windowSec * 1000)
local weighted = prevCount * (1 - elapsed) + currCount

if weighted < limit then
  local newCurr = redis.call('INCR', currKey)
  if newCurr == 1 then
    redis.call('EXPIRE', currKey, windowSec * 2)
  end
  return {1, math.floor(limit - weighted - 1)}
else
  return {0, 0}
end
`;

async function slidingWindowCounter(baseKey, { limit, windowSec }) {
  const now = Date.now();
  const windowId = Math.floor(now / (windowSec * 1000));
  const currKey = `${baseKey}:${windowId}`;
  const prevKey = `${baseKey}:${windowId - 1}`;

  const [allowed, remaining] = await redis.eval(
    slidingCounterScript, 2, currKey, prevKey, now, windowSec, limit
  );
  return { allowed: allowed === 1, remaining, resetMs: windowSec * 1000 };
}

/* ---------------- 4. Token bucket ---------------- */
const tokenBucketScript = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRatePerSec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsedSec = math.max(0, (now - ts) / 1000)
tokens = math.min(capacity, tokens + elapsedSec * refillRatePerSec)

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, math.ceil(capacity / refillRatePerSec) * 2)

return {allowed, math.floor(tokens)}
`;

async function tokenBucket(key, { capacity, refillRatePerSec, tokensRequested = 1 }) {
  const now = Date.now();
  const [allowed, remaining] = await redis.eval(
    tokenBucketScript, 1, key, capacity, refillRatePerSec, now, tokensRequested
  );
  return { allowed: allowed === 1, remaining, resetMs: null };
}

/* ---------------- 5. Leaky bucket ---------------- */
const leakyBucketScript = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local leakRatePerSec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'level', 'ts')
local level = tonumber(data[1])
local ts = tonumber(data[2])

if level == nil then
  level = 0
  ts = now
end

local elapsedSec = math.max(0, (now - ts) / 1000)
level = math.max(0, level - elapsedSec * leakRatePerSec)

local allowed = 0
if level < capacity then
  level = level + 1
  allowed = 1
end

redis.call('HMSET', key, 'level', level, 'ts', now)
redis.call('EXPIRE', key, math.ceil(capacity / leakRatePerSec) * 2)

return {allowed, math.max(0, math.floor(capacity - level))}
`;

async function leakyBucket(key, { capacity, leakRatePerSec }) {
  const now = Date.now();
  const [allowed, remaining] = await redis.eval(leakyBucketScript, 1, key, capacity, leakRatePerSec, now);
  return { allowed: allowed === 1, remaining, resetMs: null };
}

const ALGOS = {
  'fixed-window': fixedWindow,
  'sliding-window-log': slidingWindowLog,
  'sliding-window-counter': slidingWindowCounter,
  'token-bucket': tokenBucket,
  'leaky-bucket': leakyBucket,
};

/* ------------------------------------------------------------------ */
/* USAGE TRACKING (for billing)                                       */
/* Increments a per-project, per-month counter on every check.        */
/* ------------------------------------------------------------------ */
async function recordUsage(projectId) {
  const month = new Date().toISOString().slice(0, 7); // "2026-08"
  const key = `usage:${projectId}:${month}`;
  const count = await redis.incr(key);
  // keep ~2 months of history then expire, so keys don't accumulate forever
  if (count === 1) await redis.expire(key, 60 * 60 * 24 * 62);
  return count;
}

async function getUsage(projectId, month = new Date().toISOString().slice(0, 7)) {
  const count = await redis.get(`usage:${projectId}:${month}`);
  return parseInt(count || '0', 10);
}

/* ------------------------------------------------------------------ */
/* AUTO MODE — heuristic-based traffic-adaptive algorithm selection   */
/*                                                                     */
/* IMPORTANT — what this actually is (be honest about it):            */
/* This is NOT machine learning and does not "learn" your traffic.    */
/* It's a simple heuristic: it tracks how bursty recent requests have */
/* been for a given identifier, and picks a stricter or looser        */
/* algorithm accordingly. That's a legitimate, useful technique, but  */
/* it is fundamentally different from an ML anomaly-detection system  */
/* (which would need training data, a model, and ongoing retraining — */
/* a much bigger project than what's below).                          */
/*                                                                     */
/* Heuristic: look at the coefficient of variation of recent request  */
/* gaps for this identifier.                                          */
/*   - Very bursty traffic (lots of variance)  -> leaky bucket        */
/*     (smooths bursts, protects downstream systems)                  */
/*   - Steady traffic near the limit            -> token bucket       */
/*     (allows small natural bursts without penalizing normal use)    */
/*   - Low/sporadic traffic                     -> sliding window     */
/*     counter (accurate, cheap, no need for burst tolerance)         */
/* ------------------------------------------------------------------ */
// --- Efficiency note -------------------------------------------------
// The original version stored the last 20 raw request timestamps in a
// Redis list and, on every single check, pulled the whole list back
// (LRANGE), sorted it, and recomputed mean/variance in JS. That's 4
// Redis round trips (LPUSH, LTRIM, EXPIRE, LRANGE) plus O(n log n) work
// per request — for a hot path that runs on every rate-limit check.
//
// Below does the same classification (coefficient of variation of the
// gaps between requests) but as a streaming/online update: it keeps a
// tiny exponential moving average (EMA) of the gap and its variance in
// a Redis hash, updated atomically inside a single Lua script. That's
// O(1) memory per identifier and exactly 1 Redis round trip per check,
// instead of O(n) memory and 4 round trips. An EMA with alpha=0.3 also
// adapts to a change in traffic shape within a handful of requests,
// rather than waiting for 20 stale samples to scroll out of a list.
const autoClassifyScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local alpha = tonumber(ARGV[2])

local data = redis.call('HMGET', key, 'lastTs', 'meanGap', 'varGap', 'n')
local lastTs = tonumber(data[1])
local meanGap = tonumber(data[2]) or 0
local varGap = tonumber(data[3]) or 0
local n = tonumber(data[4]) or 0

if lastTs ~= nil then
  local gap = math.max(0, now - lastTs)
  local delta = gap - meanGap
  meanGap = meanGap + alpha * delta
  varGap = (1 - alpha) * (varGap + alpha * delta * delta)
  n = n + 1
end

redis.call('HMSET', key, 'lastTs', now, 'meanGap', meanGap, 'varGap', varGap, 'n', n)
redis.call('EXPIRE', key, 300)

return {tostring(meanGap), tostring(varGap), n}
`;

const AUTO_MIN_SAMPLES = 5;   // don't classify off noise — fall back to a safe default until then
const AUTO_EMA_ALPHA = 0.3;   // higher = classifier reacts to bursts faster, but is noisier

async function recordAndClassifyTraffic(identifier, projectId) {
  const key = `auto:${projectId}:${identifier}`;
  const now = Date.now();

  const [meanGapStr, varGapStr, n] = await redis.eval(autoClassifyScript, 1, key, now, AUTO_EMA_ALPHA);
  const meanGap = parseFloat(meanGapStr);
  const varGap = Math.max(0, parseFloat(varGapStr));

  if (n < AUTO_MIN_SAMPLES) {
    return 'sliding-window-counter'; // not enough data yet, use safe default
  }

  const stdDev = Math.sqrt(varGap);
  const coefficientOfVariation = meanGap > 0 ? stdDev / meanGap : 0;

  if (coefficientOfVariation > 1.2) return 'leaky-bucket';       // bursty -> smooth it
  if (meanGap < 200) return 'token-bucket';                       // fast steady traffic -> allow controlled bursts
  return 'sliding-window-counter';                                 // default: accurate, cheap
}

/**
 * Auto mode entry point: classifies traffic, then runs the chosen
 * algorithm with config derived from the project's base limit.
 * Requires project config to include a `limit` (requests) and
 * `windowSec`, which auto mode translates into the chosen algorithm's
 * native parameters.
 */
async function autoMode(baseKey, project, identifier) {
  const chosenAlgo = await recordAndClassifyTraffic(identifier, project.projectId);
  const limiterFn = ALGOS[chosenAlgo];

  let config;
  if (chosenAlgo === 'leaky-bucket') {
    config = { capacity: project.limit, leakRatePerSec: project.limit / project.windowSec };
  } else if (chosenAlgo === 'token-bucket') {
    config = { capacity: project.limit, refillRatePerSec: project.limit / project.windowSec };
  } else {
    config = { limit: project.limit, windowSec: project.windowSec };
  }

  const key = `${baseKey}:auto:${chosenAlgo}`;
  const result = await limiterFn(key, config);
  return { ...result, algoUsed: chosenAlgo };
}

module.exports = { ALGOS, recordUsage, getUsage, autoMode };
