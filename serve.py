"""Local-only static server for Shader Render.

- Listens on the loopback interface (127.0.0.1) only, so other machines cannot connect.
- Rejects requests whose Host header isn't 127.0.0.1/localhost (blocks DNS-rebinding
  attacks, where a remote web page tries to reach this server through your browser).
- Serves only files inside this folder, with directory listings turned off.
- /api/claude (Image -> Shader) accepts JSON POSTs only from this app's own page
  (Origin check), so other websites can't use it. Anthropic credentials stay in
  this process; see claude_shader.py.
"""

import http.server
import json
import os
import sys

HOST = "127.0.0.1"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
MAX_BODY = 30 * 1024 * 1024


class LocalOnlyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _allowed(self):
        if self.client_address[0] != HOST:
            return False
        return self.headers.get("Host", "").strip().lower() in ALLOWED_HOSTS

    def do_GET(self):
        if not self._allowed():
            self.send_error(403, "Forbidden: local access only")
            return
        if self.path.split("?")[0] == "/api/claude/status":
            import claude_shader
            self._send_json(200, claude_shader.status())
            return
        super().do_GET()

    def do_POST(self):
        if not self._allowed() or self.headers.get("Origin", "") not in ALLOWED_ORIGINS:
            self.send_error(403, "Forbidden: local access only")
            return
        if self.path.split("?")[0] != "/api/claude":
            self.send_error(404, "Not found")
            return
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            self.send_error(415, "Expected JSON")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_error(413, "Request too large")
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "Invalid JSON."})
            return

        import claude_shader
        try:
            self._send_json(200, claude_shader.run(payload))
        except claude_shader.UserFacingError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:  # unexpected: log it, keep the message generic
            print(f"/api/claude failed: {e!r}", file=sys.stderr)
            self._send_json(500, {"error": "Unexpected server error while calling Claude. See the server window."})

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        if not self._allowed():
            self.send_error(403, "Forbidden: local access only")
            return
        super().do_HEAD()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    try:
        server = http.server.ThreadingHTTPServer((HOST, PORT), LocalOnlyHandler)
    except OSError as e:
        print(f"Could not start the server on {HOST}:{PORT} ({e}). Is the port already in use?")
        sys.exit(1)
    print(f"Serving {ROOT}")
    print(f"Local access only: http://{HOST}:{PORT}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
