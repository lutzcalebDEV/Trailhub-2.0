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

The site has six pages: **Home** (camera status, the best bet for a sit, and the
latest photos), **Photos** (everything, grouped by day), **Bucks** (a history for each
deer you name), **Patterns** (when animals move, including by weather), **Map**, and
**Identify** (put a name to untagged photos). Filters carry across Photos, Patterns
and Map, so you can ask "when does this buck move at this camera?"

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

### Reliable 15-minute updates

GitHub treats scheduled workflows as best effort. This repo's 15-minute cron has
been running only about 5 times a day, with gaps of up to 10 hours, so new photos
can take hours to appear even though every run succeeds. For a dependable schedule,
let the Cloudflare Worker start the job:

1. Give your fine-grained GitHub token **Actions: Read and write** as well as
   **Contents: Read and write** (or add a separate token as the `DISPATCH_TOKEN`
   secret).
2. Set the Worker secrets and deploy, as described under "Shared tags" below. You
   only need `GITHUB_TOKEN`, `GITHUB_OWNER` and `GITHUB_REPO` for this; `config.js`
   can stay blank.

`wrangler.toml` already declares the 15-minute Cron Trigger. If a photo can't be
fetched, the run shows a **Photo skipped** warning on its Actions page.

### Things to know

- **Schedule is UTC** and may run late or be skipped (see above).
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
  everyone, set up the one-time sync below. Anything tagged on a device before that
  uploads automatically the next time the site opens there.

### Shared tags (so everyone sees them)

The site is static (GitHub Pages can serve files but not save them), so saving a
tag for *everyone* needs one tiny helper that holds a GitHub token securely and
writes `tags.json` for you. A free **Cloudflare Worker** does this; `tag-worker.js`
is included and ready to deploy. The **same Worker** also powers **bulk tagging**
(tag many photos at once from the Gallery's **Select** button) and **global camera
renames** (the pencil on each camera in **Map**) — they all sync through it, so you
only set this up once.

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
   everyone, and the next `pull.py` run bakes those tags into `data.js`. Camera
   renames are written to `camera-names.json` the same way.

   Prefer the command line? With [wrangler](https://developers.cloudflare.com/workers/wrangler/)
   installed you can skip the dashboard: set the three secrets once
   (`npx wrangler secret put GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`) and run
   `npx wrangler deploy` — `wrangler.toml` is already included.

Notes:
- This intentionally lets **any visitor** edit tags (no login), matching a shared
  family/camp dashboard. Anyone with the Worker URL can write tags, so keep it to
  people you'd share the site with.
- No Worker yet? Everything still works — tags just stay on each device until you
  finish the setup.

## 6. AI tagging (optional, free)

`ai_tag.py` sends photos SPYPOINT left as a generic "Animal" to the free tier of the
Gemini API and saves the answers in `ai-tags.json`. Your tags and SPYPOINT's specific
labels always win, and answers under 70% confidence stay in **Review**. On the free
tier, Google may use these images to improve its products.

1. Create a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Add `GEMINI_API_KEY=your-key` to `.env` next to `pull.py` (it's gitignored).
3. Run `python ai_tag.py --check`, then `python ai_tag.py --eval 10`.
4. If the results look right, add `GEMINI_API_KEY` as a repository secret. Each run
   then tags up to 15 waiting photos until the backlog is done.

Set `AI_MODEL` or `AI_MAX_PER_RUN` to change the model or batch size. Your model's
daily limit is shown in AI Studio, and leftovers wait for the next run.

## 7. Photo storage and uploads (Cloudflare R2)

Photos can live in a free Cloudflare R2 bucket in place of this repo. People with the
upload login can then add photos from the **Upload** button, and they're resized and
stripped of location data on the device before leaving it.

1. Create the bucket and turn on its public URL:
   ```
   npx wrangler r2 bucket create trailhub-photos
   npx wrangler r2 bucket dev-url enable trailhub-photos
   ```
2. Put that URL in `R2_PUBLIC_BASE_URL` in `wrangler.toml`.
3. Set the upload password, then deploy. The username is `UPLOAD_USER` in the same
   file, `valecrew` by default.
   ```
   npx wrangler secret put UPLOAD_PASSWORD
   npx wrangler deploy
   ```
4. In the dashboard, create an R2 API token with **Object Read & Write** on this
   bucket. Add these repository secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (`trailhub-photos`) and `R2_PUBLIC_BASE_URL`.

Writes stop at 7 GB, 70% of the 10 GB free tier, both for the camera pipeline and for
uploads. If usage can't be checked, writes pause too. New camera photos then stay in
this repo until there's room, and the run shows an **R2 uploads paused** warning.
Only the upload login and the `R2_*` keys can write to the bucket.

Videos (MP4, MOV or WebM, up to 80 MB) are stored as recorded, so they keep any
location data the phone added. Some iPhone videos only play in Safari. Comments on
photos and videos are public to read and need the upload login to post or remove.

The next runs move existing photos to R2 and remove them from the repo. Older copies
stay in git history until that history is rewritten.

## Useful flags

```
python pull.py --limit 200    # pull more photos per camera (default 100)
python pull.py --rebuild      # rebuild data.js from the local store (no network)
python pull.py --ocr-temps    # read °F off existing photos' overlays, then rebuild
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
- Anything you publish to the static site is public to anyone with the URL. Camera
  coordinates are rounded to about 1 km for that reason, but the photos themselves
  and this repo's history are public.
- Weather comes from [Open-Meteo](https://open-meteo.com/) (free, no key) for the
  whole property, not each camera. A `~` before a temperature means it's from that
  data because the photo's info bar couldn't be read.
