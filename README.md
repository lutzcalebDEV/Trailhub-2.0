# TrailHub

A simple dashboard for your SPYPOINT trail-cam photos. Everything runs **on your
own computer**: a small Python script logs into SPYPOINT, downloads recent
photos, and writes a `data.js` file that the page reads. The published site is
just static files — no server, no AI, no credentials in the cloud.

## What's in here

- `index.html` — the dashboard (self-contained; no internet needed to render)
- `pull.py` — fetches your photos + SPYPOINT's species tags, writes `data.js`
- `data.js` — generated photo data (starts as sample data so you can preview)
- `store.json` — durable history of every photo seen (created on first run; the source of truth, not uploaded)
- `photos/` — downloaded images (created on first real run)
- `requirements.txt` — the one required dependency (`pyspypoint`)

The dashboard has four views: **Recent** (last 7 days), **Patterns** (scouting
analytics — daylight-movement %, peak hours, day/night split by species, plus
temperature and moon breakdowns when that data is available), **Calendar**, and
**All**. Every filter (Bucks Only, species, camera, day/night) flows into the
Patterns view, so you can ask "when does this buck move at this camera?"

## 1. Preview it right now (no setup)

Just double-click `index.html`. You'll see the layout filled with **sample
data**. (It opens straight from your file system — no server needed.)

## 2. Hook up your real cameras

Install the dependency:

```
pip install -r requirements.txt
```

Give the script your SPYPOINT login. **Never type your password into the script
or commit it anywhere** — use environment variables:

**macOS / Linux**
```
export SPYPOINT_USERNAME="you@email.com"
export SPYPOINT_PASSWORD="your-password"
```

**Windows (PowerShell)**
```
$env:SPYPOINT_USERNAME="you@email.com"
$env:SPYPOINT_PASSWORD="your-password"
```

Or create a file named `.env` next to `pull.py` (copy `.env.example`). If you
use git, keep `.env` out of it.

Then pull your photos:

```
python pull.py
```

This downloads images into `photos/` and rewrites `data.js`. Refresh
`index.html` and you'll see your real captures. Re-run `python pull.py` whenever
you want fresh photos.

## 2b. Fetch from a button in the page (local)

If you want to click a button in the dashboard to fetch new photos on demand,
run the local API service in a terminal:

```
python fetch_api.py
```

Then open `index.html` and click **Fetch Photos** in the top-right.

- The page calls `http://127.0.0.1:8787/api/fetch-photos`
- That endpoint runs `pull.py --limit 100`
- After it finishes, the page reloads `data.js` and shows any new captures

If the API is not running, the page will show an error note.

## 2c. Fetch from a button in production

Production fetch requires a secure backend endpoint. This repo includes Cloudflare
Pages Functions under [functions/api/fetch-photos.js](functions/api/fetch-photos.js)
that safely trigger the GitHub workflow instead of exposing SPYPOINT credentials
to the browser.

Required Cloudflare environment variables:

- `GITHUB_OWNER` (example: `lutzcalebDEV`)
- `GITHUB_REPO` (example: `Trailhub-2.0`)
- `GITHUB_TOKEN` (GitHub PAT with `repo` and `workflow`/`actions:write` scope)
- Optional: `GITHUB_WORKFLOW_FILE` (default: `update.yml`)
- Optional: `GITHUB_REF` (default: `main`)
- Optional: `FETCH_API_KEY` (if set, requests must include this key)

How it works:

1. Browser calls `POST /api/fetch-photos`
2. Function dispatches the `Update TrailHub` workflow on GitHub
3. Workflow runs `pull.py` and commits fresh `data.js`/photos
4. Page polls `data.js` and loads new captures when available

Health check endpoint:

- `GET /api/health` returns whether GitHub env vars are configured.

## 3. Publish manually (Cloudflare) — the simple, hands-on option

Upload these three things via the **"Upload your static files"** flow:

- `index.html`
- `data.js`
- the `photos/` folder

(You don't need to upload `pull.py`, `README.md`, or `requirements.txt`.)

To update the live site later: re-run `python pull.py`, then re-upload.

## 4. Run it autonomously (GitHub) — set it and forget it

This hosts the site publicly AND updates it on its own every hour, with no
computer of yours running. Your SPYPOINT login is stored as an encrypted GitHub
secret — used only by the automated job, never visible to site visitors, and not
exposed even though the repo is public.

**First, validate locally (do not skip).** `pyspypoint` is unofficial, so confirm
it works with your account before automating, or the site will just silently stop
updating. Set your creds (step 2) and run:

```
python pull.py --inspect    # confirms login works + shows the real photo fields
python pull.py              # confirms photos actually download
```

Once a normal `python pull.py` pulls your real photos, you're clear to automate:

1. **Create a public GitHub repo** (public = free unlimited Actions + free Pages).
2. **Push these files** to it: `index.html`, `pull.py`, `requirements.txt`,
   `.github/workflows/update.yml`, and `.gitignore`. The `.gitignore` keeps your
   `.env` out — never commit your password.
3. **Add your secrets:** repo **Settings → Secrets and variables → Actions → New
   repository secret**. Add two: `SPYPOINT_USERNAME` and `SPYPOINT_PASSWORD`.
4. **Turn on the website:** **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → `main` / `/ (root)`.** Your site goes live at
   `https://<your-username>.github.io/<repo-name>/`.
5. **Kick it off once:** **Actions tab → Update TrailHub → Run workflow.** Watch it
   log in, pull, and commit. After that it runs **every hour automatically** and the
   site updates itself.

### Things to know

- **Schedule is UTC** and may run a few minutes late — fine for hourly.
- **60-day rule:** GitHub pauses scheduled jobs if the repo has no activity for 60
  days. You'll get an email; one click on the Actions tab re-enables it. (The
  hourly photo commits usually keep it alive, but if it ever goes quiet, that's why.)
- **Public repo, private secrets:** your code and photos are public; your SPYPOINT
  login stays encrypted and is never readable by visitors or collaborators.
- Prefer your own Cloudflare domain? You can instead connect Cloudflare Pages to
  the GitHub repo (Cloudflare auto-deploys on every commit) — same automation, just
  a different host.

## Useful flags

```
python pull.py --limit 200    # pull more photos per camera (default 100)
python pull.py --rebuild      # rebuild data.js from the local store (no network)
python pull.py --demo         # regenerate sample data (no login/network)
python pull.py --inspect      # print the raw shape of one photo, then exit
```

Each run only downloads photos it hasn't already seen (tracked in `store.json`),
then rewrites `data.js` from the full history — so your timeline never shrinks,
and a dropped connection mid-run just resumes next time. Writes are atomic, so a
crash can't corrupt your data. Old photos beyond a cap are pruned automatically so
the repo stays a reasonable size.

**Optional:** if you `pip install Pillow`, large photos are automatically
downscaled so the site loads faster and uploads are smaller. Without it,
images are kept full-size — everything still works.

## If something looks off

`pyspypoint` is an **unofficial** client, so SPYPOINT can change things without
notice. If species labels, dates, or camera names come through wrong, run:

```
python pull.py --inspect
```

That prints the actual fields SPYPOINT returns. Share that output and the field
mapping in `pull.py` (the `extract_meta` function) can be adjusted to match —
nothing else needs to change.

### Notes & limits

- **Buck vs Doe** comes from SPYPOINT's own Buck Tracker tags. Untagged photos
  show up as "Animal" or a generic label — you can't filter what isn't tagged.
- The free SPYPOINT plan transmits a limited number of photos per month, so this
  is meant for modest volumes.
- Anything you publish to the static site is public to anyone with the URL.
