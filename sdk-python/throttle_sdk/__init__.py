"""
Throttle Python SDK
Wraps the /v1/check REST endpoint.

Usage:
    from throttle_sdk import Throttle

    throttle = Throttle(api_key="rlk_...", base_url="https://your-throttle-host")
    result = throttle.check("user_123")
    if not result["allowed"]:
        # return a 429
        ...
"""

import requests


class Throttle:
    def __init__(self, api_key, base_url=None, timeout=3.0, fail_open=True):
        """
        :param api_key: your project's API key
        :param base_url: the URL of your self-hosted Throttle instance
            (Throttle has no shared public API — you run your own; see the README)
        :param timeout: request timeout in seconds, default 3.0
        :param fail_open: if the API is unreachable, allow the request through
            instead of raising. Default True (recommended — a rate limiter
            outage shouldn't take down your whole app).
        """
        if not api_key:
            raise ValueError("Throttle: api_key is required")
        if not base_url:
            raise ValueError("Throttle: base_url is required — point it at your self-hosted Throttle instance")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.fail_open = fail_open

    def check(self, identifier):
        """
        Check (and consume) the rate limit for an identifier.

        :param identifier: your end-user's id, IP, or API key
        :return: dict with keys allowed (bool), remaining (int|None), resetMs (int|None)
        """
        if not identifier:
            raise ValueError("Throttle.check: identifier is required")

        try:
            resp = requests.post(
                f"{self.base_url}/v1/check",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={"identifier": identifier},
                timeout=self.timeout,
            )
            if resp.status_code == 401:
                raise ValueError("Throttle: invalid API key")
            return resp.json()
        except requests.RequestException:
            if self.fail_open:
                return {"allowed": True, "remaining": None, "resetMs": None, "warning": "throttle_unreachable"}
            raise

    def flask_decorator(self, key_fn=None):
        """
        Flask route decorator.
        Usage:
            @app.route('/api/data')
            @throttle.flask_decorator(key_fn=lambda: request.remote_addr)
            def data():
                ...
        """
        from functools import wraps
        from flask import jsonify

        def decorator(fn):
            @wraps(fn)
            def wrapped(*args, **kwargs):
                from flask import request
                identifier = key_fn() if key_fn else request.remote_addr
                result = self.check(identifier)
                if not result["allowed"]:
                    return jsonify({"error": "Too many requests"}), 429
                return fn(*args, **kwargs)
            return wrapped
        return decorator
