# throttle-sdk

Node.js SDK for [Throttle](https://github.com/Ansita20/rate-limitter), a
self-hosted multi-tenant rate limiting API. Throttle has no shared public
endpoint — you run your own instance (Docker, or plain Node + Redis) and
point this SDK at it.

## Install

```bash
npm install throttle-sdk
```

## Usage

```js
const { Throttle } = require('throttle-sdk');

const throttle = new Throttle({
  apiKey: 'rlk_...',                       // your project's API key
  baseUrl: 'https://your-throttle-host',   // your self-hosted instance
});

const { allowed, remaining } = await throttle.check('user_123');
if (!allowed) {
  return res.status(429).json({ error: 'Too many requests' });
}
```

## Express middleware

```js
app.use('/api', throttle.middleware((req) => req.ip));
```

Pass a `keyFn` to control what identifies a caller — defaults to `req.ip`.

## Options

| Option | Required | Default | Description |
|---|---|---|---|
| `apiKey` | yes | — | Your project's API key from the Throttle dashboard |
| `baseUrl` | yes | — | URL of your self-hosted Throttle instance |
| `timeoutMs` | no | `3000` | Request timeout in milliseconds |
| `failOpen` | no | `true` | If the Throttle API is unreachable, allow the request through instead of throwing — recommended so a rate-limiter outage doesn't take down your app |

See the [main repo](https://github.com/Ansita20/rate-limitter) for how to
run your own Throttle instance.
