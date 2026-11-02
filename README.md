# Throttle

**Language-agnostic rate limiting API, backed by Redis.** Sign up, create a project, pick an algorithm (or let it choose one for you), call one REST endpoint from any language.

[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](./LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange.svg)](#contributing)

Live: [throtlle-ratelimiter.com](https://www.throtlle-ratelimiter.com)(https://rate-limitter-48cj-ho11gzjty-ansita20s-projects.vercel.app/) payments there run on **Razorpay test mode**, so signup and upgrades are safe to try with no real charges.

## Features

- One REST call from any language no client library required
- 5 rate limiting algorithms, plus automatic selection
- Multi-tenant: per-project API keys and usage tracking
- Docker, Node.js SDK, Python SDK

## Quick Start

```bash
git clone https://github.com/Ansita20/rate-limitter.git
cd rate-limitter
docker compose up          # API on http://localhost:4000
```

Without Docker (needs Node.js 18+ and Redis):

```bash
npm install
cp .env.example .env
npm start
```

## Usage

```http
POST /v1/check
Authorization: Bearer <API_KEY>
Content-Type: application/json

{ "identifier": "user_123" }
```

```json
{ "allowed": true, "remaining": 42, "resetMs": 60000 }
```

Return HTTP `429` from your app when `allowed` is `false`.

## Algorithms

| Algorithm                | Best For              |
| ------------------------ | ---------------------- |
| `fixed-window`           | Simple limits          |
| `sliding-window-log`     | High accuracy          |
| `sliding-window-counter` | Accuracy + efficiency  |
| `token-bucket`           | Short bursts           |
| `leaky-bucket`           | Smooth traffic         |
| `auto`                   | Automatic selection    |

## API

```text
POST   /v1/auth/signup
POST   /v1/auth/login
POST   /v1/projects
GET    /v1/projects
DELETE /v1/projects/:apiKey
POST   /v1/check
GET    /v1/usage/:apiKey
GET    /health
```

## Configuration

```env
PORT=4000
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=change-me
CORS_ORIGIN=*
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

`JWT_SECRET` must be changed before production use. `RAZORPAY_KEY_*` should stay on `rzp_test_...` test keys unless you're actually taking live payments — see [.env.example](./.env.example).

## Contributing

PRs welcome! The codebase is small on purpose:

```text
src/
├── server.js       # routes
├── services/        # business logic (users, projects, limiters, payments)
└── clients/          # Redis, Razorpay

dashboard/    sdk-node/    sdk-python/    scripts/
```

1. Fork, branch, make your change
2. `npm test` runs a smoke test against a running instance (`scripts/test-requests.sh`)
3. Open a PR

Bug reports and algorithm ideas are just as welcome as code — open an [issue](https://github.com/Ansita20/rate-limitter/issues).

## License

ISC License. See [LICENSE](./LICENSE).
