"""CORS for the public widget endpoints.

The widget is embedded in arbitrary third-party origins, which the app-wide
CORS policy (restricted to the app's own origins in production) would block.
For ``/api/widget/*`` only, answer preflights and echo the caller's origin;
the real access control is the per-key origin allowlist enforced by the
endpoint itself (the widget never sends cookies or credentials).
"""

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

PREFIX = "/api/widget/"
ALLOW_HEADERS = "Content-Type, X-Widget-Key"


class WidgetCORSMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(PREFIX):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if not origin:
            await self.app(scope, receive, send)
            return

        if scope["method"] == "OPTIONS" and "access-control-request-method" in headers:
            response = Response(
                status_code=204,
                headers={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": ALLOW_HEADERS,
                    "Access-Control-Max-Age": "86400",
                    "Vary": "Origin",
                },
            )
            await response(scope, receive, send)
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers["Access-Control-Allow-Origin"] = origin
                response_headers["Access-Control-Expose-Headers"] = "Retry-After"
                response_headers.append("Vary", "Origin")
            await send(message)

        await self.app(scope, receive, send_with_cors)
