# Throttle

A language-agnostic rate-limiting API backed by Redis.

Your application makes one HTTP request to `/v1/check` to determine whether a request should be allowed.

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

Dashboard: `http://localhost:4000`

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

| Algorithm                | Best For                      |
| ------------------------ | ----------------------------- |
| `fixed-window`           | Simple and inexpensive limits |
| `sliding-window-log`     | Accurate limits               |
| `sliding-window-counter` | Balanced accuracy and cost    |
| `token-bucket`           | Allowing short bursts         |
| `leaky-bucket`           | Smoothing traffic             |
| `auto`                   | Automatic selection           |

Example:

```json
{
  "name": "my-project",
  "algo": "token-bucket",
  "capacity": 100,
  "refillRatePerSec": 10
}
```

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

Copy `.env.example` to `.env`.

```env
PORT=4000
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=change-me
CORS_ORIGIN=*
```

Change `JWT_SECRET` before using the application with real users.

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
