# Throttle : rate limiting for any app, in any language

## Link
https://www.throtlle-ratelimiter.com

Sign up, create a "project," pick a rate-limiting algorithm (or let it
pick automatically), and call **one REST endpoint** from your server to
check whether a request should be allowed. That endpoint is plain HTTP +
JSON, so it works from literally any language or framework Node, Python,
Go, Ruby, PHP, Java, a shell script, whatever your website's backend is
written in. Two ready made SDKs (Node, Python) are included for
convenience, but you never *need* them.

```
your server ──POST /v1/check──▶ Throttle API ──▶ Redis ──▶ { allowed: true/false }
```

- [Run it in one command (Docker)](#run-it-in-one-command-docker)
- [Run it without Docker](#run-it-without-docker)
- [How to use it from your app — any language](#how-to-use-it-from-your-app--any-language)
- [Algorithms & "auto" mode](#algorithms--auto-mode)
- [Full API reference](#full-api-reference)
- [Configuration](#configuration)
- [Deploying](#deploying)
- [What's still missing](#whats-still-missing-before-this-is-production-ready)

---

## Run it in one command (Docker)

This is the easiest path it works the same on macOS, Windows, and Linux,
and you don't need Redis or Node installed on your machine at all.

```bash
git clone <this repo>
cd throttle
docker compose up
```

That's it. The API is now running at `http://localhost:4000`, backed by its
own Redis container with persistence enabled. Open `http://localhost:4000`
in a browser for the dashboard (sign up, create a project, get an API key).

To use a custom JWT secret or port, copy `.env.example` to `.env` first
`docker compose` picks it up automatically:

```bash
cp .env.example .env
# edit .env, then:
docker compose up
```

To run in the background: `docker compose up -d`. To stop: `docker compose down`
(add `-v` to also wipe the Redis volume).

## Run it without Docker

Requires Node 18+ and a running Redis instance (local or hosted).

```bash
npm install
cp .env.example .env        # optional but recommended see Configuration below
redis-server &               # skip if you already have Redis running somewhere
npm start
```

Open `http://localhost:4000` for the dashboard.

Verify everything works end to end:

```bash
chmod +x scripts/test-requests.sh
./scripts/test-requests.sh
```

## How to use it from your app any language

Every one of your customers' servers only ever needs to make **one HTTP
call** per request it wants to rate limit:

```
POST /v1/check
Authorization: Bearer <your project's API key>
Content-Type: application/json

{ "identifier": "user_123" }   // your end-user's id, IP, API key, etc.
```

Response:

```json
{ "allowed": true, "remaining": 42, "resetMs": 60000 }
```

If `allowed` is `false`, return a 429 from your own API. That's the entire
integration the snippets below are just this same call, one per
language.

<details open>
<summary><strong>cURL / any shell</strong></summary>

```bash
curl -X POST https://your-throttle-host/v1/check \
  -H "Authorization: Bearer rlk_..." \
  -H "Content-Type: application/json" \
  -d '{"identifier":"user_123"}'
```
</details>

<details>
<summary><strong>Node.js (raw fetch no SDK needed)</strong></summary>

```js
const res = await fetch('https://your-throttle-host/v1/check', {
  method: 'POST',
  headers: { Authorization: 'Bearer rlk_...', 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'user_123' }),
});
const { allowed } = await res.json();
if (!allowed) return res.status(429).json({ error: 'Too many requests' });
```

Or use the included SDK for a one-liner + an Express middleware — see
[`sdk-node/`](./sdk-node).
</details>

<details>
<summary><strong>Python (raw requests no SDK needed)</strong></summary>

```python
import requests
r = requests.post(
    "https://your-throttle-host/v1/check",
    headers={"Authorization": "Bearer rlk_..."},
    json={"identifier": "user_123"},
)
if not r.json()["allowed"]:
    ...  # return a 429
```

Or use the included SDK for a one-liner + a Flask decorator see
[`sdk-python/`](./sdk-python).
</details>

<details>
<summary><strong>Go</strong></summary>

```go
body, _ := json.Marshal(map[string]string{"identifier": "user_123"})
req, _ := http.NewRequest("POST", "https://your-throttle-host/v1/check", bytes.NewReader(body))
req.Header.Set("Authorization", "Bearer rlk_...")
req.Header.Set("Content-Type", "application/json")
resp, _ := http.DefaultClient.Do(req)

var result struct{ Allowed bool `json:"allowed"` }
json.NewDecoder(resp.Body).Decode(&result)
if !result.Allowed {
    // return 429
}
```
</details>

<details>
<summary><strong>Ruby</strong></summary>

```ruby
require 'net/http'
require 'json'

uri = URI('https://your-throttle-host/v1/check')
req = Net::HTTP::Post.new(uri, 'Authorization' => 'Bearer rlk_...', 'Content-Type' => 'application/json')
req.body = { identifier: 'user_123' }.to_json
res = JSON.parse(Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) { |http| http.request(req) }.body)

raise "rate limited" unless res['allowed']
```
</details>

<details>
<summary><strong>PHP</strong></summary>

```php
$ch = curl_init('https://your-throttle-host/v1/check');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer rlk_...', 'Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode(['identifier' => 'user_123']),
]);
$result = json_decode(curl_exec($ch), true);
if (!$result['allowed']) {
    http_response_code(429);
}
```
</details>

<details>
<summary><strong>Java</strong></summary>

```java
HttpClient client = HttpClient.newHttpClient();
HttpRequest req = HttpRequest.newBuilder()
    .uri(URI.create("https://your-throttle-host/v1/check"))
    .header("Authorization", "Bearer rlk_...")
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString("{\"identifier\":\"user_123\"}"))
    .build();
HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString());
// parse res.body() with your JSON library of choice, check "allowed"
```
</details>

Because it's plain REST, this also means the API can be called directly
from a browser (e.g. a static site or SPA) if you want client-side
throttling hints — just make sure `CORS_ORIGIN` (see Configuration) is set
to your site's domain, and never ship a project's API key to untrusted
clients in production; proxy it through your own backend instead.

## Algorithms & "auto" mode

Pick one when you create a project:

| Algo | Required config | Good for |
|---|---|---|
| `fixed-window` | `limit`, `windowSec` | Simple, cheap, slight edge-of-window burst risk |
| `sliding-window-log` | `limit`, `windowMs` | Exact accuracy, higher memory cost |
| `sliding-window-counter` | `limit`, `windowSec` | Accurate + cheap, good default |
| `token-bucket` | `capacity`, `refillRatePerSec` | Allows short natural bursts |
| `leaky-bucket` | `capacity`, `leakRatePerSec` | Smooths bursts for a downstream system |
| `auto` | `limit`, `windowSec` | Let Throttle pick per identifier, live |

### How "auto" mode works

Set `"algo": "auto"` and Throttle classifies **each identifier's** recent
traffic shape and picks between `sliding-window-counter`, `token-bucket`,
or `leaky-bucket` in real time — no two users on your platform have to be
governed by the same algorithm.

The classifier looks at the coefficient of variation of the gaps between
an identifier's requests:

- **Bursty traffic** (highly irregular gaps) → `leaky-bucket`, which
  smooths bursts and protects whatever's downstream of you.
- **Steady, fast traffic** → `token-bucket`, which allows small natural
  bursts without penalizing normal use.
- **Low or sporadic traffic** (or not enough data yet) → `sliding window counter`,
  which is accurate and cheap with no burst tolerance needed.

**Be accurate about what this is**: it's a transparent heuristic, not
machine learning. It doesn't train on data or improve over time — it
applies the same fixed rule every time, and you can read the whole rule in
[`src/services/limiters.js`](./src/services/limiters.js). That's a legitimate and useful feature;
just don't market it as "AI-powered" or "self-learning," because it isn't.
A real ML-based anomaly detector would need training data, a model, and a
retraining pipeline — a much bigger project, worth doing once you have
real traffic data to learn from.

**Efficiency**: classification is computed with an online exponential
moving average stored in a single small Redis hash per identifier (4
fields), updated atomically via one Lua script one Redis round trip per
check, constant memory, and it adapts to a change in traffic shape within
a handful of requests. (An earlier version of this stored the last 20 raw
timestamps in a list and recomputed everything from scratch on every
single check — 4 Redis round trips and O(n log n) work per request. The
current version does the same job in 1 round trip and O(1) work.)

## Full API reference

### Auth

```bash
POST /v1/auth/signup   { "email": "...", "password": "min 8 chars" }  -> { userId, email, token }
POST /v1/auth/login    { "email": "...", "password": "..." }          -> { userId, email, token }
```

Use the returned `token` as `Authorization: Bearer <token>` for all
`/v1/projects` and `/v1/usage` calls. This is a **user session token** —
don't confuse it with a project's **API key**, which is what your
customers' own servers use to call `/v1/check`.

### Projects (require `Authorization: Bearer <jwt>`)

```bash
POST   /v1/projects            { "name": "...", "algo": "...", ...algo config }  -> { projectId, apiKey, config }
GET    /v1/projects                                                              -> { projects: [...] }
DELETE /v1/projects/:apiKey                                                      -> { deleted: true }
GET    /v1/usage/:apiKey                                                         -> { projectId, month, requestCount }
```

### Rate limit check (requires a project's `Authorization: Bearer <api_key>`)

```bash
POST /v1/check   { "identifier": "..." }  -> { allowed, remaining, resetMs }
```

Also sets `X-RateLimit-Remaining` and, where applicable, `X-RateLimit-Reset`
response headers.

### Misc

```bash
GET /health   -> { ok: true }
```

## Configuration

All configuration is via environment variables (or a `.env` file — copy
`.env.example` to get started):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Port the API listens on |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Any Redis connection string, including managed providers (`rediss://...` for TLS) |
| `JWT_SECRET` | dev placeholder | **Change this** before handling real users |
| `CORS_ORIGIN` | allow all | Comma-separated list of origins allowed to call the API from a browser |

## Deploying

Because config is env-var driven and there's a `Dockerfile` +
`docker-compose.yml`, this runs unchanged on any platform that can run a
container and give it a Redis connection string: Render, Railway, Fly.io,
a plain VPS, ECS, etc. Point `REDIS_URL` at your managed Redis (or the
Redis container in `docker-compose.yml` for a self-contained deploy), set
a real `JWT_SECRET`, and you're running in production the same way you ran
it locally.

## What's included

```
throttle/
├── src/
│   ├── server.js              : the API (auth, projects, rate-limit checks, usage)
│   ├── services/
│   │   ├── users.js           : signup/login, JWT sessions, bcrypt password hashing
│   │   ├── projects.js        : project CRUD, ownership, API key generation
│   │   ├── limiters.js        : the 5 algorithms + usage tracking + "auto" heuristic mode
│   │   └── payments.js        : Razorpay order creation + payment verification + plan upgrades
│   └── clients/
│       ├── redisClient.js     : single shared, configurable Redis connection
│       └── razorpayClient.js  : shared Razorpay SDK client
├── dashboard/index.html       : single-file web UI (signup, create/manage projects, view usage)
├── sdk-node/                  : Node.js SDK (`throttle-sdk` on npm, once published)
├── sdk-python/                : Python SDK (`throttle-sdk` on PyPI, once published)
├── scripts/test-requests.sh   : smoke test hitting every endpoint
├── Dockerfile / docker-compose.yml : one command run, works anywhere
└── .env.example
```

## What's still missing before this is production-ready

- **Payment processing** : usage is tracked (`/v1/usage/:apiKey`), but
  nothing charges anyone yet. The monthly counter in Redis is exactly what
  you'd feed into `stripe.subscriptionItems.createUsageRecord()` on a
  cron job : that just isn't wired up here.
- **Email verification / password reset** : signup currently trusts any
  email address.
- **Redis persistence** : `docker-compose.yml` enables AOF persistence for
  you; if you run Redis yourself outside Docker, make sure you've enabled
  AOF or RDB snapshots, or a restart wipes every account and project.
- **Rate limiting on auth endpoints is basic** : fine to start, worth
  hardening (e.g., account lockout after repeated failed logins) before
  handling real user credentials at scale.
- **Horizontal scale** : a single Redis instance is fine for early
  customers; move to Redis Cluster when you outgrow it. Every rate limit
  key is self-contained (`rl:{projectId}:{algo}:{identifier}`), so that
  move doesn't require redesigning the key scheme.
- **True ML-based adaptive limiting** : see "How auto mode works" above.
