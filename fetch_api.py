#!/usr/bin/env python3
"""
Local API for on-demand TrailHub refresh.

Run:
  python fetch_api.py

Then the page button calls POST http://127.0.0.1:8787/api/fetch-photos
which executes pull.py and refreshes data.js/photos.
"""

import json
import os
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8787
ROOT = Path(__file__).resolve().parent


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class TrailHubFetchHandler(BaseHTTPRequestHandler):
    server_version = "TrailHubFetchAPI/1.0"

    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, status, payload):
        self._set_headers(status)
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        if self.path == "/api/health":
            self._json(200, {
                "ok": True,
                "service": "trailhub-fetch-api",
                "time": utc_now_iso(),
            })
            return
        self._json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path != "/api/fetch-photos":
            self._json(404, {"ok": False, "error": "Not found"})
            return

        started_at = utc_now_iso()
        try:
            content_len = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(content_len) if content_len > 0 else b"{}"
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"ok": False, "error": "Invalid JSON body"})
            return

        try:
            limit = int(payload.get("limit", 100))
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(limit, 500))

        cmd = [sys.executable, "pull.py", "--limit", str(limit)]
        env = os.environ.copy()

        try:
            proc = subprocess.run(
                cmd,
                cwd=str(ROOT),
                env=env,
                capture_output=True,
                text=True,
                timeout=420,
            )
        except subprocess.TimeoutExpired as err:
            self._json(504, {
                "ok": False,
                "error": "Photo fetch timed out",
                "startedAt": started_at,
                "finishedAt": utc_now_iso(),
                "stdout": (err.stdout or "")[-5000:],
                "stderr": (err.stderr or "")[-5000:],
            })
            return
        except Exception as err:  # pragma: no cover - defensive only
            self._json(500, {
                "ok": False,
                "error": f"Failed to run pull.py: {err}",
                "traceback": traceback.format_exc().splitlines()[-12:],
                "startedAt": started_at,
                "finishedAt": utc_now_iso(),
            })
            return

        payload = {
            "ok": proc.returncode == 0,
            "exitCode": proc.returncode,
            "startedAt": started_at,
            "finishedAt": utc_now_iso(),
            "stdout": (proc.stdout or "")[-12000:],
            "stderr": (proc.stderr or "")[-12000:],
        }
        self._json(200 if proc.returncode == 0 else 500, payload)


def main():
    server = ThreadingHTTPServer((HOST, PORT), TrailHubFetchHandler)
    print(f"TrailHub fetch API listening on http://{HOST}:{PORT}")
    print("POST /api/fetch-photos to run pull.py on demand.")
    server.serve_forever()


if __name__ == "__main__":
    main()
