# Throttle — multi-tenant rate limiting API

## Link
http://51.21.170.158:4000/

A backend + dashboard where developers sign up, create a "project," pick one
of 5 rate-limiting algorithms (or "auto"), and call a single REST endpoint
from their server — no Redis setup on their end.

## What's included

- **`server.js`** — the API (auth, projects, rate-limit checks, usage)
- **`users.js`** — signup/login, JWT sessions, bcrypt password hashing
- **`projects.js`** — project CRUD, ownership, API key generation
- **`limiters.js`** — the 5 algorithms + usage tracking + "auto" heuristic mode
- **`dashboard/index.html`** — single-file web UI (signup, create/manage projects, view usage)
- **`../sdk-node/`** — Node.js SDK (`throttle-sdk` on npm, once published)
- **`../sdk-python/`** — Python SDK (`throttle-sdk` on PyPI, once published)

All of this has been run end-to-end against a live Redis instance — signup,
login, project creation, all 5 algorithms, auto mode, and both SDKs — not
just written and assumed to work.

## Setup

```bash
npm install
redis-server &
node server.js
```

Open `http://localhost:4000` for the dashboard.

## Auth flow

```bash
# Sign up
curl -X POST http://localhost:4000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"a-real-password"}'
# -> { userId, email, token }
```

Use the returned `token` as `Authorization: Bearer <token>` for all
`/v1/projects` and `/v1/usage` calls. This is a **user session token** — do
not confuse it with a project's **API key**, which is what your customers'
own servers use to call `/v1/check`.

## Create a project

```bash
curl -X POST http://localhost:4000/v1/projects \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-app","algo":"sliding-window-counter","limit":100,"windowSec":60}'
# -> { projectId, apiKey, config }
```

**Required config fields per algo:**

| Algo | Required fields |
|---|---|
| `fixed-window` | `limit`, `windowSec` |
| `sliding-window-log` | `limit`, `windowMs` |
| `sliding-window-counter` | `limit`, `windowSec` |
| `token-bucket` | `capacity`, `refillRatePerSec` |
| `leaky-bucket` | `capacity`, `leakRatePerSec` |
| `auto` | `limit`, `windowSec` (translated internally per chosen sub-algorithm) |

## Check a rate limit (what your customers' servers call)

```bash
curl -X POST http://localhost:4000/v1/check \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"user_123"}'
```

Or via SDK:

```js
// Node
const { Throttle } = require('throttle-sdk');
const throttle = new Throttle({ apiKey: 'rlk_...' });
const { allowed } = await throttle.check('user_123');
```

```python
# Python
from throttle_sdk import Throttle
throttle = Throttle(api_key="rlk_...")
result = throttle.check("user_123")
```

## "Auto" mode — what it actually is

Set `"algo": "auto"` and the API classifies each identifier's recent traffic
(coefficient of variation of request gaps over the last ~20 requests) and
picks between `sliding-window-counter`, `token-bucket`, or `leaky-bucket`
per identifier, in real time.

**Be accurate about this with your users**: it is a transparent heuristic,
not machine learning. It doesn't train on data or improve over time — it
applies the same fixed rule every time. That's a legitimate and useful
feature, but don't market it as "AI-powered" or "self-learning," because it
isn't. If you want real ML-based anomaly detection later, that's a
substantially bigger project (training data, a model, retraining pipeline) —
worth doing once you have real traffic data to learn from, not before.

## Usage tracking (for billing)

Every `/v1/check` call increments a per-project, per-month counter in Redis.

```bash
curl http://localhost:4000/v1/usage/<api_key> -H "Authorization: Bearer <jwt>"
# -> { projectId, month: "2026-08", requestCount: 8 }
```

This gives you the raw numbers to bill on. **Actual billing (charging cards,
plan tiers, invoicing) is not wired up** — that needs a payment processor
integration (e.g., Stripe metered billing) which requires real API
credentials I don't have access to in this environment. The usage counter
above is exactly what you'd feed into `stripe.subscriptionItems.createUsageRecord()`
on a monthly cron job.

## What's still missing before this is production-ready

- **Payment processing** — usage is tracked, but nothing charges anyone yet.
- **Email verification / password reset** — signup currently trusts any email.
- **Redis persistence config** — for production, enable AOF or RDB snapshots
  so project/user data survives a Redis restart. Right now a `FLUSHALL` wipes
  everyone's accounts.
- **Rate limiting on auth endpoints is basic** — fine to start, worth
  hardening (e.g., account lockout after repeated failed logins) before
  handling real user credentials at scale.
- **Horizontal scale** — single Redis instance is fine for early customers;
  move to Redis Cluster when you outgrow it. Because every rate-limit key is
  self-contained (`rl:{projectId}:{algo}:{identifier}`), this move doesn't
  require redesigning the key scheme.
- **True ML-based adaptive limiting** — see "Auto mode" section above.

## Try it

```bash
chmod +x test-requests.sh
./test-requests.sh
```
