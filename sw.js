// Vale Trails — service worker.
// Makes the site installable and lets it open with no signal: the app shell and
// the last data.js are kept in a cache and used when the network fails.
//
// Strategy: network first, cache as fallback, for same-origin GET requests only.
// Always trying the network first means a deploy is picked up on the next load
// and the app's modules can never be served from two different versions. Photos
// (R2), map tiles and fonts are other origins and are left to the browser cache.
const VERSION = "vale-trails-v4";
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
  "./app/shell.js",
  "./app/ui.js",
  "./app/icons.js",
  "./app/upload.js",
  "./app/exif.js",
  "./app/comments.js",
  "./app/account.js",
  "./app/alerts.js",
  "./app/views/overview.js",
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
    for (const name of await caches.keys()) if (name !== VERSION) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
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
  event.waitUntil(self.registration.showNotification(msg.title || "Vale Trails", {
    body: msg.body || "",
    tag: msg.tag || undefined,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: msg.url || "./" },
  }));
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
