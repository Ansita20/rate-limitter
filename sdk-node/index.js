/**
 * Throttle Node.js SDK
 * Wraps the /v1/check REST endpoint so developers don't hand-roll HTTP calls.
 *
 * Usage:
 *   const { Throttle } = require('throttle-sdk');
 *   const throttle = new Throttle({ apiKey: 'rlk_...', baseUrl: 'https://your-throttle-host' });
 *
 *   const { allowed, remaining } = await throttle.check('user_123');
 *   if (!allowed) {
 *     return res.status(429).json({ error: 'Too many requests' });
 *   }
 */

class Throttle {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey - your project's API key
   * @param {string} opts.baseUrl - the URL of your self-hosted Throttle instance
   *   (Throttle has no shared public API — you run your own; see the README)
   * @param {number} [opts.timeoutMs] - request timeout, default 3000ms
   * @param {boolean} [opts.failOpen] - if the API is unreachable, allow the
   *   request through instead of throwing. Default true (recommended for
   *   most apps — a rate limiter outage shouldn't take down your whole site).
   */
  constructor({ apiKey, baseUrl, timeoutMs = 3000, failOpen = true }) {
    if (!apiKey) throw new Error('Throttle: apiKey is required');
    if (!baseUrl) throw new Error('Throttle: baseUrl is required — point it at your self-hosted Throttle instance');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.failOpen = failOpen;
  }

  /**
   * Check (and consume) the rate limit for an identifier.
   * @param {string} identifier - your end-user's id, IP, or API key
   * @returns {Promise<{allowed: boolean, remaining: number|null, resetMs: number|null}>}
   */
  async check(identifier) {
    if (!identifier) throw new Error('Throttle.check: identifier is required');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/v1/check`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await res.json();
      if (res.status === 401) throw new Error(`Throttle: invalid API key`);
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (this.failOpen) {
        return { allowed: true, remaining: null, resetMs: null, warning: 'throttle_unreachable' };
      }
      throw err;
    }
  }

  /**
   * Express middleware — drop straight into a route or router.
   * @param {(req) => string} [keyFn] - defaults to req.ip
   */
  middleware(keyFn = (req) => req.ip) {
    return async (req, res, next) => {
      const result = await this.check(keyFn(req));
      res.set('X-RateLimit-Remaining', String(result.remaining));
      if (!result.allowed) {
        return res.status(429).json({ error: 'Too many requests' });
      }
      next();
    };
  }
}

module.exports = { Throttle };
