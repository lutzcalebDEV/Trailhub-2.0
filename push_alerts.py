"""Push alerts: tell phones about new sightings after each publish.

Runs in the GitHub workflow right after a successful publish. It compares the
data.js just pushed with the one before it and collects each photo's species that
are new: a new photo, or an existing photo that just got identified (by SPYPOINT,
the AI tagger, or someone tagging it on the site). It then sends that list to the
Worker's /push/notify, which delivers standard push notifications to every phone
that turned on alerts for those species (each person picks theirs in the app).

Quiet by design: only photos taken in the last 48 hours count, a burst of frames
from one trigger is one sighting, and "Animal" (unidentified) and "Empty" never
alert. Needs PUSH_SECRET (the same value as the Worker secret); without it, or
without a Worker URL in config.js, this does nothing.

    python push_alerts.py --before <git revision>     # what the workflow runs
    python push_alerts.py --before HEAD~50 --dry-run  # preview, sends nothing
"""
import os
import re
import sys
import json
import argparse
import subprocess
import urllib.request
import datetime as dt
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
RECENT_HOURS = 48
BURST_SECONDS = 120
QUIET = {"Animal", "Empty"}

try:
    from zoneinfo import ZoneInfo
    SITE_TZ = ZoneInfo("America/New_York")
except Exception:
    SITE_TZ = dt.timezone(dt.timedelta(hours=-5))


def parse_payload(text):
    m = re.search(r"window\.TRAILHUB_DATA\s*=\s*(\{.*\})\s*;?\s*$", text or "", re.S)
    return json.loads(m.group(1)) if m else None


def data_at(rev):
    """data.js as it was at a git revision (None if it didn't exist)."""
    try:
        out = subprocess.run(["git", "show", f"{rev}:data.js"], cwd=HERE, capture_output=True, check=True)
        return parse_payload(out.stdout.decode("utf-8"))
    except Exception:
        return None


def tags_of(c):
    return [t for t in (c.get("tags") or [c.get("species")]) if t]


def when(c):
    try:
        d = dt.datetime.fromisoformat(str(c["date"]).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None


def camera_namer(payload):
    """Same naming as the site: renamed > SPYPOINT label (if unique) > short id."""
    cams = payload.get("cameras") or []
    labels = [c.get("label") for c in cams if c.get("label")]
    names = {c["name"]: c["label"] for c in cams if c.get("label") and labels.count(c["label"]) == 1}
    try:
        renamed = json.loads((HERE / "camera-names.json").read_text(encoding="utf-8"))
        names.update({k: v for k, v in renamed.items() if isinstance(v, str) and v.strip()})
    except Exception:
        pass

    def name(raw):
        if raw in names:
            return names[raw]
        if re.fullmatch(r"Camera [0-9a-f]{12,}", raw or "", re.I):
            return "Camera " + raw[-4:]
        return raw or "Camera"
    return name


def site_url():
    if os.environ.get("SITE_URL"):
        return os.environ["SITE_URL"].rstrip("/") + "/"
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in repo:
        owner, name = repo.split("/", 1)
        return f"https://{owner.lower()}.github.io/{name}/"
    return ""


def worker_url():
    try:
        text = (HERE / "config.js").read_text(encoding="utf-8")
        m = re.search(r'TRAILHUB_TAGS_API\s*=\s*"([^"]+)"', text)
        return m.group(1).rstrip("/") if m else ""
    except Exception:
        return ""


def fmt_time(d):
    local = d.astimezone(SITE_TZ)
    return f"{local.strftime('%a, %b')} {local.day} · {local.strftime('%I:%M %p').lstrip('0')}"


def build_sightings(before, after, now=None, hours=RECENT_HOURS):
    now = now or dt.datetime.now(dt.timezone.utc)
    seen = {str(c.get("id")): set(tags_of(c)) for c in (before or {}).get("captures", [])}
    # (photo, species) pairs that are new in this publish.
    fresh = []
    for c in after.get("captures", []):
        d = when(c)
        if not d or (now - d).total_seconds() > hours * 3600:
            continue
        for sp in tags_of(c):
            if sp not in QUIET and sp not in seen.get(str(c.get("id")), set()):
                fresh.append((sp, c))
    # One sighting per burst: same species, same camera, frames close together.
    fresh.sort(key=lambda x: (x[0], x[1].get("camera") or "", when(x[1])))
    groups = []
    for sp, c in fresh:
        last = groups[-1] if groups else None
        if last and last["species"] == sp and last["frames"][-1].get("camera") == c.get("camera") \
                and (when(c) - when(last["frames"][-1])).total_seconds() <= BURST_SECONDS:
            last["frames"].append(c)
        else:
            groups.append({"species": sp, "frames": [c]})

    name = camera_namer(after)
    base = site_url()
    out = []
    for g in groups:
        lead = g["frames"][0]
        buck = next((c.get("buck") for c in g["frames"] if c.get("buck")), None)
        who = buck if (buck and g["species"] == "Buck") else g["species"]
        n = len(g["frames"])
        out.append({
            "species": g["species"],
            "title": f"{who} at {name(lead.get('camera'))}",
            "body": fmt_time(when(lead)) + (f" · {n} photos" if n > 1 else ""),
            "url": f"{base}#photo={quote(str(lead.get('id')))}" if base else "",
            "tag": str(lead.get("id")),
            "camera": str(lead.get("camera") or ""),
            "_when": when(lead),
        })
    out.sort(key=lambda s: s["_when"], reverse=True)
    return [{k: v for k, v in s.items() if not k.startswith("_")} for s in out]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--before", required=True, help="git revision of the previously published data.js")
    ap.add_argument("--dry-run", action="store_true", help="print the sightings instead of sending them")
    ap.add_argument("--all-ages", action="store_true", help="ignore the 48-hour window (for previews)")
    args = ap.parse_args()

    secret = os.environ.get("PUSH_SECRET", "").strip()
    api = worker_url()
    if not args.dry_run and (not secret or not api):
        print("Push alerts: PUSH_SECRET or the Worker URL isn't set; nothing to do.")
        return 0
    after = parse_payload((HERE / "data.js").read_text(encoding="utf-8"))
    if not after:
        print("Push alerts: couldn't read data.js.")
        return 1
    now = dt.datetime(2100, 1, 1, tzinfo=dt.timezone.utc) if args.all_ages else None
    sightings = build_sightings(data_at(args.before), after, now, 10 ** 6 if args.all_ages else RECENT_HOURS)
    if not sightings:
        print("Push alerts: no new sightings.")
        return 0
    if args.dry_run:
        for s in sightings:
            print(json.dumps(s, ensure_ascii=False))
        return 0
    req = urllib.request.Request(f"{api}/push/notify", data=json.dumps({"sightings": sightings}).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print("Push alerts:", r.read().decode("utf-8"))
    except Exception as e:
        print(f"::warning::Push alerts failed: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
