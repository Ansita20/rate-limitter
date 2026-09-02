# Throttle

A language-agnostic rate-limiting API backed by Redis.

## Link

Live project: https://www.throtlle-ratelimiter.com

> I couldn't get the `throttle` domain name, so I registered `throtlle` instead and used it for the project.

## Features

* REST API — works with any language/framework
* Redis-backed rate limiting
* 5 rate-limiting algorithms
* Automatic algorithm selection
* Docker support
* Node.js and Python SDKs

## Quick Start

### Docker

```bash
git clone <this-repo>
cd throttle
docker compose up
```

API: `http://localhost:4000`

### Without Docker

Requires Node.js 18+ and Redis.

```bash
npm install
cp .env.example .env
npm start
```

## Rate Limit Check

```http
POST /v1/check
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "identifier": "user_123"
}
```

Response:

```json
{
  "allowed": true,
  "remaining": 42,
  "resetMs": 60000
}
```

If `allowed` is `false`, return HTTP `429` from your application.

## Algorithms

| Algorithm                | Best For              |
| ------------------------ | --------------------- |
| `fixed-window`           | Simple limits         |
| `sliding-window-log`     | High accuracy         |
| `sliding-window-counter` | Accuracy + efficiency |
| `token-bucket`           | Short bursts          |
| `leaky-bucket`           | Smooth traffic        |
| `auto`                   | Automatic selection   |

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
```

Change `JWT_SECRET` before production use.

## Project Structure

```text
src/
├── server.js
├── services/
│   ├── users.js
│   ├── projects.js
│   ├── limiters.js
│   └── payments.js
└── clients/
    ├── redisClient.js
    └── razorpayClient.js

dashboard/
sdk-node/
sdk-python/
scripts/
Dockerfile
docker-compose.yml
.env.example
```

## License

MIT License. See [LICENSE](./LICENSE).
