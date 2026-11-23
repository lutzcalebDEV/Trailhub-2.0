// Vale Trails — service worker.
// Makes the site installable and lets it open with no signal: the app shell is
// kept in a cache and used when the network fails. (The photo list is private and
// comes from the Worker; the app keeps its own copy of it, see core.js.)
//
// Strategy: network first, cache as fallback, for same-origin GET requests only.
// Always trying the network first means a deploy is picked up on the next load
// and the app's modules can never be served from two different versions. Map
// tiles and fonts are other origins and are left to the browser cache.
const VERSION = "vale-trails-v8";
// Kept across app updates (only "vale-trails-v*" caches are replaced on update).
const PHOTO_CACHE = "vale-photos";
const STATE_CACHE = "vale-state";
const SHELL = [
  "./",
  "./index.html",
  "./config.js",
  "./manifest.webmanifest",
  "./app/styles.css",
  "./app/main.js",
  "./app/react.js",
  "./app/core.js",
  "./app/analytics.js",
  "./app/deercast.js",
  "./app/shell.js",
  "./app/ui.js",
  "./app/icons.js",
  "./app/upload.js",
  "./app/exif.js",
  "./app/comments.js",
  "./app/account.js",
  "./app/alerts.js",
  "./app/install.js",
  "./app/login.js",
  "./app/faceid.js",
  "./app/views/overview.js",
  "./app/views/deercast.js",
  "./app/views/windmap.js",
  "./app/views/gallery.js",
  "./app/views/uploads.js",
  "./app/views/bucks.js",
  "./app/views/insights.js",
  "./app/views/mapview.js",
  "./app/views/review.js",
  "./vendor/react.production.min.js",
  "./vendor/react-dom.production.min.js",
  "./vendor/htm.umd.js",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/badge-96.png",
];

// Cache keys drop the query string, so "data.js?t=123" is stored as plain data.js.
const keyFor = (request) => {
  const url = new URL(request.url);
  url.search = "";
  return url.href;
};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One missing file shouldn't block installing: fetch each on its own.
    await Promise.allSettled(SHELL.map(async (path) => {
      const res = await fetch(path, { cache: "no-cache" });
      if (res.ok) await cache.put(keyFor(new Request(path)), res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("vale-trails-") && name !== VERSION) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isPhoto(url)) { event.respondWith(photo(request)); return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = keyFor(request);
    try {
      // GitHub Pages lets browsers reuse files for 10 minutes, which would keep an
      // old stylesheet after a deploy. "no-cache" asks the server every time (a tiny
      // "not modified" reply when nothing changed). A page navigation can't take
      // options on its Request, so it's fetched by URL.
      const res = request.mode === "navigate"
        ? await fetch(request.url, { cache: "no-cache", credentials: "same-origin" })
        : await fetch(new Request(request, { cache: "no-cache" }));
      if (res.ok && (res.type === "basic" || res.type === "default")) {
        cache.put(key, res.clone()).catch(() => {});
      }
      return res;
    } catch (e) {
      const hit = await cache.match(key);
      if (hit) return hit;
      // Opening the app offline: any page request falls back to the shell.
      if (request.mode === "navigate") {
        const shell = await cache.match(keyFor(new Request("./index.html")));
        if (shell) return shell;
      }
      throw e;
    }
  })());
});

// Push alerts (see push_alerts.py and the Worker's /push routes). These arrive and
// show on the lock screen even when the app is closed.
self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) { msg = { title: "Vale Trails", body: event.data && event.data.text() }; }
  event.waitUntil(Promise.all([bumpBadge().catch(() => {}), self.registration.showNotification(msg.title || "Vale Trails", {
    body: msg.body || "",
    tag: msg.tag || undefined,
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    data: { url: msg.url || "./" },
  })]));
});

// Tapping an alert opens that photo: in the app if it's already open, else fresh.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === new URL(target).origin && "focus" in w) {
        await w.focus();
        if ("navigate" in w) return w.navigate(target);
        return;
      }
    }
    return self.clients.openWindow(target);
  })());
});

/* --------------------------- Photos without signal --------------------------
   Photos are kept on the phone as they're seen, plus the small copies from the
   last two days (the app asks for those), so recent photos still show at camp or in
   the stand. A photo never changes once taken, so a kept copy is used as is.
   Photos come from the Worker's /media/ with a photo pass (?m=) that changes
   every week; a kept copy is filed without the pass, so it stays found. Signing
   out deletes them all (forgetPrivateData in core.js). Videos aren't touched.
   Whether photos can be kept is checked once a day with a separate URL, so the
   check can never get in the way of a photo on screen. */
const PHOTO_MAX = 600;
const isPhoto = (url) => /\.workers\.dev$/.test(url.hostname) && url.pathname.startsWith("/media/") &&
  /\.(jpe?g|png|webp)$/i.test(url.pathname);
// The address a photo is kept under: without its pass. Anything else in the
// address (like ?share-check) means "don't keep" (null).
const photoKey = (href) => {
  const url = new URL(href);
  url.searchParams.delete("m");
  if (url.search) return null;
  return url.href;
};

async function readState(key) {
  const hit = await (await caches.open(STATE_CACHE)).match("/state/" + key);
  return hit ? hit.json() : null;
}
async function writeState(key, value) {
  await (await caches.open(STATE_CACHE)).put("/state/" + key, new Response(JSON.stringify(value)));
}

let corsCheck = null;
let corsKnown = null; // the answer once known, so a photo never waits on the check
function photosAllowed(sampleUrl) {
  if (!corsCheck) {
    corsCheck = (async () => {
      const saved = await readState("photo-cors");
      if (saved && Date.now() - saved.at < 86400000) return (corsKnown = saved.ok);
      let ok = false;
      const probe = new URL(sampleUrl);
      probe.searchParams.set("offline-check", String(Date.now()));
      try { ok = (await fetch(probe.href, { mode: "cors", cache: "no-store" })).ok; } catch (e) {}
      await writeState("photo-cors", { ok, at: Date.now() });
      return (corsKnown = ok);
    })();
  }
  return corsCheck;
}

let puts = 0;
async function keep(cache, url, res) {
  await cache.put(url, res);
  if (++puts % 25) return;
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - PHOTO_MAX))) await cache.delete(k);
}

async function photo(request) {
  const key = photoKey(request.url);
  if (!key) return fetch(request); // checks like ?share-check: never kept
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  // Until the check has an answer, load the photo as before and let the check run
  // alongside; the photos after it use the answer.
  if (corsKnown === null) {
    const saved = await readState("photo-cors");
    if (saved && Date.now() - saved.at < 86400000) corsKnown = saved.ok;
    else { photosAllowed(request.url).catch(() => {}); return fetch(request); }
  }
  if (corsKnown) {
    try {
      const res = await fetch(request.url, { mode: "cors", credentials: "omit" });
      if (res.ok) keep(cache, key, res.clone()).catch(() => {});
      return res;
    } catch (e) { /* offline or refused: fall through */ }
  }
  return fetch(request);
}

// The app sends the photos worth having offline (recent small copies).
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type !== "keep-photos" || !Array.isArray(msg.urls) || !msg.urls.length) return;
  event.waitUntil((async () => {
    if (!(await photosAllowed(msg.urls[0]))) return;
    const cache = await caches.open(PHOTO_CACHE);
    for (const u of msg.urls.slice(0, 200)) {
      const key = photoKey(u);
      if (!key || (await cache.match(key))) continue;
      try {
        const res = await fetch(u, { mode: "cors", credentials: "omit" });
        if (res.ok) await keep(cache, key, res);
      } catch (e) { return; } // offline: try again next time
    }
  })());
});

/* ------------------------------ Icon badge ----------------------------------
   The number on the Home Screen icon: alerts since the app was last opened.
   The app clears it when it opens (iOS 16.4+ with notifications allowed). */
async function bumpBadge() {
  const n = ((await readState("badge")) || 0) + 1;
  await writeState("badge", n);
  if (self.navigator.setAppBadge) await self.navigator.setAppBadge(n).catch(() => {});
}
self.addEventListener("message", (event) => {
  if ((event.data || {}).type === "clear-badge") event.waitUntil(writeState("badge", 0));
});
