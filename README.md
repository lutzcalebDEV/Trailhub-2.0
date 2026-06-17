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
- `config.js` — site config (optional tag-sharing endpoint; safe to commit, no secrets)
- `tags.json` — your photo tags/reclassifications (shared source of truth, baked into `data.js`)
- `tag-worker.js` — optional Cloudflare Worker that saves tags for everyone (see "Shared tags")

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

## 3. Publish manually (Cloudflare) — the simple, hands-on option

Upload these three things via the **"Upload your static files"** flow:

- `index.html`
- `data.js`
- the `photos/` folder

(You don't need to upload `pull.py`, `README.md`, or `requirements.txt`.)

To update the live site later: re-run `python pull.py`, then re-upload. (If you
turn on tag sharing below, also upload `config.js`.)

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

## 5. Tag and reclassify photos

Open any photo and use the **Tags** panel to classify what's in it:

- **Add more than one tag.** A single frame can be both **Deer** and **Turkey** —
  click **+ Add** and pick from the list or type your own tag. The photo then
  shows up under *each* of its tags in Recent, Calendar, and the filters.
- **Reclassify.** Click a tag to make it the **primary** label (the headline name
  and color); click the **×** to remove a tag.
- Tags are remembered. By default they're saved **in your browser** only — great
  for solo use, but other people/machines won't see them. To share them with
  everyone, set up the one-time sync below.

### Shared tags (so everyone sees them)

The site is static (GitHub Pages can serve files but not save them), so saving a
tag for *everyone* needs one tiny helper that holds a GitHub token securely and
writes `tags.json` for you. A free **Cloudflare Worker** does this; `tag-worker.js`
is included and ready to deploy.

1. **Make a GitHub token.** GitHub → **Settings → Developer settings →
   Fine-grained tokens → Generate new token.** Limit it to **only this repo**, and
   under **Repository permissions** set **Contents: Read and write.** Copy the token.
2. **Create the Worker.** Cloudflare dashboard → **Workers & Pages → Create →
   Worker.** Replace the starter code with the contents of `tag-worker.js` and
   **Deploy.**
3. **Add the Worker's variables.** Worker → **Settings → Variables and Secrets**:
   - `GITHUB_TOKEN` — your token (add it as a **Secret**)
   - `GITHUB_OWNER` — your GitHub username (e.g. `lutzcalebDEV`)
   - `GITHUB_REPO` — the repo name (e.g. `Trailhub-2.0`)
   - `GITHUB_BRANCH` — `main` (optional)

   Deploy again so the variables take effect.
4. **Point the site at it.** Copy your Worker URL (looks like
   `https://trailhub-tags.<you>.workers.dev`) and paste it into `config.js`:
   ```js
   window.TRAILHUB_TAGS_API = "https://trailhub-tags.<you>.workers.dev";
   ```
   Commit `config.js`. Now anyone who tags a photo updates `tags.json` for
   everyone, and the next `pull.py` run bakes those tags into `data.js`.

Notes:
- This intentionally lets **any visitor** edit tags (no login), matching a shared
  family/camp dashboard. Anyone with the Worker URL can write tags, so keep it to
  people you'd share the site with.
- No Worker yet? Everything still works — tags just stay on each device until you
  finish the setup.

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
  show up as "Animal" — but you can classify them yourself with **Tags** (see
  "Tag and reclassify photos"), including more than one tag per photo.
- The free SPYPOINT plan transmits a limited number of photos per month, so this
  is meant for modest volumes.
- Anything you publish to the static site is public to anyone with the URL.
