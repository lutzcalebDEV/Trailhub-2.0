#!/usr/bin/env python3
"""Move the photo job's files between the workflow and private storage.

Nothing the site shows is kept in the (public) repo: data.js and the files behind
it live in the R2 bucket under "state/", which has no public address. The Worker
serves them only to signed-in people (tag-worker.js, "Private storage").

    python state_sync.py download   # before pull.py: fetch the latest state
    python state_sync.py upload     # after it: save what the photo job wrote

`download` also keeps the previous data.js as .prev-data.js, so push_alerts.py can
tell which sightings are new. It stops the run if the photo history (store.json)
can't be found, rather than starting over from nothing.

`upload` saves only the files the photo job owns, and only when they changed. The
Worker owns the files edited from the site (tags, notes, comments, camera names,
uploads); the workflow only ever reads those, so it can never undo an edit.
"""
import hashlib
import sys

from pull import HERE, make_r2_uploader

PREFIX = "state/"
# Written by pull.py and ai_tag.py.
JOB_FILES = ["data.js", "store.json", "cameras.json", "weather.json", "ai-tags.json"]
# Written by the Worker; the photo job reads them to bake edits into data.js.
SITE_FILES = ["tags.json", "metadata.json", "uploads.json"]
PREV_DATA = HERE / ".prev-data.js"
HASHES = HERE / ".state-hashes"


def content_type(name):
    return "application/javascript; charset=utf-8" if name.endswith(".js") else "application/json"


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def download(r2):
    hashes = []
    for name in JOB_FILES + SITE_FILES:
        text = r2.get_text(PREFIX + name)
        path = HERE / name
        if text is None:
            print(f"  {name}: not in private storage" + (", using the local copy" if path.exists() else ""))
            continue
        path.write_text(text, encoding="utf-8", newline="")
        hashes.append(f"{name} {digest(text)}")
        print(f"  {name}: {len(text):,} bytes")
    if not (HERE / "store.json").exists():
        sys.exit("store.json (the photo history) is missing; stopping so the run doesn't start over from nothing.")
    data = HERE / "data.js"
    PREV_DATA.write_text(data.read_text(encoding="utf-8") if data.exists() else "", encoding="utf-8", newline="")
    HASHES.write_text("\n".join(hashes) + "\n", encoding="utf-8")


def upload(r2):
    before = {}
    if HASHES.exists():
        for line in HASHES.read_text(encoding="utf-8").splitlines():
            name, _, h = line.partition(" ")
            before[name] = h
    for name in JOB_FILES:
        path = HERE / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if before.get(name) == digest(text):
            continue
        r2.put_text(PREFIX + name, text, content_type(name))
        print(f"  saved {name} ({len(text):,} bytes)")


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action not in ("download", "upload"):
        sys.exit("Usage: python state_sync.py download|upload")
    r2 = make_r2_uploader()
    if not r2:
        sys.exit("Private storage needs the R2_* settings (see the README).")
    print(f"State {action} ({r2.bucket}/{PREFIX}):")
    download(r2) if action == "download" else upload(r2)


if __name__ == "__main__":
    main()
