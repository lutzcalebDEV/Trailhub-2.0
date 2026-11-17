"""TrailHub's own SPYPOINT client (replaces the pyspypoint package).

SPYPOINT has no public API. This talks to the same endpoints their app uses, which
pyspypoint also used, so it can break if SPYPOINT changes them. Compared with
pyspypoint it adds what an unattended 5-minute pull needs:

  - every request has a timeout, so a stalled SPYPOINT server can't hang the run
  - network errors and SPYPOINT outages (429/5xx) are retried a couple of times,
    gently; wrong logins and other 4xx answers are not retried
  - an expired token logs in again once instead of failing
  - errors say what went wrong (wrong password, SPYPOINT down, API changed)
  - records come back as plain dicts, exactly as SPYPOINT sent them
  - camera health (battery, signal, SD card, plan usage) via camera_health()

Standard library only.
"""

import json
import time
import urllib.error
import urllib.request

API_BASE = "https://restapi.spypoint.com/api/v3"
TIMEOUT = 30          # seconds per request
ATTEMPTS = 3          # tries for network errors and SPYPOINT outages
USER_AGENT = "TrailHub/1.0"


class SpypointError(Exception):
    """SPYPOINT couldn't be reached or answered with something unexpected."""


class LoginFailed(SpypointError):
    """SPYPOINT rejected the username or password."""


class Client:
    def __init__(self, username, password, timeout=TIMEOUT):
        self.username = username
        self.password = password
        self.timeout = timeout
        self.token = None

    # ---- transport ----------------------------------------------------------

    def _send(self, method, path, body=None, auth=True):
        """One request with retries for transient failures. Returns parsed JSON."""
        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(API_BASE + path, data=data, headers=headers, method=method)

        for attempt in range(1, ATTEMPTS + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    raw = response.read()
            except urllib.error.HTTPError as e:
                transient = e.code == 429 or e.code >= 500
                if not transient or attempt == ATTEMPTS:
                    raise _http_error(e, path) from None
                time.sleep(_retry_after(e, attempt))
                continue
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == ATTEMPTS:
                    reason = getattr(e, "reason", e)
                    raise SpypointError(f"couldn't reach SPYPOINT ({reason})") from None
                time.sleep(_retry_after(None, attempt))
                continue
            try:
                return json.loads(raw.decode("utf-8")) if raw else None
            except ValueError:
                raise SpypointError(f"SPYPOINT sent something that isn't JSON for {path}") from None

    def _call(self, method, path, body=None):
        """An authenticated call. Logs in first, and once more if the token expired."""
        if not self.token:
            self.login()
        try:
            return self._send(method, path, body)
        except _Unauthorized:
            self.login()
            try:
                return self._send(method, path, body)
            except _Unauthorized:
                raise SpypointError(f"SPYPOINT refused {path} right after a fresh login") from None

    # ---- endpoints ----------------------------------------------------------

    def login(self):
        try:
            body = self._send("POST", "/user/login",
                              {"username": self.username, "password": self.password}, auth=False)
        except (_Unauthorized, _ClientError) as e:
            raise LoginFailed("SPYPOINT rejected the login. Check SPYPOINT_USERNAME and "
                              f"SPYPOINT_PASSWORD ({e})") from None
        token = body.get("token") if isinstance(body, dict) else None
        if not token:
            raise SpypointError("SPYPOINT's login answer has no token; the API may have changed")
        self.token = token

    def cameras(self):
        """Every camera on the account, as SPYPOINT's raw dicts."""
        body = self._call("GET", "/camera/all")
        if not isinstance(body, list):
            raise SpypointError("SPYPOINT's camera list isn't a list; the API may have changed")
        return [c for c in body if isinstance(c, dict)]

    def photos(self, camera_ids, limit=100, date_end="2100-01-01T00:00:00.000Z", tags=()):
        """The newest photos across these cameras (newest first), up to `limit` in all.

        Pass an older `date_end` to page further back. (SPYPOINT's "hd" flag is a
        filter for photos that already have an HD copy, not a size request, so it's
        left off: with it set, an account without HD photos gets nothing back.)
        """
        body = self._call("POST", "/photo/all", {
            "camera": [str(c) for c in camera_ids],
            "dateEnd": date_end,
            "favorite": False,
            "hd": False,
            "limit": int(limit),
            "tag": list(tags),
        })
        photos = body.get("photos") if isinstance(body, dict) else None
        if not isinstance(photos, list):
            raise SpypointError("SPYPOINT's photo list has no 'photos'; the API may have changed")
        return [p for p in photos if isinstance(p, dict)]


# ---- photo + camera helpers -------------------------------------------------

def image_url(photo, sizes=("large", "medium", "small")):
    """The biggest image SPYPOINT offers for a photo (a signed link), or None."""
    for size in sizes:
        section = photo.get(size)
        if isinstance(section, dict) and section.get("host") and section.get("path"):
            return f"https://{section['host']}/{section['path']}"
    return None


def camera_health(camera):
    """Battery, signal, SD card and plan usage from a camera record.

    SPYPOINT doesn't document these fields, so every one is optional: anything not
    found is left out rather than guessed. Returns {} when nothing is recognised.
    """
    status = camera.get("status") if isinstance(camera.get("status"), dict) else {}
    out = {}

    batteries = [b for b in status.get("batteries") or [] if _num(b) is not None]
    if batteries:
        out["battery"] = round(max(float(b) for b in batteries))
    elif _num(status.get("battery")) is not None:
        out["battery"] = round(float(status["battery"]))
    if status.get("batteryType"):
        out["power"] = str(status["batteryType"])

    signal = status.get("signal")
    if isinstance(signal, dict):
        processed = signal.get("processed") if isinstance(signal.get("processed"), dict) else signal
        if _num(processed.get("percentage")) is not None:
            out["signal"] = round(float(processed["percentage"]))
        if _num(processed.get("bar")) is not None:
            out["signalBars"] = int(processed["bar"])

    memory = status.get("memory")
    if isinstance(memory, dict) and _num(memory.get("size")) and _num(memory.get("used")) is not None:
        out["sdUsed"] = round(100 * float(memory["used"]) / float(memory["size"]))

    temp = status.get("temperature")
    if isinstance(temp, dict) and _num(temp.get("value")) is not None:
        out["temp"] = round(float(temp["value"]))
        if temp.get("unit"):
            out["tempUnit"] = str(temp["unit"])

    if status.get("lastUpdate"):
        out["lastCheckIn"] = str(status["lastUpdate"])
    if status.get("modelName") or status.get("model"):
        out["model"] = str(status.get("modelName") or status.get("model"))

    subs = camera.get("subscriptions")
    if isinstance(subs, list) and subs and isinstance(subs[0], dict):
        used, cap = _num(subs[0].get("photoCount")), _num(subs[0].get("photoLimit"))
        if used is not None and cap:
            out["planPhotos"] = int(used)
            out["planLimit"] = int(cap)
    return out


# ---- internals --------------------------------------------------------------

class _Unauthorized(SpypointError):
    pass


class _ClientError(SpypointError):
    pass


def _http_error(e, path):
    if e.code == 401:
        return _Unauthorized(f"HTTP 401 on {path}")
    if 400 <= e.code < 500:
        return _ClientError(f"SPYPOINT answered HTTP {e.code} on {path}; the API may have changed")
    return SpypointError(f"SPYPOINT answered HTTP {e.code} on {path}; it may be down")


def _retry_after(e, attempt):
    """Seconds to wait before the next try: the server's Retry-After, capped, else 2s, 6s."""
    if e is not None:
        value = e.headers.get("Retry-After") if e.headers else None
        if value and value.isdigit():
            return min(int(value), 60)
    return 2 * (3 ** (attempt - 1))


def _num(v):
    try:
        return None if v is None or isinstance(v, bool) else float(v)
    except (TypeError, ValueError):
        return None
