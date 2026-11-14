#!/usr/bin/env python3
"""
TrailHub :: pull.py
-------------------
Pulls recent photos from your SPYPOINT account, downloads the images, and writes
a `data.js` file that index.html reads. No AI, no server -- it just uses
SPYPOINT's own species tags (Buck Tracker).

USAGE
  1. pip install -r requirements.txt
  2. Set your SPYPOINT login as environment variables (NEVER hardcode them):
        macOS/Linux:  export SPYPOINT_USERNAME="you@email.com"
                      export SPYPOINT_PASSWORD="your-password"
        Windows (PowerShell):
                      $env:SPYPOINT_USERNAME="you@email.com"
                      $env:SPYPOINT_PASSWORD="your-password"
     (Or put them in a file named `.env` next to this script -- see README.)
  3. python pull.py                # fetch new photos, merge into store, write data.js
     python pull.py --limit 200    # pull more photos per camera (default 100)
     python pull.py --rebuild      # rebuild data.js from local store (no network)
     python pull.py --inspect      # print the raw shape of one photo and exit
     python pull.py --demo         # write sample data.js, no login/network needed

Photos and their metadata are kept in store.json (the durable source of truth).
Each run only downloads photos it hasn't seen, then rewrites data.js from the
whole store -- so your history never shrinks and partial failures self-heal.

After it runs, open index.html (or upload index.html + data.js + photos/ to Cloudflare).
"""

import os
import sys
import json
import argparse
import datetime as dt
from pathlib import Path

HERE = Path(__file__).resolve().parent
PHOTOS_DIR = HERE / "photos"
DATA_FILE = HERE / "data.js"
STORE_FILE = HERE / "store.json"   # durable source of truth (NOT uploaded)
CAMERA_FILE = HERE / "cameras.json"  # durable camera metadata for map rendering
TAGS_FILE = HERE / "tags.json"     # user-applied tags/classifications (shared, baked into data.js)
META_FILE = HERE / "metadata.json"  # per-photo metadata (notes, favorites, corrections; shared, baked into data.js)
AI_TAGS_FILE = HERE / "ai-tags.json"  # labels from ai_tag.py, used only where nothing better exists
WEATHER_FILE = HERE / "weather.json"  # hourly history from Open-Meteo, keyed by UTC hour
UPLOADS_FILE = HERE / "uploads.json"  # photos added through the site, written by the Worker

MAX_PUBLISHED = 1500   # cap captures written to data.js so the site stays light
MAX_KEEP = 3000        # cap stored photos+images so the repo doesn't grow forever
MAX_IMG_PX = 1600      # downscale long edge if Pillow is available
THUMB_PX = 400         # long edge of the small copy that photo grids load
THUMBS_PER_RUN = 150   # older photos get a small copy a batch at a time
DOWNLOAD_RETRIES = 3
HEARTBEAT_SECONDS = 3600  # rewrite data.js at least this often, even with no new photos

# Used only for sun position, to estimate day/night on photos with no SPYPOINT
# day/night tag. Both cameras sit within about a kilometre of this point.
SITE_LATLNG = (35.54, -81.39)
OCR_VERSION = 2          # bump to re-read every photo's info bar
OVERLAY_PER_RUN = 150    # keeps a backlog from slowing any one run
R2_MOVES_PER_RUN = 300   # keeps a backlog from slowing any one run
R2_STOP_BYTES = 7 * 10**9  # stop at 70% of R2's 10 GB free tier, well before any charge
MAX_UPLOAD_DELAY = dt.timedelta(days=14)


def _site_timezone():
    """The camera clocks' timezone. Falls back to EST if tz data isn't installed."""
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/New_York")
    except Exception:
        return dt.timezone(dt.timedelta(hours=-5))


SITE_TZ = _site_timezone()


def atomic_write_text(path: Path, text: str):
    """Write to a temp file in the same dir, then rename -- a crash never corrupts the target."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)

# ---- SPYPOINT tag -> TrailHub species bucket -------------------------------
# SPYPOINT labels recognitions with verbose ids like "WHITE_TAILEDDEER" or
# "WILD_TURKEY", so we match on keywords rather than exact strings. Order matters:
# more specific buckets come first. A real-but-unmapped tag passes through (shown
# Title-cased with a neutral color); only a missing/generic tag becomes "Animal".
_SPECIES_KEYWORDS = (
    ("fawn", "Deer"),
    ("whitetail", "Deer"), ("whitetailed", "Deer"), ("taileddeer", "Deer"),
    ("muledeer", "Deer"), ("white tail", "Deer"), ("mule deer", "Deer"),
    ("deer", "Deer"),
    ("turkey", "Turkey"), ("wildturkey", "Turkey"),
    ("raccoon", "Raccoon"), ("racoon", "Raccoon"),
    ("squirrel", "Squirrel"),
    ("coyote", "Coyote"),
    ("opossum", "Opossum"), ("possum", "Opossum"),
    ("fox", "Fox"), ("redfox", "Fox"), ("grayfox", "Fox"), ("greyfox", "Fox"),
    ("bear", "Bear"), ("blackbear", "Bear"),
    ("hog", "Hog"), ("boar", "Hog"), ("wildhog", "Hog"), ("wildboar", "Hog"),
    ("feralhog", "Hog"), ("wild pig", "Hog"), ("wild boar", "Hog"),
    ("rabbit", "Rabbit"), ("hare", "Rabbit"),
    ("bobcat", "Bobcat"),
    ("elk", "Elk"), ("moose", "Moose"),
    ("bird", "Bird"),
    ("human", "Person"), ("person", "Person"), ("people", "Person"), ("pedestrian", "Person"),
    ("vehicle", "Vehicle"), ("truck", "Vehicle"),
)

# Tag values that don't name a species -- treated as "no tag" so they never
# become the displayed species. Covers generic buckets plus the day/night and
# capture-type markers SPYPOINT attaches to photos (these were showing up as a
# bogus "Day" species before they were filtered out here).
_GENERIC_TAGS = {
    "", "animal", "other", "other animal", "unidentified", "unknown",
    "false trigger", "false", "none", "n/a", "na", "misc", "miscellaneous",
    # time-of-day / lighting markers -- not a species
    "day", "night", "daytime", "nighttime", "daylight", "dawn", "dusk",
    "twilight", "morning", "afternoon", "evening", "midday", "noon",
    "midnight", "sunrise", "sunset", "am", "pm",
    # capture / trigger types -- not a species
    "motion", "timelapse", "time lapse", "test", "video", "photo", "image",
    "multishot", "multi shot", "burst", "trigger", "battery",
}


def normalize_species(tags):
    """Pick the most useful species label from a photo's tag list.

    SPYPOINT's recognition ids are verbose and uppercase (e.g. "WHITE_TAILEDDEER"),
    so match on keywords. A real-but-unmapped tag is shown as-is; only a missing or
    generic tag falls back to the neutral "Animal".
    """
    if not tags:
        return "Animal"
    if not isinstance(tags, (list, tuple)):
        tags = [tags]
    cleaned = []
    for t in tags:
        if not t:
            continue
        s = " ".join(str(t).strip().lower().replace("_", " ").replace("-", " ").split())
        if s and s not in _GENERIC_TAGS:
            cleaned.append(s)
    if not cleaned:
        return "Animal"
    # Whole-word set across all tags, so "groundhog" doesn't match the "hog" bucket.
    words = set()
    for s in cleaned:
        words.update(s.split())
    # Prefer a buck/doe call over a generic "deer" if present anywhere.
    if "buck" in words:
        return "Buck"
    if "doe" in words:
        return "Doe"
    for s in cleaned:
        sw = set(s.split())
        for kw, label in _SPECIES_KEYWORDS:
            if (kw in s) if " " in kw else (kw in sw):
                return label
    # A real label we don't have a bucket for: show it as-is.
    return cleaned[0].title()


def load_credentials():
    """Read creds from env vars, falling back to a local .env file. Never hardcoded."""
    user = os.environ.get("SPYPOINT_USERNAME")
    pw = os.environ.get("SPYPOINT_PASSWORD")
    env_path = HERE / ".env"
    if (not user or not pw) and env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            if k.strip() == "SPYPOINT_USERNAME" and not user:
                user = v
            elif k.strip() == "SPYPOINT_PASSWORD" and not pw:
                pw = v
    if not user or not pw:
        sys.exit(
            "ERROR: SPYPOINT credentials not found.\n"
            "Set SPYPOINT_USERNAME and SPYPOINT_PASSWORD as environment variables\n"
            "or in a .env file next to pull.py. See the README.\n"
            "(Tip: run `python pull.py --demo` to preview with sample data first.)"
        )
    return user, pw


# ---- Cloudflare R2 image hosting (optional) --------------------------------
# When the R2_* env vars are set, new photos are uploaded to a Cloudflare R2
# bucket and the site links to them there instead of committing images into the
# repo. Leave the vars unset to keep the original behavior (images under photos/).
#
# Required: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
#           and one of R2_ACCOUNT_ID or R2_ENDPOINT.
# R2_PUBLIC_BASE_URL is the bucket's public URL (e.g. https://pub-xxxx.r2.dev).
def _r2_config():
    return {
        "account_id": os.environ.get("R2_ACCOUNT_ID", "").strip(),
        "access_key_id": os.environ.get("R2_ACCESS_KEY_ID", "").strip(),
        "secret_access_key": os.environ.get("R2_SECRET_ACCESS_KEY", "").strip(),
        "bucket": os.environ.get("R2_BUCKET", "").strip(),
        "public_base_url": os.environ.get("R2_PUBLIC_BASE_URL", "").strip().rstrip("/"),
        "endpoint": os.environ.get("R2_ENDPOINT", "").strip().rstrip("/"),
    }


class R2Uploader:
    """Thin wrapper over the S3-compatible R2 API. One client, reused per run."""

    def __init__(self, cfg):
        import boto3  # lazy import: only needed when R2 is configured
        from botocore.config import Config as BotoConfig
        endpoint = cfg["endpoint"] or f"https://{cfg['account_id']}.r2.cloudflarestorage.com"
        self.bucket = cfg["bucket"]
        self.public_base_url = cfg["public_base_url"]
        self.used = None  # bytes in the bucket, counted on first need
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=cfg["access_key_id"],
            aws_secret_access_key=cfg["secret_access_key"],
            region_name="auto",
            config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
        )

    def has_room(self, local_path: Path) -> bool:
        """True if this file fits under the stop limit.

        If usage can't be counted, this reports no room: staying under the free
        tier matters more than any one upload.
        """
        if self.used is None:
            try:
                pages = self._client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket)
                self.used = sum(o["Size"] for page in pages for o in page.get("Contents", []))
                print(f"R2 usage: {self.used / 10**9:.3f} GB of {R2_STOP_BYTES / 10**9:.0f} GB allowed.")
            except Exception as e:
                print(f"::warning title=R2 uploads paused::Couldn't check usage: {e}")
                self.used = R2_STOP_BYTES
        room = self.used + local_path.stat().st_size <= R2_STOP_BYTES
        if not room:
            print("::warning title=R2 uploads paused::Storage reached the 70% stop limit.")
        return room

    def upload(self, local_path: Path, key: str) -> str:
        """Upload one file and return its public URL. Cached forever (stable ids)."""
        low = key.lower()
        ctype = "image/jpeg"
        if low.endswith(".png"):
            ctype = "image/png"
        elif low.endswith(".webp"):
            ctype = "image/webp"
        elif low.endswith(".gif"):
            ctype = "image/gif"
        self._client.upload_file(
            str(local_path), self.bucket, key,
            ExtraArgs={"ContentType": ctype, "CacheControl": "public, max-age=31536000, immutable"},
        )
        if self.used is not None:
            self.used += local_path.stat().st_size
        return f"{self.public_base_url}/{key}"


def move_photos_to_r2(store, r2, limit=R2_MOVES_PER_RUN):
    """Copy repo-hosted photos to R2 and point their records at the new URLs.

    The first copy is fetched back through the public URL before anything changes:
    a wrong bucket setting must not repoint the site at images that don't load.
    """
    import urllib.request
    moved = 0
    pending = [c for c in store.values() if str(c.get("image", "")).startswith("photos/")]
    for c in sorted(pending, key=lambda c: c.get("date", ""), reverse=True)[:limit]:
        path = HERE / c["image"]
        if not path.exists():
            continue
        if not r2.has_room(path):
            break
        try:
            url = r2.upload(path, path.name)
            if not moved:
                request = urllib.request.Request(url, headers={"User-Agent": "TrailHub/1.0"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    if response.status != 200 or not response.read(3).startswith(b"\xff\xd8"):
                        raise RuntimeError("the public URL didn't return the image")
        except Exception as e:
            print(f"::warning title=R2 move stopped::{e}")
            break
        c["image"] = url
        moved += 1
    if moved:
        print(f"Moved {moved} photo(s) to R2; {len(pending) - moved} left.")


def delete_hosted_copies(store):
    """Remove local files for photos now on R2, once their info bar has been read."""
    removed = 0
    for c in store.values():
        if str(c.get("image", "")).startswith("http") and c.get("overlayRead") == OCR_VERSION:
            for path in PHOTOS_DIR.glob(f"{c.get('id')}.*"):
                path.unlink(missing_ok=True)
                removed += 1
        if str(c.get("thumb", "")).startswith("http"):
            for path in PHOTOS_DIR.glob(f"{c.get('id')}_t.*"):
                path.unlink(missing_ok=True)
                removed += 1
    if removed:
        print(f"Removed {removed} local copies now hosted on R2.")


# ---- small copies for photo grids ------------------------------------------
# The site shows up to 120 tiles at a time. Loading the full 1600px photo into a
# 150px tile costs phones tens of megabytes, so each photo also gets a ~400px copy
# (<id>_t.jpg) next to it, on R2 or under photos/. The site falls back to the full
# photo for any capture without one.
def thumb_key(sid):
    return f"{sid}_t.jpg"


def make_thumb(src: Path, dst: Path) -> bool:
    """Write the small JPEG copy of src to dst. False if Pillow is missing or it fails."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return False
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((THUMB_PX, THUMB_PX))
            if im.mode != "RGB":
                im = im.convert("RGB")
            im.save(dst, "JPEG", quality=78, optimize=True)
        return True
    except Exception:
        dst.unlink(missing_ok=True)
        return False


def attach_thumb(meta, image_path: Path, r2) -> bool:
    """Make the small copy of one photo and record where it lives (R2 or photos/)."""
    local = PHOTOS_DIR / thumb_key(meta["id"])
    if not make_thumb(image_path, local):
        return False
    if r2 is not None and r2.has_room(local):
        try:
            meta["thumb"] = r2.upload(local, local.name)
            local.unlink(missing_ok=True)
            return True
        except Exception as e:
            print(f"  [thumb] upload failed for {meta['id']}: {e}")
    meta["thumb"] = f"photos/{local.name}"
    return True


def backfill_thumbs(store, r2, limit=THUMBS_PER_RUN):
    """Give photos from before this feature a small copy too, newest first.

    Photos already on R2 are fetched back through their public URL, shrunk, and
    the copy uploaded beside them. Never fails a pull.
    """
    try:
        import PIL  # noqa: F401
    except ImportError:
        return 0
    pending = [c for c in store.values() if c.get("image") and not c.get("thumb")]
    pending.sort(key=lambda c: c.get("date", ""), reverse=True)
    done = 0
    for c in pending[:limit]:
        image = str(c["image"])
        if image.startswith("http"):
            if r2 is None:
                continue  # nowhere to put the copy
            src = PHOTOS_DIR / f"{c['id']}_src.tmp"
            try:
                download_with_retry(image, src)
                if not r2.has_room(src):
                    break
                ok = attach_thumb(c, src, r2)
            except Exception as e:
                print(f"  [thumb] skipped {c['id']}: {e}")
                ok = False
            finally:
                src.unlink(missing_ok=True)
        else:
            src = HERE / image
            ok = src.exists() and attach_thumb(c, src, r2)
        if ok:
            done += 1
    if done or pending:
        print(f"Small copies: made {done}, {len(pending) - done} photo(s) still without one.")
    return done


def make_r2_uploader():
    """Return an R2Uploader if the env is fully configured, else None (with a note)."""
    cfg = _r2_config()
    missing = [k for k in ("access_key_id", "secret_access_key", "bucket", "public_base_url") if not cfg[k]]
    if missing:
        if any(cfg[k] for k in cfg):  # partially configured -- warn so typos are obvious
            print(f"  [r2] ignoring R2 config; missing {', '.join(sorted(missing))}. Using local photos/.")
        return None
    if not cfg["endpoint"] and not cfg["account_id"]:
        print("  [r2] set R2_ACCOUNT_ID or R2_ENDPOINT to enable R2. Using local photos/.")
        return None
    try:
        return R2Uploader(cfg)
    except ImportError:
        print("  [r2] boto3 not installed (pip install boto3). Using local photos/.")
        return None
    except Exception as e:
        print(f"  [r2] disabled ({e}). Using local photos/.")
        return None


# ---- field extraction ------------------------------------------------------
# pyspypoint's documented surface is small (Client / cameras() / photos() / url()).
# Each photo object wraps SPYPOINT's raw JSON; field names below are best-guesses
# with fallbacks. Run `python pull.py --inspect` once to see the real shape, and
# adjust these helpers if needed -- everything else stays the same.

def _to_plain(obj, depth=0):
    """Recursively turn pyspypoint's _AttrDict objects (and the tuples it uses for
    lists) back into plain dicts/lists, so the extractor can walk the real JSON
    shape -- including nested fields like GPS and recognition tags."""
    if depth > 8:
        return None
    if isinstance(obj, dict):
        return {k: _to_plain(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_plain(v, depth + 1) for v in obj]
    inner = getattr(obj, "__dict__", None)
    if isinstance(inner, dict) and inner and not isinstance(obj, type):
        return {k: _to_plain(v, depth + 1) for k, v in inner.items() if not str(k).startswith("_")}
    return obj  # primitives: str/int/float/bool/None


def _raw(photo):
    """Return the photo/camera's underlying JSON as a plain nested dict.

    pyspypoint wraps each record in an _AttrDict (keys become attributes, lists
    become tuples), so we flatten it back to plain structures here.
    """
    if isinstance(photo, dict):
        return _to_plain(photo)
    for attr in ("_json", "json", "data", "raw", "_data"):
        v = getattr(photo, attr, None)
        if isinstance(v, dict) and v:
            return _to_plain(v)
    inner = getattr(photo, "__dict__", None)
    if isinstance(inner, dict) and inner:
        return _to_plain(inner)
    return {}


def _first(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, ""):
            return d[k]
    return default


# Keys under which SPYPOINT (or a similar API) may carry species/recognition tags.
# SPYPOINT's own field is "tag" (singular); the others are defensive fallbacks.
_SPECIES_TAG_KEYS = {
    "tag", "tags", "speciestags", "species_tags", "labels", "label",
    "species", "recognition", "recognitions", "aitags", "ai_tags", "detections",
}

# Nested keys worth descending into when no top-level tag is found. Kept narrow on
# purpose so we don't scoop up unrelated nested values (e.g. image descriptors or
# a day/night marker) and mistake them for a species.
_NESTED_CONTAINER_KEYS = {
    "recognition", "recognitions", "detections", "detection", "predictions",
    "objects", "analysis", "ai", "meta", "metadata", "results", "result",
}


def _tag_to_str(t):
    """Coerce one tag entry (a string, or a dict like {'nameId': 'BUCK'}) to text."""
    if isinstance(t, str):
        return t.strip() or None
    if isinstance(t, dict):
        for k in ("nameId", "name", "label", "tag", "species", "value", "en", "title"):
            v = t.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return None


def _collect_species_tags(raw, depth=0):
    """Gather species/recognition tag strings from a (plain) photo dict.

    Reads explicit tag-bearing keys (e.g. SPYPOINT's "tag"); if none are present,
    descends only into nested containers likely to hold recognitions (not arbitrary
    fields like image descriptors), so unrelated values such as a day/night marker
    aren't mistaken for a species. normalize_species() then filters non-species
    values, so a real species listed alongside a "DAY" marker still wins.
    """
    out = []
    if depth > 5 or raw is None:
        return out
    if isinstance(raw, dict):
        for key, val in raw.items():
            if str(key).lower() in _SPECIES_TAG_KEYS:
                for item in (val if isinstance(val, (list, tuple)) else [val]):
                    s = _tag_to_str(item)
                    if s:
                        out.append(s)
        if not out:
            for key, val in raw.items():
                if str(key).lower() in _NESTED_CONTAINER_KEYS and isinstance(val, (dict, list, tuple)):
                    out.extend(_collect_species_tags(val, depth + 1))
    elif isinstance(raw, (list, tuple)):
        for val in raw:
            if isinstance(val, (dict, list, tuple)):
                out.extend(_collect_species_tags(val, depth + 1))
    return out


def extract_meta(photo, cam_name_by_id):
    raw = _raw(photo)
    # timestamp
    ts = _first(raw, "date", "originDate", "createdAt", "timestamp")
    uploaded = parse_date(ts)
    # "date" is when SPYPOINT received the photo. originDate is when it was taken.
    when, time_source = uploaded, "upload"
    captured = camera_time_to_utc(raw.get("originDate"))
    if captured is not None and plausible_capture(captured, uploaded):
        when, time_source = captured, "camera"
    # species tags: SPYPOINT stores recognitions under "tag" (singular); other
    # schemas use tags/labels/etc. Search known keys (incl. nested) and accept
    # either plain strings or {nameId/name/label} objects.
    tags = _collect_species_tags(raw)
    species = normalize_species(tags)
    # camera
    cam_id = _first(raw, "camera", "cameraId", "camera_id")
    camera = cam_name_by_id.get(str(cam_id), None) or _first(raw, "cameraName", default="Camera")
    # day/night: prefer an explicit flag, then SPYPOINT's own "day"/"night" tag,
    # else estimate from the sun. Never the clock hour: dates here are UTC, so an
    # hour check labels mid-afternoon in North Carolina as night.
    is_night = _first(raw, "isNight", "night")
    lowered = {str(t).strip().lower() for t in tags}
    tod_source = "tag"
    if is_night is None:
        if "night" in lowered:
            is_night = True
        elif "day" in lowered:
            is_night = False
        else:
            is_night = sun_is_down(when)
            tod_source = "sun"
    # optional extras
    temp = _first(raw, "temperature", "temp")
    conf = _first(raw, "confidence", "score")
    if conf is not None:
        try:
            conf = float(conf)
            if conf > 1:  # some APIs use 0-100
                conf = conf / 100.0
        except (TypeError, ValueError):
            conf = None
    return {
        "species": species,
        "camera": str(camera),
        "date": when.isoformat(),
        "uploaded": uploaded.isoformat(),
        "timeSource": time_source,
        "isNight": bool(is_night),
        "todSource": tod_source,
        "temp": (round(float(temp)) if _is_num(temp) else None),
        "confidence": conf,
        "moon": _first(raw, "moonPhase", "moon"),
    }


def camera_time_to_utc(value):
    """Convert a SPYPOINT originDate to real UTC.

    It's the camera's wall clock with a misleading "Z" on the end: 06:57 local comes
    through as 06:57Z, about five hours behind the matching upload time.
    """
    if not value:
        return None
    try:
        naive = dt.datetime.fromisoformat(str(value).replace("Z", "")[:19])
    except ValueError:
        return None
    return naive.replace(tzinfo=SITE_TZ).astimezone(dt.timezone.utc)


def plausible_capture(captured, uploaded):
    """A capture comes before its upload, within reason. Guards against a bad clock."""
    if uploaded.tzinfo is None:
        uploaded = uploaded.replace(tzinfo=dt.timezone.utc)
    return dt.timedelta(hours=-1) <= uploaded - captured <= MAX_UPLOAD_DELAY


def sun_is_down(when, lat=SITE_LATLNG[0], lng=SITE_LATLNG[1], threshold=0.0):
    """True when the sun is below `threshold` degrees at this moment and place.

    Low-precision solar position (well under a degree, plenty for day vs night).
    Against 465 photos with a real SPYPOINT tag, 0 degrees scored best (89% right);
    the misses are mostly photos uploaded well after they were taken.
    """
    import math
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.timezone.utc)
    t = when.astimezone(dt.timezone.utc)
    day = (t - dt.datetime(2000, 1, 1, 12, tzinfo=dt.timezone.utc)).total_seconds() / 86400
    mean_long = (280.460 + 0.9856474 * day) % 360
    anomaly = math.radians((357.528 + 0.9856003 * day) % 360)
    ecl_long = math.radians(mean_long + 1.915 * math.sin(anomaly) + 0.020 * math.sin(2 * anomaly))
    obliquity = math.radians(23.439 - 0.0000004 * day)
    decl = math.asin(math.sin(obliquity) * math.sin(ecl_long))
    right_asc = math.degrees(math.atan2(math.cos(obliquity) * math.sin(ecl_long), math.cos(ecl_long)))
    sidereal = (280.46061837 + 360.98564736629 * day + lng) % 360
    hour_angle = math.radians(sidereal - right_asc)
    phi = math.radians(lat)
    elevation = math.degrees(math.asin(
        math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(hour_angle)))
    return elevation < threshold


def repair_day_night(store):
    """Re-estimate day/night on captures saved by the old UTC-hour check.

    Those records have no todSource. Photos still in SPYPOINT's recent window get
    their exact tag on the next pull; this corrects the older ones. Idempotent.
    """
    fixed = 0
    for c in store.values():
        if c.get("todSource"):
            continue
        try:
            c["isNight"] = sun_is_down(dt.datetime.fromisoformat(c["date"]))
        except (KeyError, TypeError, ValueError):
            continue
        c["todSource"] = "sun"
        fixed += 1
    if fixed:
        print(f"Re-estimated day/night on {fixed} older capture(s).")


def _is_num(x):
    try:
        float(x)
        return True
    except (TypeError, ValueError):
        return False


def parse_date(value):
    if value is None:
        return dt.datetime.now()
    if isinstance(value, (int, float)):
        # epoch seconds or milliseconds
        v = value / 1000.0 if value > 1e11 else value
        return dt.datetime.fromtimestamp(v)
    s = str(value).replace("Z", "+00:00")
    for fmt in (None,):  # try ISO first
        try:
            return dt.datetime.fromisoformat(s)
        except ValueError:
            pass
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(str(value)[:26], fmt)
        except ValueError:
            continue
    return dt.datetime.now()


def _maybe_downscale(path: Path):
    """If Pillow is installed, shrink oversized JPEGs so the site loads fast. Optional."""
    try:
        from PIL import Image
    except ImportError:
        return  # no Pillow -> keep original, perfectly fine
    try:
        with Image.open(path) as im:
            if max(im.size) <= MAX_IMG_PX:
                return
            im.thumbnail((MAX_IMG_PX, MAX_IMG_PX))
            if im.mode != "RGB":
                im = im.convert("RGB")
            im.save(path, "JPEG", quality=82, optimize=True)
    except Exception:
        pass  # never let image processing break a pull


def parse_overlay(text):
    """Pull (temp F, (hour, minute)) from the info bar's text; either can be None.

    Only the time and the F reading are used. OCR often drops the colon, so that's
    optional, but it garbles the date and C reading too often to trust them.
    """
    import re
    flat = text.replace("\n", " ")
    temp_match = re.search(r"(-?\d{1,3})\s*\u00b0?\s*F", flat)
    temp = _temp_in_range(temp_match.group(1)) if temp_match else None
    clock = None
    time_match = re.search(r"(?:^|\s)(\d{2})[:;.]?(\d{2})\s*([AP])M", flat)
    if time_match:
        hour, minute = int(time_match.group(1)), int(time_match.group(2))
        if 1 <= hour <= 12 and minute < 60:
            clock = (hour % 12 + (12 if time_match.group(3) == "P" else 0), minute)
    return temp, clock


def read_overlay(path: Path):
    """Read the black info bar SPYPOINT prints along the bottom of each photo.

    Returns (temp, clock) as parse_overlay does, or None if OCR isn't available. The
    bar is the bottom 5% of the frame, and the moon icon and logo are cropped off.
    """
    try:
        from PIL import Image, ImageEnhance, ImageOps
        import pytesseract
        with Image.open(path) as im:
            w, h = im.size
            strip = im.convert("L").crop((0, round(h * 0.953), int(w * 0.72), h))
        strip = ImageOps.invert(strip).resize((strip.width * 4, strip.height * 4), Image.BICUBIC)
        strip = ImageEnhance.Contrast(strip).enhance(1.4)
        config = "--psm 7 -c tessedit_char_whitelist=0123456789/:APMFC-\u00b0"
        return parse_overlay(pytesseract.image_to_string(strip, config=config))
    except Exception:
        return None


def overlay_capture(clock, uploaded):
    """The latest moment at this clock time that isn't after the upload."""
    local = uploaded.astimezone(SITE_TZ)
    for days_back in range(MAX_UPLOAD_DELAY.days + 1):
        day = local - dt.timedelta(days=days_back)
        candidate = day.replace(hour=clock[0], minute=clock[1], second=0, microsecond=0)
        if plausible_capture(candidate.astimezone(dt.timezone.utc), uploaded):
            return candidate.astimezone(dt.timezone.utc)
    return None


def backfill_overlays(store, limit=OVERLAY_PER_RUN):
    """Fill in temperatures, and capture times SPYPOINT no longer reports, from photos.

    Works through a limited batch per run, newest first. Returns how many it read.
    """
    pending = []
    for c in store.values():
        if c.get("overlayRead") != OCR_VERSION:
            path = next(PHOTOS_DIR.glob(f"{c.get('id')}.*"), None)
            if path:
                pending.append((c, path))
    pending.sort(key=lambda item: item[0].get("date", ""), reverse=True)
    done = 0
    for c, path in pending[:limit]:
        result = read_overlay(path)
        if result is None:
            continue
        temp, clock = result
        if temp is not None and not _is_num(c.get("temp")):
            c["temp"] = temp
        if clock is not None and c.get("timeSource") != "camera":
            uploaded = dt.datetime.fromisoformat(c.get("uploaded") or c["date"])
            captured = overlay_capture(clock, uploaded)
            if captured is not None:
                c["uploaded"] = uploaded.isoformat()
                c["date"] = captured.isoformat()
                c["timeSource"] = "overlay"
                if c.get("todSource") == "sun":
                    c["isNight"] = sun_is_down(captured)
        c["overlayRead"] = OCR_VERSION
        done += 1
    if done:
        print(f"Read the info bar on {done} photo(s); {len(pending) - done} left.")
    return done


def _bound_temp(val):
    """Reject OCR garbage: real outdoor readings live within a sane window."""
    return val if (val is not None and -60 <= val <= 140) else None


def _temp_in_range(raw):
    try:
        return _bound_temp(int(raw))
    except (TypeError, ValueError):
        return None



def download_with_retry(url, dest: Path, retries=DOWNLOAD_RETRIES):
    """Download to a .part file then rename; retry with backoff. Returns True on success."""
    import time
    import urllib.request
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "TrailHub/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                f.write(r.read())
            tmp.replace(dest)
            _maybe_downscale(dest)
            return True
        except Exception as e:
            if attempt == retries:
                if tmp.exists():
                    tmp.unlink(missing_ok=True)
                raise
            time.sleep(1.5 * attempt)
    return False


def stable_id(raw, url):
    """A stable identifier for a photo so re-runs don't re-download or duplicate it.

    Prefer SPYPOINT's own id; fall back to a hash of camera + date + url.
    """
    import hashlib
    pid = _first(raw, "id", "photoId", "_id", "photo_id")
    if pid:
        return "sp_" + str(pid).replace("/", "_")
    basis = f"{_first(raw, 'camera', 'cameraId', default='')}|{_first(raw, 'date', default='')}|{url}"
    return "h_" + hashlib.sha1(basis.encode()).hexdigest()[:16]


def load_store():
    """Load the durable capture store keyed by stable id. Tolerates a missing/corrupt file."""
    if not STORE_FILE.exists():
        return {}
    try:
        data = json.loads(STORE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        print("  [warn] store.json unreadable; starting a fresh store.")
        return {}


def save_store(store):
    atomic_write_text(STORE_FILE, json.dumps(store, indent=1))


def blur_location(value):
    """Round a coordinate to about 1 km. This repo and site are public."""
    return None if value is None else round(float(value), 2)


def load_cameras():
    if not CAMERA_FILE.exists():
        return []
    try:
        data = json.loads(CAMERA_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return []
        for cam in data:
            cam["latitude"] = blur_location(cam.get("latitude"))
            cam["longitude"] = blur_location(cam.get("longitude"))
        return data
    except (json.JSONDecodeError, OSError):
        print("  [warn] cameras.json unreadable; skipping saved camera metadata.")
        return []


def save_cameras(cameras):
    atomic_write_text(CAMERA_FILE, json.dumps(cameras, indent=1))


def load_tags():
    """Load user-applied tags keyed by photo id: {id: ["Deer", "Turkey"]}.

    These are edited from the site and saved to tags.json (the durable, shared
    source of truth for classifications). We bake them into data.js so every
    visitor sees them. Accepts either a list or a {"tags": [...]} object per id.
    """
    if not TAGS_FILE.exists():
        return {}
    try:
        data = json.loads(TAGS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        print("  [warn] tags.json unreadable; skipping user tags.")
        return {}
    out = {}
    if isinstance(data, dict):
        for key, val in data.items():
            arr = val if isinstance(val, list) else (val.get("tags") if isinstance(val, dict) else None)
            if not isinstance(arr, list):
                continue
            clean, seen = [], set()
            for t in arr:
                s = str(t).strip()
                if s and s not in seen:
                    seen.add(s)
                    clean.append(s)
            if clean:
                out[str(key)] = clean
    return out


# Fields owned by other pipelines (tags, camera names) or by the capture's own
# structure -- metadata must never override these when baked into data.js.
_META_RESERVED = {"id", "image", "thumb", "date", "camera", "tags", "species"}


def load_metadata():
    """Load per-photo metadata keyed by photo id: {id: {"note": "...", "favorite": true}}.

    Edited from the site and saved to metadata.json (POST /meta on the Worker). We
    overlay these onto captures in data.js so notes, favorites and manual temp/moon
    corrections show for every visitor. Values are bounded to keep data.js small.
    """
    if not META_FILE.exists():
        return {}
    try:
        data = json.loads(META_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        print("  [warn] metadata.json unreadable; skipping per-photo metadata.")
        return {}
    out = {}
    if isinstance(data, dict):
        for key, val in data.items():
            if not isinstance(val, dict):
                continue
            entry = {}
            for k, v in val.items():
                name = str(k).strip()[:40]
                if not name or name in _META_RESERVED:
                    continue
                if isinstance(v, str):
                    s = v[:500]
                    if s:
                        entry[name] = s
                elif isinstance(v, bool):
                    entry[name] = v
                elif isinstance(v, (int, float)):
                    entry[name] = v
                elif isinstance(v, list):
                    entry[name] = [x for x in v[:32] if not isinstance(x, (dict, list))]
            if entry:
                out[str(key)] = entry
    return out


def load_ai_tags():
    """Load AI labels keyed by photo id: {id: {"label": "Doe", "confidence": 0.9}}.

    "Other animal" isn't overlaid: it's recorded only so ai_tag.py won't ask again,
    and the photo stays a plain "Animal" for you to review.
    """
    try:
        data = json.loads(AI_TAGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items()
            if isinstance(v, dict) and v.get("label") and v["label"] != "Other animal"}


# ---- weather (Open-Meteo: free, no key) ------------------------------------
# Each hour is stored as [temp F, rain mm, sea-level pressure hPa, wind mph, wind deg].
_WEATHER_VARS = "temperature_2m,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m"
_WEATHER_QUERY = (f"latitude={SITE_LATLNG[0]}&longitude={SITE_LATLNG[1]}&hourly={_WEATHER_VARS}"
                  "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT")
_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
RECENT_WEATHER_DAYS = 7  # newer than this comes from the forecast API, not the archive


def load_weather():
    try:
        data = json.loads(WEATHER_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def weather_key(date_text):
    """The UTC hour a capture falls in, matching Open-Meteo's GMT timestamps."""
    when = dt.datetime.fromisoformat(date_text)
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.timezone.utc)
    return when.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:00")


def _fetch_hours(url):
    import urllib.request
    request = urllib.request.Request(url, headers={"User-Agent": "TrailHub/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        hourly = json.loads(response.read().decode("utf-8"))["hourly"]
    columns = [hourly[v] for v in _WEATHER_VARS.split(",")]
    hours = {}
    for i, key in enumerate(hourly["time"]):
        row = [col[i] for col in columns]
        if all(v is not None for v in row):
            hours[key] = row
    return hours


def update_weather(captures):
    """Fetch history for any capture hour not cached yet. Never stops a pull."""
    cache = load_weather()
    missing = {weather_key(c["date"]) for c in captures if c.get("date")} - set(cache)
    if not missing:
        return
    today = dt.datetime.now(dt.timezone.utc).date()
    cutoff = (today - dt.timedelta(days=RECENT_WEATHER_DAYS)).isoformat()
    try:
        older = sorted(k for k in missing if k[:10] < cutoff)
        if older:
            cache.update(_fetch_hours(
                "https://archive-api.open-meteo.com/v1/archive?" + _WEATHER_QUERY
                + f"&start_date={older[0][:10]}&end_date={cutoff}"))
        if len(older) < len(missing):
            cache.update(_fetch_hours(
                "https://api.open-meteo.com/v1/forecast?" + _WEATHER_QUERY
                + f"&past_days={RECENT_WEATHER_DAYS + 1}&forecast_days=1"))
    except Exception as e:
        print(f"  [weather] skipped: {e}")
        return
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:00")
    cache = {k: v for k, v in sorted(cache.items()) if k <= now}
    atomic_write_text(WEATHER_FILE, json.dumps(cache, separators=(",", ":")))


def _wind_band(mph):
    if mph < 5:
        return "Under 5 mph"
    if mph < 10:
        return "5\u201310 mph"
    if mph < 15:
        return "10\u201315 mph"
    return "15+ mph"


def _pressure_trend(key, pressure, cache):
    """Compare with three hours earlier, the span hunters usually mean by a trend."""
    before = dt.datetime.fromisoformat(key) - dt.timedelta(hours=3)
    earlier = cache.get(before.strftime("%Y-%m-%dT%H:00"))
    if earlier is None:
        return None
    change = pressure - earlier[2]
    return "Rising" if change > 1 else "Falling" if change < -1 else "Steady"


def weather_for(key, cache):
    row = cache.get(key)
    if row is None:
        return None
    temp, rain, pressure, wind, direction = row
    return {
        "tempF": round(temp),
        "wind": round(wind),
        "windDir": _COMPASS[int((direction + 22.5) % 360 // 45)],
        "windBand": _wind_band(wind),
        "pressure": round(pressure * 0.02953, 2),
        "trend": _pressure_trend(key, pressure, cache),
        "sky": "Rain" if rain >= 0.1 else "Dry",
    }


def weather_hours(cache, first_key, last_key):
    """Hours of each condition, so the site can compare sightings to how often it
    happens. Without this, whatever weather is most common would always look best."""
    totals = {"windBand": {}, "trend": {}, "sky": {}}
    for key in cache:
        if first_key <= key <= last_key:
            w = weather_for(key, cache)
            for field, counts in totals.items():
                if w[field]:
                    counts[w[field]] = counts.get(w[field], 0) + 1
    return totals


def load_uploads():
    """Photos added through the site, as captures. Malformed entries are skipped."""
    try:
        data = json.loads(UPLOADS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out = []
    for item in (data.values() if isinstance(data, dict) else []):
        try:
            when = dt.datetime.fromisoformat(str(item["date"]).replace("Z", "+00:00"))
            image = str(item["image"])
        except (KeyError, TypeError, ValueError):
            continue
        if not image.startswith("https://"):
            continue
        thumb = str(item.get("thumb") or "")
        out.append({
            "id": str(item["id"]),
            "species": str(item.get("species") or "Animal"),
            "camera": str(item.get("camera") or "Other camera"),
            "date": when.isoformat(),
            "image": image,
            "thumb": thumb if thumb.startswith("https://") else None,
            "isNight": sun_is_down(when),
            "temp": None,
            "confidence": None,
            "moon": None,
            "uploadedBySite": True,
            "media": "video" if item.get("media") == "video" else "photo",
        })
    return out


def prune_store(store):
    """Keep only the newest MAX_KEEP captures; delete image files for the rest."""
    items = sorted(store.values(), key=lambda c: c.get("date", ""), reverse=True)
    if len(items) <= MAX_KEEP:
        return store
    for c in items[MAX_KEEP:]:
        for key in ("image", "thumb"):
            img = str(c.get(key) or "")
            if img.startswith("photos/"):
                try:
                    (HERE / img).unlink(missing_ok=True)
                except OSError:
                    pass
    return {c["id"]: c for c in items[:MAX_KEEP]}


BURST_SECONDS = 120
LOW_CONFIDENCE = 0.5  # below the site's 0.7 line, so the photo goes to Identify
_DEER_LABELS = {"Buck", "Doe", "Deer"}
_PEOPLE_LABELS = {"Person", "Vehicle"}  # someone on a mower can fairly be either


def flag_burst_conflicts(captures):
    """Lower confidence on AI tags that disagree with the rest of their burst.

    Frames seconds apart show the same animal, so a Coyote next to a Buck means one
    is wrong, however sure the model sounded. Captures must be sorted by date.
    """
    def kind(c):
        species = c.get("species")
        if species in _DEER_LABELS:
            return "Deer"
        return "People" if species in _PEOPLE_LABELS else species

    last_by_camera = {}
    burst_by_camera = {}
    for c in captures:
        when = dt.datetime.fromisoformat(c["date"])
        camera = c.get("camera")
        previous = last_by_camera.get(camera)
        if previous is None or abs((previous - when).total_seconds()) > BURST_SECONDS:
            _flag_burst(burst_by_camera.get(camera, []), kind)
            burst_by_camera[camera] = []
        burst_by_camera[camera].append(c)
        last_by_camera[camera] = when
    for burst in burst_by_camera.values():
        _flag_burst(burst, kind)


def _flag_burst(burst, kind):
    animals = {kind(c) for c in burst if kind(c) not in ("Empty", "Animal", None)}
    if len(animals) < 2:
        return
    for c in burst:
        if c.get("aiTagged"):
            c["confidence"] = min(c.get("confidence") or 1, LOW_CONFIDENCE)


def _recently_published(payload):
    """True when data.js already holds this content and was written recently.

    Skipping the rewrite stops a frequent schedule from committing (and rebuilding
    Pages) every run just to bump a timestamp. The heartbeat still refreshes
    generatedAt, which is what the site's "Checked ... ago" line reads.
    """
    try:
        text = DATA_FILE.read_text(encoding="utf-8")
        prev = json.loads(text[text.index("{"):text.rindex("}") + 1])
        stamp = dt.datetime.fromisoformat(prev["generatedAt"])
    except (OSError, ValueError, KeyError):
        return False
    if stamp.tzinfo is None:  # written before timestamps carried a timezone
        return False
    age = (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()
    same = all(prev.get(k) == payload.get(k) for k in ("demo", "cameras", "captures", "weatherHours"))
    return same and age < HEARTBEAT_SECONDS


def write_data_js(captures, cameras=None, demo=False, tags_map=None, meta_map=None):
    """Render the published data.js from a list of captures (atomic write).

    tags_map (optional) overlays user-applied tags by photo id; the first tag
    becomes the primary species. Captures without user tags default to a single
    tag matching their detected species.

    meta_map (optional) overlays per-photo metadata (notes, favorites, manual
    temp/moon corrections, ...) by photo id. Reserved structural fields are never
    overwritten so tags/camera/image pipelines stay authoritative.
    """
    tags_map = tags_map or {}
    meta_map = meta_map or {}
    ai_map = {} if demo else load_ai_tags()
    if not demo:
        captures = list(captures) + load_uploads()
    weather = {} if demo else load_weather()
    captures = sorted(captures, key=lambda c: c.get("date", ""), reverse=True)[:MAX_PUBLISHED]
    out_caps = []
    for c in captures:
        c = dict(c)
        user_tags = tags_map.get(str(c.get("id")))
        if user_tags:
            c["tags"] = user_tags
            c["species"] = user_tags[0]
        elif c.get("species") == "Animal" and str(c.get("id")) in ai_map:
            ai = ai_map[str(c.get("id"))]
            c["species"] = ai["label"]
            c["tags"] = [ai["label"]]
            c["confidence"] = ai.get("confidence")
            c["aiTagged"] = True
        elif not c.get("tags"):
            c["tags"] = [c.get("species", "Animal")]
        if weather:
            w = weather_for(weather_key(c["date"]), weather)
            if w:
                c["weather"] = w
                if c.get("temp") is None:
                    c["temp"] = w["tempF"]
                    c["tempEstimated"] = True
        meta = meta_map.get(str(c.get("id")))
        if meta:
            for k, v in meta.items():
                if k not in _META_RESERVED:
                    c[k] = v
        out_caps.append(c)
    flag_burst_conflicts(out_caps)
    payload = {
        # Always explicit UTC: a bare timestamp is read as local time by browsers,
        # which made the site claim "just now" for hours-old data.
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "demo": demo,
        "cameras": cameras or [],
        "captures": out_caps,
    }
    if weather and out_caps:
        payload["weatherHours"] = weather_hours(
            weather, weather_key(out_caps[-1]["date"]), weather_key(out_caps[0]["date"]))
    if _recently_published(payload):
        print(f"{DATA_FILE.name} already up to date ({len(out_caps)} captures).")
        return
    atomic_write_text(DATA_FILE, "window.TRAILHUB_DATA = " + json.dumps(payload, indent=2) + ";\n")
    print(f"Wrote {DATA_FILE.name}  ({len(out_caps)} captures)")


def _coerce_latlng(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n


def _deep_find_latlng(obj, depth=0):
    """Best-effort recursive scan for a (lat, lng) pair when the schema is unknown.

    Looks for a dict that holds both a latitude-like and longitude-like key, or a
    GeoJSON-style ``coordinates``/``coordinate`` ``[lng, lat]`` pair. Bounded depth
    keeps it cheap and avoids picking up unrelated nested data.
    """
    if depth > 4 or obj is None:
        return (None, None)
    if isinstance(obj, dict):
        lat = lng = None
        for key, val in obj.items():
            k = str(key).lower()
            if isinstance(val, (int, float, str)):
                if lat is None and ("latitude" in k or k in ("lat", "gpslat", "gps_lat")):
                    lat = _coerce_latlng(val)
                elif lng is None and ("longitude" in k or k in ("lng", "lon", "long", "gpslng", "gpslon", "gps_long")):
                    lng = _coerce_latlng(val)
        # GeoJSON-style [lng, lat] under a coordinates key
        coords = obj.get("coordinates") or obj.get("coordinate")
        if (lat is None or lng is None) and isinstance(coords, (list, tuple)) and len(coords) >= 2:
            clng, clat = _coerce_latlng(coords[0]), _coerce_latlng(coords[1])
            if clat is not None and lat is None:
                lat = clat
            if clng is not None and lng is None:
                lng = clng
        if lat is not None and lng is not None:
            return (lat, lng)
        for val in obj.values():
            if isinstance(val, (dict, list)):
                rlat, rlng = _deep_find_latlng(val, depth + 1)
                if rlat is not None and rlng is not None:
                    return (rlat, rlng)
        return (lat, lng)
    if isinstance(obj, list):
        for val in obj:
            if isinstance(val, (dict, list)):
                rlat, rlng = _deep_find_latlng(val, depth + 1)
                if rlat is not None and rlng is not None:
                    return (rlat, rlng)
    return (None, None)


def extract_camera_meta(cam):
    raw = _raw(cam)
    cid = _first(raw, "id", "cameraId", "_id")
    name = _first(raw, "name", "cameraName", "config_name", default=None)
    geo = raw.get("gps") if isinstance(raw, dict) else None
    if not isinstance(geo, dict):
        geo = raw.get("location") if isinstance(raw, dict) and isinstance(raw.get("location"), dict) else {}
    lat = _coerce_latlng(_first(raw, "latitude", "lat", "gpsLat", "gps_lat", default=None))
    lng = _coerce_latlng(_first(raw, "longitude", "lng", "lon", "gpsLng", "gpsLon", "gps_long", default=None))
    if lat is None and isinstance(geo, dict):
        lat = _coerce_latlng(_first(geo, "latitude", "lat", default=None))
    if lng is None and isinstance(geo, dict):
        lng = _coerce_latlng(_first(geo, "longitude", "lng", "lon", default=None))
    if (lat is None or lng is None) and isinstance(raw, dict):
        dlat, dlng = _deep_find_latlng(raw)
        if lat is None:
            lat = dlat
        if lng is None:
            lng = dlng
    # SPYPOINT keeps the name you gave a camera under config.name. It's published as
    # "label" so that "name" stays the stable key captures, filters and renames use.
    config = raw.get("config") if isinstance(raw, dict) else None
    label = _first(config, "name", default=None) if isinstance(config, dict) else None
    return {
        "id": str(cid) if cid is not None else str(name or "unknown"),
        "name": name or (f"Camera {cid}" if cid is not None else "Camera"),
        "label": str(label).strip() if label else None,
        "latitude": blur_location(lat),
        "longitude": blur_location(lng),
    }


# ---- modes -----------------------------------------------------------------

def run_demo():
    """Generate sample data with inline SVG images -- no login or network needed."""
    import random
    random.seed(7)
    species_pool = (["Buck"] * 3 + ["Doe"] * 5 + ["Raccoon"] * 3 +
                    ["Squirrel"] * 3 + ["Fox", "Coyote", "Turkey", "Opossum", "Person"])
    cams = ["North Field", "Creek Crossing"]
    camera_meta = [{
        "id": "north-field",
        "name": "North Field",
        "latitude": 34.1134,
        "longitude": -84.1821,
    }, {
        "id": "creek-crossing",
        "name": "Creek Crossing",
        "latitude": 34.1087,
        "longitude": -84.1763,
    }]
    moons = ["New", "Wax Cres", "1st Qtr", "Wax Gib", "Full", "Wan Gib", "Last Qtr", "Wan Cres"]
    caps = []
    now = dt.datetime.now()
    for i in range(40):
        sp = random.choice(species_pool)
        days_ago = int((random.random() ** 1.4) * 30)
        hour = random.choice([5, 6, 7, 18, 19, 20, 21, 22, 0, 1]) if random.random() < 0.6 else random.randint(0, 23)
        when = (now - dt.timedelta(days=days_ago)).replace(hour=hour, minute=random.randint(0, 59))
        is_night = hour < 6 or hour >= 20
        caps.append({
            "id": f"demo_{i}",
            "species": sp,
            "camera": random.choice(cams),
            "date": when.isoformat(),
            "image": _demo_svg(sp, is_night),
            "isNight": is_night,
            "confidence": round(random.uniform(0.7, 0.98), 2),
            "temp": round((34 if is_night else 55) + random.uniform(0, 20)),
            "moon": moons[(days_ago // 4) % 8],
        })
    caps.sort(key=lambda c: c["date"], reverse=True)
    write_data_js(caps, cameras=camera_meta, demo=True)
    print("Demo data ready. Open index.html to preview.")


def _demo_svg(species, night):
    import base64
    bg = "#11161f" if night else "#5a6b46"
    fg = "#e8ede6" if night else "#1c2415"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">'
           f'<rect width="320" height="180" fill="{bg}"/>'
           f'<text x="160" y="96" font-family="sans-serif" font-size="20" font-weight="700" '
           f'fill="{fg}" text-anchor="middle">{species}</text></svg>')
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def best_photo_url(photo):
    """Return the largest image URL SPYPOINT offers for this photo.

    pyspypoint's url() defaults to "large" and raises (or builds a hostless URL) if
    that size is missing, which used to drop the photo with no way to notice.
    """
    for size in ("large", "medium", "small"):
        section = getattr(photo, size, None)
        if getattr(section, "host", "") and getattr(section, "path", ""):
            return photo.url(size)
    raise ValueError("no large, medium or small image on this photo")


HD_PROBE_FILE = HERE / "_hd_probe.json"


def _jpeg_size(data: bytes):
    """(width, height) from a JPEG's header, or None."""
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if 0xC0 <= marker <= 0xC3:
            return int.from_bytes(data[i + 7:i + 9], "big"), int.from_bytes(data[i + 5:i + 7], "big")
        i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    return None


def probe_hd(client, cameras, limit=10):
    """TEMP DIAGNOSTIC: does asking SPYPOINT for HD return bigger photos?

    Runs once (until _hd_probe.json exists) and records only sizes and field names.
    Image URLs are signed links, so they're never written down. Never fails a pull.
    """
    if HD_PROBE_FILE.exists():
        return
    import urllib.request
    result = {"checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    try:
        photos = list(client.photos(cameras, limit=limit, hd=True))
        result["returned"] = len(photos)
        rows = []
        for p in photos[:limit]:
            raw = _raw(p)
            row = {"id": str(raw.get("id", ""))[-6:], "fields": sorted(raw.keys()), "sizes": {}}
            for size in ("hd", "large", "medium", "small"):
                section = getattr(p, size, None)
                if not (getattr(section, "host", "") and getattr(section, "path", "")):
                    row["sizes"][size] = "missing"
                    continue
                try:
                    req = urllib.request.Request(p.url(size), headers={"User-Agent": "TrailHub/1.0"})
                    with urllib.request.urlopen(req, timeout=30) as response:
                        data = response.read()
                    dims = _jpeg_size(data)
                    row["sizes"][size] = {"bytes": len(data), "px": f"{dims[0]}x{dims[1]}" if dims else None}
                except Exception as e:
                    row["sizes"][size] = f"error: {type(e).__name__}"
            rows.append(row)
        result["photos"] = rows
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    atomic_write_text(HD_PROBE_FILE, json.dumps(result, indent=1))
    print(f"Wrote {HD_PROBE_FILE.name} (one-time HD check).")


def report_skip(message):
    """Print a skipped photo, flagged so it shows on the Actions run page."""
    print(f"  [skip] {message}")
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::warning title=Photo skipped::{message}")


def run_pull(limit, inspect):
    try:
        import spypoint
    except ImportError:
        sys.exit("ERROR: pyspypoint not installed. Run: pip install -r requirements.txt")

    user, pw = load_credentials()
    print("Logging in to SPYPOINT...")
    client = spypoint.Client(user, pw)

    cameras = client.cameras()
    print(f"Found {len(cameras)} camera(s).")

    photos = client.photos(cameras, limit=limit)
    photos = list(photos)
    print(f"Retrieved {len(photos)} photo record(s).")
    probe_hd(client, cameras)

    # --- TEMP DIAGNOSTIC (remove once the real species field is confirmed) ---
    # Writes a sanitized snapshot of the first few photos so we can see SPYPOINT's
    # actual tag schema. Field NAMES plus tag-like VALUES only; anything that could
    # be sensitive (image URLs, GPS, account ids, tokens) is omitted.
    try:
        _SENSITIVE = ("host", "path", "url", "gps", "lat", "lng", "lon", "coord",
                      "token", "user", "account", "uuid", "email", "pass",
                      "secret", "key", "hash", "sig")

        def _safe(k, v):
            if any(s in str(k).lower() for s in _SENSITIVE):
                return "<omitted>"
            sv = json.dumps(v, default=str)
            if len(sv) > 240 or "http" in sv.lower():
                return "<omitted>"
            return v

        probe = []
        for p in photos[:5]:
            r = _raw(p)
            if not isinstance(r, dict):
                continue
            det = _collect_species_tags(r)
            probe.append({
                "fields": {k: _safe(k, v) for k, v in r.items()},
                "detected": det,
                "normalized": normalize_species(det),
            })
        atomic_write_text(HERE / "_schema_probe.json", json.dumps(probe, indent=2, default=str))
        print("Wrote _schema_probe.json (temporary tag diagnostic).")
    except Exception as _e:
        print(f"  [probe] skipped: {_e}")
    # --- END TEMP DIAGNOSTIC -------------------------------------------------

    if inspect:
        if not photos:
            print("No photos to inspect.")
            return
        raw0 = _raw(photos[0])
        keys = sorted(raw0.keys()) if isinstance(raw0, dict) else []
        detected = _collect_species_tags(raw0)
        print("\n--- RAW SHAPE OF FIRST PHOTO (use this to tune extract_meta) ---")
        print("top-level keys:", keys)
        print("detected species tags:", detected)
        print("normalized species:", normalize_species(detected))
        print("raw JSON:", json.dumps(raw0, indent=2, default=str)[:6000])
        return

    # build a camera-id -> friendly-name lookup (best effort)
    cam_name_by_id = {}
    camera_meta = []
    for cam in cameras:
        meta = extract_camera_meta(cam)
        cid = meta["id"]
        cname = meta["name"]
        if cid is not None:
            cam_name_by_id[str(cid)] = cname or f"Camera {cid}"
        camera_meta.append(meta)

    PHOTOS_DIR.mkdir(exist_ok=True)
    store = load_store()          # durable history, keyed by stable id
    before = len(store)
    new_count = 0
    skipped = 0
    repair_day_night(store)

    r2 = make_r2_uploader()
    if r2 is not None:
        print(f"R2: hosting images on bucket '{r2.bucket}' -> {r2.public_base_url}")

    for i, p in enumerate(photos):
        raw = _raw(p)
        try:
            url = best_photo_url(p)
        except Exception as e:
            report_skip(f"photo {i}: no url ({e})")
            skipped += 1
            continue

        sid = stable_id(raw, url)
        ext = ".jpg"
        tail = url.split("?")[0].rsplit("/", 1)[-1]
        if "." in tail:
            ext = "." + tail.rsplit(".", 1)[-1][:4]
        fname = f"{sid}{ext}"
        dest = PHOTOS_DIR / fname

        meta = extract_meta(p, cam_name_by_id)
        meta["id"] = sid
        # Keep a temperature we already resolved (API or a prior OCR pass) so we
        # don't lose it or re-OCR the same photo on every run.
        prev = store.get(sid) or {}
        if meta.get("temp") is None and _is_num(prev.get("temp")):
            meta["temp"] = int(prev["temp"])
        if prev.get("overlayRead"):
            meta["overlayRead"] = prev["overlayRead"]
        if meta["timeSource"] == "upload" and prev.get("timeSource") == "overlay":
            meta["date"], meta["timeSource"] = prev["date"], "overlay"

        if r2 is not None:
            # Host on R2. Reuse an already-uploaded URL from the store so we don't
            # re-download from SPYPOINT (and re-upload) the same photo every run.
            prev_img = str((store.get(sid) or {}).get("image", ""))
            if prev_img.startswith("http"):
                meta["image"] = prev_img
                if prev.get("thumb"):
                    meta["thumb"] = prev["thumb"]
            else:
                try:
                    if not dest.exists():
                        download_with_retry(url, dest)
                    # Over the limit, the photo stays in the repo so it isn't lost.
                    meta["image"] = r2.upload(dest, fname) if r2.has_room(dest) else f"photos/{fname}"
                    attach_thumb(meta, dest, r2)
                    new_count += 1
                    print(f"  [new] {meta['species']:<10} {meta['camera']}")
                except Exception as e:
                    report_skip(f"{sid}: upload failed ({e})")
                    skipped += 1
                    continue
        elif str(prev.get("image", "")).startswith("http"):
            meta["image"] = prev["image"]  # already hosted; never point back at the repo
            if prev.get("thumb"):
                meta["thumb"] = prev["thumb"]
        else:
            # Legacy: keep the image in the repo under photos/.
            already = sid in store and dest.exists()
            meta["image"] = f"photos/{fname}"
            if prev.get("thumb"):
                meta["thumb"] = prev["thumb"]
            if not already:
                try:
                    if not dest.exists():
                        download_with_retry(url, dest)
                    attach_thumb(meta, dest, None)
                    new_count += 1
                    print(f"  [new] {meta['species']:<10} {meta['camera']}")
                except Exception as e:
                    report_skip(f"{sid}: download failed after retries ({e})")
                    skipped += 1
                    continue
        store[sid] = meta

    backfill_overlays(store)
    if r2 is not None:
        move_photos_to_r2(store, r2)
    backfill_thumbs(store, r2)
    if r2 is not None:
        delete_hosted_copies(store)
    store = prune_store(store)
    save_store(store)
    save_cameras(camera_meta)
    update_weather(list(store.values()) + load_uploads())
    write_data_js(list(store.values()), cameras=camera_meta, demo=False, tags_map=load_tags(), meta_map=load_metadata())
    print(f"\nStore: {before} -> {len(store)} captures (+{new_count} new, {skipped} skipped this run).")
    print("Done. Open index.html, or upload index.html + data.js + photos/ to Cloudflare.")


def run_rebuild():
    """Regenerate data.js from the existing store -- no login or network needed."""
    store = load_store()
    if not store:
        sys.exit("No store.json yet. Run `python pull.py` first (or `--demo` to preview).")
    repair_day_night(store)
    save_store(store)
    write_data_js(list(store.values()), cameras=load_cameras(), demo=False, tags_map=load_tags(), meta_map=load_metadata())
    print(f"Rebuilt data.js from store ({len(store)} captures).")


def run_ocr_temps():
    """Read the info bar on every photo not read yet, then rebuild data.js."""
    store = load_store()
    if not store:
        sys.exit("No store.json yet. Run `python pull.py` first.")
    done = backfill_overlays(store, limit=len(store))
    save_store(store)
    write_data_js(list(store.values()), cameras=load_cameras(), demo=False, tags_map=load_tags(), meta_map=load_metadata())
    print(f"Read {done} photo(s). data.js rebuilt.")


def run_thumbs():
    """Make the small copy for every photo that lacks one, then rebuild data.js."""
    store = load_store()
    if not store:
        sys.exit("No store.json yet. Run `python pull.py` first.")
    r2 = make_r2_uploader()
    done = backfill_thumbs(store, r2, limit=len(store))
    if r2 is not None:
        delete_hosted_copies(store)
    save_store(store)
    write_data_js(list(store.values()), cameras=load_cameras(), demo=False, tags_map=load_tags(), meta_map=load_metadata())
    print(f"Made {done} small cop{'y' if done == 1 else 'ies'}. data.js rebuilt.")


def main():
    ap = argparse.ArgumentParser(description="Pull SPYPOINT photos and build TrailHub data.")
    ap.add_argument("--limit", type=int, default=100, help="max photos per camera (default 100)")
    ap.add_argument("--inspect", action="store_true", help="print raw photo shape and exit")
    ap.add_argument("--demo", action="store_true", help="write sample data, no login needed")
    ap.add_argument("--rebuild", action="store_true", help="regenerate data.js from the local store, no network")
    ap.add_argument("--ocr-temps", action="store_true", help="OCR temperatures from existing photos, then rebuild data.js")
    ap.add_argument("--thumbs", action="store_true", help="make small copies for every photo missing one, then rebuild data.js")
    args = ap.parse_args()
    if args.demo:
        run_demo()
    elif args.rebuild:
        run_rebuild()
    elif args.ocr_temps:
        run_ocr_temps()
    elif args.thumbs:
        run_thumbs()
    else:
        run_pull(args.limit, args.inspect)


if __name__ == "__main__":
    main()
