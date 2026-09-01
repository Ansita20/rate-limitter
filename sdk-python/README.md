# throttle-sdk

Python SDK for [Throttle](https://github.com/Ansita20/rate-limitter), a
self-hosted multi-tenant rate limiting API. Throttle has no shared public
endpoint — you run your own instance (Docker, or plain Node + Redis) and
point this SDK at it.

## Install

```bash
pip install throttle-sdk
```

For the optional Flask decorator:

```bash
pip install throttle-sdk[flask]
```

## Usage

```python
from throttle_sdk import Throttle

throttle = Throttle(
    api_key="rlk_...",                       # your project's API key
    base_url="https://your-throttle-host",   # your self-hosted instance
)

result = throttle.check("user_123")
if not result["allowed"]:
    ...  # return a 429
```

## Flask decorator

```python
@app.route('/api/data')
@throttle.flask_decorator(key_fn=lambda: request.remote_addr)
def data():
    ...
```

## Options

| Parameter | Required | Default | Description |
|---|---|---|---|
| `api_key` | yes | — | Your project's API key from the Throttle dashboard |
| `base_url` | yes | — | URL of your self-hosted Throttle instance |
| `timeout` | no | `3.0` | Request timeout in seconds |
| `fail_open` | no | `True` | If the Throttle API is unreachable, allow the request through instead of raising — recommended so a rate-limiter outage doesn't take down your app |

See the [main repo](https://github.com/Ansita20/rate-limitter) for how to
run your own Throttle instance.
