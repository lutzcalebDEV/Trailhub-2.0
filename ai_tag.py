#!/usr/bin/env python3
"""
TrailHub :: ai_tag.py
---------------------
Identifies animals in photos SPYPOINT left as a generic "Animal", using the free
tier of the Gemini API. Results go in ai-tags.json, which pull.py overlays when it
writes data.js. Your own tags and SPYPOINT's specific labels always win.

USAGE
  Put GEMINI_API_KEY in the environment or in .env (never commit it), then:
    python ai_tag.py --check      # one photo; prints the raw reply to confirm the setup
    python ai_tag.py --eval 10    # score against photos SPYPOINT already called Buck
    python ai_tag.py              # tag up to AI_MAX_PER_RUN untagged photos

Optional env vars: AI_MODEL (default below), AI_MAX_PER_RUN (default 15).

A missing key or an exhausted quota is a quiet exit, so this can never block the
photo pull. Anything left over is picked up on the next run.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

from pull import HERE, atomic_write_text, load_store, load_tags

AI_TAGS_FILE = HERE / "ai-tags.json"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
DEFAULT_MODEL = "gemini-3.5-flash-lite"
MAX_ERRORS_IN_A_ROW = 3
REQUEST_GAP_SECONDS = 4.5  # stays under a 15 requests-per-minute limit
BUSY_RETRY_SECONDS = (10, 30)  # waits after Google reports it's overloaded

LABELS = [
    "Buck", "Doe", "Deer", "Turkey", "Raccoon", "Squirrel", "Fox", "Coyote",
    "Opossum", "Bear", "Bobcat", "Rabbit", "Bird", "Person", "Vehicle",
    "Other animal", "Empty",
]

PROMPT = """This is a trail camera photo from the woods of western North Carolina.
Name the main subject using one label.

- Buck: a deer with antlers clearly visible.
- Doe: an adult deer seen well enough to be sure it has no antlers.
- Deer: a deer when antlers can't be judged (far away, turned, blurred, or a fawn).
- Other animal: an animal that fits no other label, or can't be identified.
- Empty: nothing but trees, leaves, shadows or rain.

Deer are by far the most common animal here. Glowing eyes at night are normal for
deer, so only choose a predator when the body shape clearly shows one.
Ignore the black info bar along the bottom edge. Night photos are infrared and grey.
Animals are often small, partly hidden or at the edge of the frame, so check closely
before choosing Empty. If several animals appear, label the most notable one.
Set confidence from 0 to 1, and keep it low when you are unsure."""

SCHEMA = {
    "type": "object",
    "properties": {
        "label": {"type": "string", "enum": LABELS},
        "confidence": {"type": "number"},
    },
    "required": ["label", "confidence"],
}


class QuotaExhausted(Exception):
    """The API refused because of rate or daily limits; try again next run."""


def load_api_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    env_path = HERE / ".env"
    if not key and env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "GEMINI_API_KEY":
                key = value.strip().strip('"').strip("'")
    return key


def call_gemini(image: bytes, api_key: str, model: str) -> dict:
    """Send one photo and return the decoded JSON reply."""
    body = {
        "model": model,
        "store": False,  # nothing here needs keeping on Google's side
        "input": [
            {"type": "text", "text": PROMPT},
            {
                "type": "image",
                "data": base64.b64encode(image).decode("ascii"),
                "mime_type": "image/jpeg",
            },
        ],
        "response_format": {"type": "text", "mime_type": "application/json", "schema": SCHEMA},
    }
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "Api-Revision": "2026-05-20",
        },
    )
    for wait in (*BUSY_RETRY_SECONDS, None):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code == 429:
                raise QuotaExhausted(detail) from e
            if e.code != 503 or wait is None:
                raise RuntimeError(f"HTTP {e.code}: {detail}") from e
            time.sleep(wait)


def _strings(node):
    """Yield every string in a reply, outermost first."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _strings(value)


def parse_reply(reply: dict):
    """Find the {label, confidence} answer. Returns (label, confidence) or None.

    Google documents output_text for the SDKs but not the raw layout, so this looks
    for the answer anywhere in the reply and validates it against the allowed labels.
    """
    for text in _strings(reply):
        if "label" not in text:
            continue
        try:
            answer = json.loads(text)
            label, confidence = answer["label"], float(answer["confidence"])
        except (ValueError, TypeError, KeyError):
            continue
        if label in LABELS:
            return label, round(min(max(confidence, 0.0), 1.0), 2)
    return None


def has_photo(capture):
    image = str(capture.get("image", ""))
    return image.startswith("https://") or (image.startswith("photos/") and (HERE / image).exists())


def photo_bytes(capture):
    """Read a photo from Cloudflare R2, or from the repo if it hasn't moved."""
    image = str(capture["image"])
    if not image.startswith("https://"):
        return (HERE / image).read_bytes()
    request = urllib.request.Request(image, headers={"User-Agent": "TrailHub/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def load_ai_tags():
    try:
        data = json.loads(AI_TAGS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def newest_first(captures):
    return sorted(captures, key=lambda c: c.get("date", ""), reverse=True)


def run_check(api_key, model):
    capture = next((c for c in newest_first(load_store().values()) if has_photo(c)), None)
    if capture is None:
        sys.exit("No local photos found to test with.")
    reply = call_gemini(photo_bytes(capture), api_key, model)
    print(json.dumps(reply, indent=2)[:1500])
    print(f"\nModel: {model}\nPhoto: {capture['image']}\nParsed: {parse_reply(reply)}")


def run_eval(api_key, model, count):
    bucks = [c for c in newest_first(load_store().values()) if c.get("species") == "Buck" and has_photo(c)]
    results = {}
    for i, capture in enumerate(bucks[:count]):
        if i:
            time.sleep(REQUEST_GAP_SECONDS)
        parsed = parse_reply(call_gemini(photo_bytes(capture), api_key, model))
        label = parsed[0] if parsed else "(no answer)"
        results[label] = results.get(label, 0) + 1
        print(f"  {capture['id'][:18]:<20} {parsed}")
    total = sum(results.values())
    print(f"\nSPYPOINT said Buck on {total} photos. {model} said: {results}")
    print("Bursts often have a frame with no deer in it, so check any misses by eye.")


def run_tagging(api_key, model, limit):
    done = load_ai_tags()
    user_tags = load_tags()
    pending = [
        c for c in newest_first(load_store().values())
        if c.get("species") == "Animal" and c["id"] not in done
        and c["id"] not in user_tags and has_photo(c)
    ]
    print(f"AI tagging: {len(pending)} photo(s) waiting, up to {limit} this run ({model}).")
    tagged = errors = 0
    for capture in pending[:limit]:
        if tagged or errors:
            time.sleep(REQUEST_GAP_SECONDS)
        try:
            parsed = parse_reply(call_gemini(photo_bytes(capture), api_key, model))
            if parsed is None:
                raise RuntimeError("reply had no usable label")
        except QuotaExhausted:
            print("  Free quota reached; the rest wait for the next run.")
            break
        except Exception as e:
            print(f"  [skip] {capture['id']}: {e}")
            errors += 1
            if errors >= MAX_ERRORS_IN_A_ROW:
                print("  Stopping after repeated errors.")
                break
            continue
        errors = 0
        done[capture["id"]] = {"label": parsed[0], "confidence": parsed[1], "model": model}
        tagged += 1
        print(f"  {parsed[0]:<13} {parsed[1]:.2f}  {capture['id']}")
    if tagged:
        atomic_write_text(AI_TAGS_FILE, json.dumps(done, indent=1, sort_keys=True))
    print(f"AI tagging: {tagged} tagged, {max(len(pending) - tagged, 0)} still waiting.")


def main():
    parser = argparse.ArgumentParser(description="Tag generic photos with Gemini.")
    parser.add_argument("--check", action="store_true", help="test one photo and print the raw reply")
    parser.add_argument("--eval", type=int, nargs="?", const=10, metavar="N",
                        help="score N photos SPYPOINT called Buck (default 10)")
    args = parser.parse_args()

    api_key = load_api_key()
    if not api_key:
        if args.check or args.eval:
            sys.exit("Set GEMINI_API_KEY in the environment or in .env first.")
        print("AI tagging skipped: GEMINI_API_KEY is not set.")
        return
    model = os.environ.get("AI_MODEL", "").strip() or DEFAULT_MODEL
    if args.check:
        run_check(api_key, model)
    elif args.eval:
        run_eval(api_key, model, args.eval)
    else:
        run_tagging(api_key, model, int(os.environ.get("AI_MAX_PER_RUN") or 15))


if __name__ == "__main__":
    main()
