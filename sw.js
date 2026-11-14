// Vale Trails — service worker.
// Makes the site installable and lets it open with no signal: the app shell and
// the last data.js are kept in a cache and used when the network fails.
//
// Strategy: network first, cache as fallback, for same-origin GET requests only.
// Always trying the network first means a deploy is picked up on the next load
// and the app's modules can never be served from two different versions. Photos
// (R2), map tiles and fonts are other origins and are left to the browser cache.
const VERSION = "vale-trails-v1";
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
      const res = await fetch(request);
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
