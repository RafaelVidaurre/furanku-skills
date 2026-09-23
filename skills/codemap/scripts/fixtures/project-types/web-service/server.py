"""Standard-library request pipeline with explicit middleware registration order."""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from domain import reading_list
from store import ReadingStore


def trace(request, next_handler):
    status, body, headers = next_handler(request)
    return status, body, {**headers, "X-Request-Id": request["headers"].get("X-Request-Id", "fixture")}


def authenticate(request, next_handler):
    # A public fixture sentinel, not a credential or production auth design.
    if request["headers"].get("X-Demo-Access") != "reader":
        return 403, {"error": "reader access required"}, {}
    return next_handler(request)


def route(request):
    if request["path"] != "/books":
        return 404, {"error": "route not found"}, {}
    return 200, {"books": reading_list(request["store"])}, {}


MIDDLEWARE = (trace, authenticate)


def dispatch(request):
    handler = route
    # Wrapping in reverse makes the first registration execute first.
    for middleware in reversed(MIDDLEWARE):
        inner = handler
        handler = lambda req, middleware=middleware, inner=inner: middleware(req, inner)
    return handler(request)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        status, body, headers = dispatch({"path": self.path, "headers": self.headers, "store": self.server.store})
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler)
    server.store = ReadingStore(os.environ.get("READING_DB", ":memory:"))
    server.serve_forever()
