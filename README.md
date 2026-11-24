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
- `spypoint_api.py` — TrailHub's own SPYPOINT client (logins, cameras, photos, camera health)
- `requirements.txt` — optional extras (R2 hosting, photo resizing, temperature OCR)
- `config.js` — site config (optional tag-sharing endpoint; safe to commit, no secrets)
- `tags.json` — your photo tags/reclassifications (shared source of truth, baked into `data.js`)
- `tag-worker.js` — optional Cloudflare Worker that saves tags for everyone (see "Shared tags")

The site has nine pages: **Home** (the deer forecast, camera status and the
latest photos), **DeerCast** (a 7-day deer movement forecast), **Photos** (everything from the cameras, grouped by day), **Uploads**
(photos and videos people added), **Bucks** (a history for each
deer you name), **Patterns** (when animals move, including by weather), **Map**, and
**Identify** (put a name to untagged photos). Filters carry across Photos, Patterns
and Map, so you can ask "when does this buck move at this camera?" The filter bar
has a date range (last 7, 14 or 30 days, this season, or any two dates), and every
bar on the Patterns and Home charts is a link: tap an hour, a weekday, a camera or a
calendar day to see exactly those photos.

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

**First, validate locally (do not skip).** SPYPOINT has no public API, so confirm
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

### Reliable 5-minute updates

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

`wrangler.toml` already declares the 5-minute Cron Trigger. If a photo can't be
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
- **Reading is public, writing needs the family login.** Tags, camera names, notes,
  favorites, comments and uploads all go through the same username and password
  (section 7). Anyone can still browse. Someone who isn't signed in can still tag
  and take notes, but those edits stay on their device and a toast says so with a
  **Sign in** button; the moment they sign in, everything saved on that device is
  shared for everyone. Sign in from the person icon in the top bar.
- **Staying signed in.** Signing in keeps you signed in on that device for 30 days (or
  until you choose **Sign out** from your name in the top bar). The device keeps a
  signed session token, never the password. Changing `UPLOAD_PASSWORD` signs every
  device out, unless you set a separate `SESSION_SECRET`.
- **Personal accounts.** People can ask for their own login with **Create an account**
  in the sign-in box. The request waits until an admin approves it under
  **your name → Manage accounts**; the shared login is always an admin and can make
  others admins. This needs the `ACCOUNTS` KV namespace in `wrangler.toml` (already
  set up; to make a new one, run `npx wrangler kv namespace create ACCOUNTS`, put its
  id in the `[[kv_namespaces]]` block and redeploy). Each new sign-up also sends a
  push alert (section 9) to every admin's phone that has alerts turned on.
- **Face ID.** On a phone or Mac that supports passkeys, the sign-in box has **Sign in with
  Face ID**, and **Create an account** can use Face ID with no password. Anyone signed in
  turns it on for their device from **their name → Face ID**, which also lists and removes
  the devices that can sign in. The Worker keeps only each device's public key (in the
  `ACCOUNTS` namespace), and passkeys belong to the site's address: if the site moves, set
  `SITE_ORIGIN` (e.g. `https://example.com`) in `wrangler.toml` and everyone sets Face ID
  up again. Removing an account removes its Face ID sign-ins too.
- Sign-in attempts are **rate limited per IP** (5 a minute on the login route, 20 every
  10 seconds on other writes) by the two Rate Limiting bindings in `wrangler.toml`.
  Use a long passphrase anyway: the limit slows a guesser down, it doesn't stop one.
- No Worker yet? Everything still works — tags just stay on each device until you
  finish the setup.
- After changing `tag-worker.js` or `wrangler.toml`, redeploy with `npx wrangler deploy`.

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

The upload form reads the real capture time from inside each file (EXIF for photos,
the movie header for videos) and shows it next to a preview so it can be corrected
before sending; the file's own modified time is only the fallback. You can drop files
onto the form, name a buck as you upload, and watch each file's progress. Uploads
filed under a real camera (an SD-card pull) count in Patterns and the camera's stats;
"Phone or other camera" uploads stay in the Uploads tab. Anyone signed in can open an
upload and change its camera or date, or delete it, from the full view.

**Small copies.** Photo grids load a ~400px copy of each photo (`<id>_t.jpg`) instead
of the full one, which is most of the difference on a phone. The browser makes the
copy for uploads; `pull.py` makes it for camera photos with Pillow and gives older
photos theirs 150 per run (or all at once with `python pull.py --thumbs`). A photo
with no copy yet simply loads the full image.

The next runs move existing photos to R2 and remove them from the repo. Older copies
stay in git history until that history is rewritten.

## 8. Sharing photos and photos without signal

The **Share** button in the photo view opens the phone's share
sheet. Out of the box it shares a link to the photo, which Messages shows as the
picture. Letting the site download photos from the bucket turns on two more things:
**Share** sends the photo file itself (so **Save to Photos** works), and phones keep
the photos they've opened plus the last two days' small copies, so recent photos
still show at camp or in the stand with no signal. Run this once:

```
npx wrangler r2 bucket cors set trailhub-photos --file r2-cors.json
```

`r2-cors.json` allows only this site's address. Change it if the site moves.

## 9. Push alerts

Each person can get a phone notification when a new photo shows the animals they
care about, on the lock screen, with the app closed. They choose in the app:
**More → Alerts** (or their name → **Alerts**), tick species such as Buck or Turkey,
tap **Turn on alerts** and allow notifications. Choices are per phone and can be
changed or turned off there any time. Tapping an alert opens that photo.

On iPhone this works from the Home Screen app (iOS 16.4 or newer): in Safari tap
**Share → Add to Home Screen**, open Vale Trails from the Home Screen, then turn on
alerts. Android phones and desktop Chrome, Edge and Firefox work from the browser too.
Turning on alerts needs a sign-in. Each phone can also limit alerts to some cameras and
set quiet hours (no alerts between two times, in the phone's time zone); sightings in
quiet hours are skipped, not saved for later.

How it works: after each publish, `push_alerts.py` (in the workflow) finds photos
from the last 48 hours whose animal is new since the previous publish, counting a
burst of frames as one sighting. It sends that list to the Worker, which sends a
standard Web Push to every phone that chose those species. "Animal" (not yet
identified) and "Empty" never alert, and more than three sightings at once become
one summary.

One-time setup (uses the same KV namespace as personal accounts, section 5):

1. Create the KV namespace if you haven't: `npx wrangler kv namespace create ACCOUNTS`,
   then uncomment the `[[kv_namespaces]]` block in `wrangler.toml` with its id.
2. Make the signing keys: `node make-vapid-keys.mjs`. Put the public key in
   `wrangler.toml` as `VAPID_PUBLIC_KEY`, and store the private key with
   `npx wrangler secret put VAPID_PRIVATE_KEY`.
3. Make up a long random password for the workflow to use with the Worker, and store
   it in both places: `npx wrangler secret put PUSH_SECRET`, and a GitHub repository
   secret named `PUSH_SECRET` with the same value.
4. Deploy: `npx wrangler deploy`.

Preview what would alert, without sending: `python push_alerts.py --before HEAD~50 --dry-run`.

## 10. Install it like an app

The site is a Progressive Web App: `manifest.webmanifest` names it and gives it icons,
and `sw.js` is a small service worker that keeps the app files and the latest
`data.js` in the browser's cache. On a phone, **Share → Add to Home Screen** (iOS) or
**Install app** (Android/Chrome) puts a Vale Trails icon on the home screen that opens
full-screen without the browser bar. Opening it with no signal still shows the last
photo list it saw (and recent photos, see section 8); map tiles need a connection.

People who open the site in Safari on an iPhone see a small "Get the Vale Trails
app" note with the two taps to install it (Android Chrome gets an **Install**
button). "Not now" hides it for 30 days. The installed app starts on a dark launch
screen with the logo (`icons/splash`, one image per iPhone size) instead of a white
flash, and with alerts on (section 9) its icon shows how many alerts came in since
it was last opened.

The worker always tries the network first and only uses its cache when that fails,
so a new deploy shows up on the next open and the app never mixes old and new files.
There's nothing to maintain; the icons live in `icons/`.

## Useful flags

```
python pull.py --limit 200    # pull more photos per camera (default 100)
python pull.py --rebuild      # rebuild data.js from the local store (no network)
python pull.py --ocr-temps    # read °F off existing photos' overlays, then rebuild
python pull.py --thumbs       # make the small grid copy for every photo missing one
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

SPYPOINT has no public API: `spypoint_api.py` uses the same endpoints as their
app, so SPYPOINT can change things without notice. Every request has a timeout and
gentle retries, and a failed run says whether the login, the connection or the API
is at fault. If species labels, dates, or camera names come through wrong, run:

```
python pull.py --inspect
```

That prints the actual fields SPYPOINT returns. Share that output and the field
mapping in `pull.py` (the `extract_meta` function) can be adjusted to match —
nothing else needs to change.

Camera health (battery, signal, SD card, plan usage) comes from
`camera_health()` in `spypoint_api.py`. If a run logs `[health] nothing recognised`,
that line lists the field names SPYPOINT sent, so the extractor can be matched to them.

### Notes & limits

- **Buck vs Doe** comes from SPYPOINT's own Buck Tracker tags. Untagged photos
  show up as "Animal" — but you can classify them yourself with **Tags** (see
  "Tag and reclassify photos"), including more than one tag per photo.
- The free SPYPOINT plan transmits a limited number of photos per month, so this
  is meant for modest volumes.
- Anything you publish to the static site is public to anyone with the URL. Camera
  coordinates are rounded to about 1 km for that reason, but the photos themselves
  and this repo's history are public.
- **Map pins**: `data.js` holds camera positions rounded to about 1 km. Exact spots are
  set with **Move pins** on the Map page and kept only in the Worker's private ACCOUNTS
  store (`/pins`), for signed-in people.
- **Stands** added on DeerCast's Live wind map (`/stands` on the Worker) are kept in the
  private ACCOUNTS store. People edit their own; admins edit any.
- **Property lines** on the Map page are North Carolina's public tax parcels from
  [NC OneMap](https://www.nconemap.gov/) (free, no key). They're approximate, not a survey.
- **Harvests** (`/harvests` on the Worker) are kept in the private ACCOUNTS store. People
  edit their own; admins edit any.
- **DeerCast** is a starting estimate, not a tested prediction: time of day and the rut
  count most and weather only nudges the score (`app/deercast.js`). The forecast is
  refreshed every 3 hours by `pull.py` into `forecast.json`, and the app also gets the
  newest one from Open-Meteo when it opens or is refreshed. Wind notes come from
  `stands.json`, kept only in private storage (`state/stands.json`), in this form:
  `{"<camera name>": {"good": ["W"], "risky": ["N"], "avoid": ["E"]}}`.
- Once a day `deercast_log.mjs` saves that day's forecast for the days ahead to
  `deercast-log.json` (private storage) and never changes it, so forecasts can be
  checked later against what the cameras saw. Nothing on the site reads it yet.
- DeerCast's wind is Open-Meteo's own pick for 12 hours and NOAA's National Blend after
  that; when those and the European model differ by over 45° it says "uncertain". "Right
  now" is the Lincolnton or Hickory airport's reading from the National Weather Service.
- Weather comes from [Open-Meteo](https://open-meteo.com/) (free, no key) for the
  whole property, not each camera. A `~` before a temperature means it's from that
  data because the photo's info bar couldn't be read.
