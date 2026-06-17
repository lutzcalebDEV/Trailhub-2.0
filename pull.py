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

MAX_PUBLISHED = 1500   # cap captures written to data.js so the site stays light
MAX_KEEP = 3000        # cap stored photos+images so the repo doesn't grow forever
MAX_IMG_PX = 1600      # downscale long edge if Pillow is available
DOWNLOAD_RETRIES = 3


def atomic_write_text(path: Path, text: str):
    """Write to a temp file in the same dir, then rename -- a crash never corrupts the target."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)

# ---- SPYPOINT tag -> TrailHub species bucket -------------------------------
# SPYPOINT's tag vocabulary may differ from these; unknown tags pass through
# unchanged and the UI will still display them (just with a neutral color).
SPECIES_MAP = {
    "buck": "Buck", "doe": "Doe", "deer": "Deer", "whitetail": "Deer",
    "raccoon": "Raccoon", "racoon": "Raccoon",
    "squirrel": "Squirrel", "fox": "Fox", "coyote": "Coyote",
    "turkey": "Turkey", "opossum": "Opossum", "possum": "Opossum",
    "human": "Person", "people": "Person", "person": "Person",
}


def normalize_species(tags):
    """Pick the most useful species label from a photo's tag list."""
    if not tags:
        return "Animal"
    if not isinstance(tags, (list, tuple)):
        tags = [tags]
    cleaned = [str(t).strip().lower() for t in tags if t]
    # Prefer a buck/doe call over a generic "deer" if both are present.
    for pref in ("buck", "doe"):
        if pref in cleaned:
            return SPECIES_MAP[pref]
    for t in cleaned:
        if t in SPECIES_MAP:
            return SPECIES_MAP[t]
    # Unknown tag: Title-case it and show it as-is.
    return cleaned[0].title() if cleaned else "Animal"


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


# ---- field extraction ------------------------------------------------------
# pyspypoint's documented surface is small (Client / cameras() / photos() / url()).
# Each photo object wraps SPYPOINT's raw JSON; field names below are best-guesses
# with fallbacks. Run `python pull.py --inspect` once to see the real shape, and
# adjust these helpers if needed -- everything else stays the same.

def _raw(photo):
    """Return the underlying dict for a photo object, however it's stored."""
    for attr in ("_json", "json", "data", "raw", "_data", "__dict__"):
        v = getattr(photo, attr, None)
        if isinstance(v, dict) and v:
            return v
    if isinstance(photo, dict):
        return photo
    return {}


def _first(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] not in (None, ""):
            return d[k]
    return default


def extract_meta(photo, cam_name_by_id):
    raw = _raw(photo)
    # timestamp
    ts = _first(raw, "date", "originDate", "createdAt", "timestamp")
    when = parse_date(ts)
    # species tags
    tags = _first(raw, "tags", "speciesTags", "labels", default=[])
    species = normalize_species(tags)
    # camera
    cam_id = _first(raw, "camera", "cameraId", "camera_id")
    camera = cam_name_by_id.get(str(cam_id), None) or _first(raw, "cameraName", default="Camera")
    # day/night: prefer an explicit flag, else derive from hour
    is_night = _first(raw, "isNight", "night")
    if is_night is None:
        is_night = when.hour < 6 or when.hour >= 20
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
        "isNight": bool(is_night),
        "temp": (round(float(temp)) if _is_num(temp) else None),
        "confidence": conf,
        "moon": _first(raw, "moonPhase", "moon"),
    }


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


def load_cameras():
    if not CAMERA_FILE.exists():
        return []
    try:
        data = json.loads(CAMERA_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
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


def prune_store(store):
    """Keep only the newest MAX_KEEP captures; delete image files for the rest."""
    items = sorted(store.values(), key=lambda c: c.get("date", ""), reverse=True)
    if len(items) <= MAX_KEEP:
        return store
    for c in items[MAX_KEEP:]:
        img = c.get("image", "")
        if img.startswith("photos/"):
            try:
                (HERE / img).unlink(missing_ok=True)
            except OSError:
                pass
    return {c["id"]: c for c in items[:MAX_KEEP]}


def write_data_js(captures, cameras=None, demo=False, tags_map=None):
    """Render the published data.js from a list of captures (atomic write).

    tags_map (optional) overlays user-applied tags by photo id; the first tag
    becomes the primary species. Captures without user tags default to a single
    tag matching their detected species.
    """
    tags_map = tags_map or {}
    captures = sorted(captures, key=lambda c: c.get("date", ""), reverse=True)[:MAX_PUBLISHED]
    out_caps = []
    for c in captures:
        c = dict(c)
        user_tags = tags_map.get(str(c.get("id")))
        if user_tags:
            c["tags"] = user_tags
            c["species"] = user_tags[0]
        elif not c.get("tags"):
            c["tags"] = [c.get("species", "Animal")]
        out_caps.append(c)
    payload = {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "demo": demo,
        "cameras": cameras or [],
        "captures": out_caps,
    }
    atomic_write_text(DATA_FILE, "window.TRAILHUB_DATA = " + json.dumps(payload, indent=2) + ";\n")
    print(f"Wrote {DATA_FILE.name}  ({len(out_caps)} captures)")


def _coerce_latlng(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n


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
    return {
        "id": str(cid) if cid is not None else str(name or "unknown"),
        "name": name or (f"Camera {cid}" if cid is not None else "Camera"),
        "latitude": lat,
        "longitude": lng,
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

    if inspect:
        if not photos:
            print("No photos to inspect.")
            return
        print("\n--- RAW SHAPE OF FIRST PHOTO (use this to tune extract_meta) ---")
        print("attributes:", [a for a in dir(photos[0]) if not a.startswith("__")])
        print("raw dict:", json.dumps(_raw(photos[0]), indent=2, default=str)[:4000])
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

    for i, p in enumerate(photos):
        raw = _raw(p)
        try:
            url = p.url()
        except Exception as e:
            print(f"  [skip] photo {i}: no url ({e})")
            continue

        sid = stable_id(raw, url)
        ext = ".jpg"
        tail = url.split("?")[0].rsplit("/", 1)[-1]
        if "." in tail:
            ext = "." + tail.rsplit(".", 1)[-1][:4]
        fname = f"{sid}{ext}"
        dest = PHOTOS_DIR / fname

        # Already have this photo? Refresh its metadata (tags can change) but skip re-download.
        already = sid in store and dest.exists()
        meta = extract_meta(p, cam_name_by_id)
        meta["id"] = sid
        meta["image"] = f"photos/{fname}"

        if not already:
            try:
                if not dest.exists():
                    download_with_retry(url, dest)
                new_count += 1
                print(f"  [new] {meta['species']:<10} {meta['camera']}")
            except Exception as e:
                print(f"  [skip] {sid}: download failed after retries ({e})")
                continue
        store[sid] = meta

    store = prune_store(store)
    save_store(store)
    save_cameras(camera_meta)
    write_data_js(list(store.values()), cameras=camera_meta, demo=False, tags_map=load_tags())
    print(f"\nStore: {before} -> {len(store)} captures (+{new_count} new this run).")
    print("Done. Open index.html, or upload index.html + data.js + photos/ to Cloudflare.")


def run_rebuild():
    """Regenerate data.js from the existing store -- no login or network needed."""
    store = load_store()
    if not store:
        sys.exit("No store.json yet. Run `python pull.py` first (or `--demo` to preview).")
    write_data_js(list(store.values()), cameras=load_cameras(), demo=False, tags_map=load_tags())
    print(f"Rebuilt data.js from store ({len(store)} captures).")


def main():
    ap = argparse.ArgumentParser(description="Pull SPYPOINT photos and build TrailHub data.")
    ap.add_argument("--limit", type=int, default=100, help="max photos per camera (default 100)")
    ap.add_argument("--inspect", action="store_true", help="print raw photo shape and exit")
    ap.add_argument("--demo", action="store_true", help="write sample data, no login needed")
    ap.add_argument("--rebuild", action="store_true", help="regenerate data.js from the local store, no network")
    args = ap.parse_args()
    if args.demo:
        run_demo()
    elif args.rebuild:
        run_rebuild()
    else:
        run_pull(args.limit, args.inspect)


if __name__ == "__main__":
    main()
