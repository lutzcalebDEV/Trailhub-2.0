// Vale Trails — core domain logic.
// Data model, species taxonomy, persistence, shared-tag sync and React hooks.
// This preserves the original TrailHub data contract and localStorage keys so a
// returning visitor keeps their theme, tags, archives and review progress.
import { useState, useEffect, useRef, useCallback, useMemo } from "./react.js";

/* ----------------------------- Species ---------------------------------- */
// Recognized species and their accent color (CSS custom properties from styles.css).
export const SPECIES = {
  Deer:     "var(--sp-deer)",
  Buck:     "var(--sp-buck)",
  Doe:      "var(--sp-doe)",
  Raccoon:  "var(--sp-raccoon)",
  Squirrel: "var(--sp-squirrel)",
  Fox:      "var(--sp-fox)",
  Coyote:   "var(--sp-coyote)",
  Turkey:   "var(--sp-turkey)",
  Opossum:  "var(--sp-opossum)",
  Bear:     "var(--sp-other)",
  Bobcat:   "var(--sp-other)",
  Rabbit:   "var(--sp-other)",
  Bird:     "var(--sp-other)",
  Person:   "var(--sp-person)",
  Vehicle:  "var(--sp-other)",
  Empty:    "var(--sp-other)",
};
export const SPECIES_ORDER = Object.keys(SPECIES);
export const TAG_OPTIONS = [...SPECIES_ORDER, "Animal"];
export const speciesColor = (s) => SPECIES[s] || "var(--sp-other)";
export const isKnownSpecies = (s) => Object.prototype.hasOwnProperty.call(SPECIES, s);

/* "Needs review" = AI couldn't confidently identify it: either the label isn't a
   recognized species (generic "Animal"/"Unknown") or confidence is below threshold. */
export const NEEDS_CONF = 0.7;
export const reviewReason = (c) => {
  if (!isKnownSpecies(c.species)) return "Needs ID";
  if (c.confidence != null && c.confidence < NEEDS_CONF)
    return `Low confidence · ${Math.round(c.confidence * 100)}%`;
  return null;
};

/* ----------------------------- Tag helpers ------------------------------ */
export const cleanTags = (arr) =>
  [...new Set((arr || []).map((t) => String(t).trim()).filter(Boolean))];

// A capture's tags are the source of truth; fall back to the legacy single species.
export const baseTagsOf = (c) =>
  Array.isArray(c.tags) && c.tags.length ? c.tags : [c.species || "Animal"];

// Effective tags = user/shared override (if any) else the capture's own tags.
export const effectiveTags = (c, overrides) => {
  const ov = overrides && overrides[String(c.id)];
  if (ov && ov.length) return ov;
  return baseTagsOf(c);
};
export const effectiveSpecies = (c, overrides) =>
  effectiveTags(c, overrides)[0] || "Animal";

/* ------------------------------- Moon ----------------------------------- */
const MOONS = [
  "New", "Waxing crescent", "First quarter", "Waxing gibbous",
  "Full", "Waning gibbous", "Last quarter", "Waning crescent",
];
export function moonFromDate(date) {
  const synodic = 2551443; // seconds in a synodic month
  const knownNewMoon = Date.UTC(1970, 0, 7, 20, 35, 0) / 1000;
  const phase = ((date.getTime() / 1000 - knownNewMoon) % synodic + synodic) % synodic;
  const bucket = Math.floor((phase / synodic) * 8 + 0.5) % 8;
  return MOONS[bucket] || null;
}

/* ----------------------------- Formatting ------------------------------- */
export const fmtTime = (d) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const fmtDate = (d) =>
  d.toLocaleDateString([], { month: "short", day: "numeric" });
export const fmtDateLong = (d) =>
  d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
export const fmtDateTime = (d) => `${fmtDateLong(d)} · ${fmtTime(d)}`;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const isoDay = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
export const labelHour = (h) => {
  const ap = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ap}`;
};

export function timeAgo(d, now = Date.now()) {
  const s = Math.max(0, (now - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const days = h / 24;
  if (days < 7) return `${Math.floor(days)}d ago`;
  return fmtDate(d);
}

/* ----------------------------- Data loading ----------------------------- */
function normalizePayload(d) {
  const captures = (d.captures || [])
    .map((c, i) => {
      const date = new Date(c.date);
      if (isNaN(date.getTime())) return null;
      const baseTags = Array.isArray(c.tags) && c.tags.length ? cleanTags(c.tags) : null;
      const species = (baseTags && baseTags[0]) || c.species || "Animal";
      return {
        id: c.id != null ? c.id : i,
        species,
        tags: baseTags || [species],
        camera: c.camera || "Camera",
        date,
        image: mediaUrl(c.image),
        thumb: mediaUrl(c.thumb),
        isNight: !!c.isNight,
        confidence: c.confidence == null ? null : c.confidence,
        aiTagged: !!c.aiTagged,
        tempEstimated: !!c.tempEstimated,
        media: c.media === "video" ? "video" : "photo",
        uploadedBySite: !!c.uploadedBySite,
        uploadedBy: c.uploadedBy || null,
        weather: c.weather || null,
        temp: c.temp == null ? null : c.temp,
        moon: c.moon || moonFromDate(date),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date);

  const cameras = (d.cameras || []).map((cam, i) => {
    const lat = cam.latitude == null ? null : Number(cam.latitude);
    const lng = cam.longitude == null ? null : Number(cam.longitude);
    return {
      id: cam.id != null ? String(cam.id) : `camera-${i}`,
      name: cam.name || `Camera ${i + 1}`,
      label: cam.label || null,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
      // Battery, signal, SD card and plan use as SPYPOINT last reported them (pull.py).
      health: cam.health && typeof cam.health === "object" ? cam.health : null,
    };
  });

  return {
    captures,
    cameras,
    demo: !!d.demo,
    generatedAt: parseUtc(d.generatedAt),
    weatherHours: d.weatherHours || null,
    forecast: d.forecast || null, // DeerCast (deercast.js)
    stands: d.stands || {},
  };
}

// Older data.js files hold a bare UTC timestamp, which Date would read as local time.
function parseUtc(value) {
  if (!value) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasZone ? value : value + "Z");
  return isNaN(date.getTime()) ? null : date;
}

function parseDataScript(text) {
  const m = text.match(/window\.TRAILHUB_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) throw new Error("Unable to parse data.js payload");
  return JSON.parse(m[1]);
}

/* ------------------------- Signed-in reads only ------------------------- */
// Nothing is public: the photo list, the edits and every photo come from the
// Worker, which answers only signed-in people (tag-worker.js, "Private storage").
// The app sets who's signed in here (setApiAuth) and every read below uses it.
let apiAuth = null;
export function setApiAuth(auth) {
  if ((auth && auth.user) !== (apiAuth && apiAuth.user)) mediaPass = null;
  apiAuth = auth && auth.token ? auth : null;
}
async function apiGet(path) {
  if (!TAGS_API || !apiAuth) throw new NotSignedIn("Sign in");
  const r = await fetch(TAGS_API + path, { headers: { Authorization: authHeader(apiAuth) }, cache: "no-store" });
  if (r.status === 401) throw new NotSignedIn("Sign in");
  if (!r.ok) throw new Error(`${path} failed (${r.status})`);
  return r;
}
const getJSON = async (path) => (await apiGet(path)).json();

// Photos: an <img> can't send a sign-in header, so each photo address carries a
// photo pass (a read-only key that lasts a week). It's fetched once per sign-in
// and renewed a day before it runs out. Photos stored in R2 have their old public
// address in data.js; that's mapped to the Worker's private one.
const MEDIA_KEY = "trailhub-media-pass";
let mediaPass = null;
export async function ensureMediaPass() {
  const fresh = (p) => p && p.user === (apiAuth && apiAuth.user) && p.exp - Date.now() > 86400000;
  if (fresh(mediaPass)) return mediaPass;
  try { const saved = JSON.parse(localStorage.getItem(MEDIA_KEY) || "null"); if (fresh(saved)) return (mediaPass = saved); } catch (e) {}
  const r = await getJSON("/media-token");
  mediaPass = { token: r.token, exp: r.exp, user: apiAuth.user };
  try { localStorage.setItem(MEDIA_KEY, JSON.stringify(mediaPass)); } catch (e) {}
  return mediaPass;
}
const R2_ADDRESS = /^https:\/\/pub-[0-9a-f]+\.r2\.dev\/(.+)$/;
export function mediaUrl(url) {
  const m = R2_ADDRESS.exec(url || "");
  if (!m || !TAGS_API) return url || "";
  return `${TAGS_API}/media/${m[1]}?m=${encodeURIComponent(mediaPass ? mediaPass.token : "")}`;
}

// The last photo list is kept on this device, so the app opens at once (and with
// no signal) before the fresh copy arrives. Signing out deletes it, and the
// photos kept for offline use (forgetPrivateData).
const DATA_CACHE = "vale-state";
const DATA_KEY = "/state/data";
async function rememberData(text) {
  try { await (await caches.open(DATA_CACHE)).put(DATA_KEY, new Response(text)); } catch (e) {}
}
export async function loadCachedData() {
  try {
    const hit = await (await caches.open(DATA_CACHE)).match(DATA_KEY);
    if (!hit || !apiAuth) return null;
    await ensureMediaPass().catch(() => {});
    return normalizePayload(parseDataScript(await hit.text()));
  } catch (e) { return null; }
}
export async function forgetPrivateData() {
  mediaPass = null;
  try { localStorage.removeItem(MEDIA_KEY); } catch (e) {}
  try {
    const kept = await caches.open(DATA_CACHE);
    await Promise.all([kept.delete(DATA_KEY), kept.delete(PINS_KEY), kept.delete(HARVESTS_KEY)]);
    await caches.delete("vale-photos");
  } catch (e) {}
}

// Exact camera spots set on the Map page: { camera: [lat, lng] }. They're kept apart
// from the photo list, which only has rounded positions. Null means the Worker can't
// save pins (an older one answers with something else).
const PINS_KEY = "/state/pins";
function cleanPins(raw) {
  if (!raw || !raw.pins || typeof raw.pins !== "object" || Array.isArray(raw.pins)) return null;
  return Object.fromEntries(Object.entries(raw.pins).filter(([, v]) =>
    Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)));
}
const keepPins = async (pins) => {
  try { await (await caches.open(DATA_CACHE)).put(PINS_KEY, new Response(JSON.stringify({ pins }))); } catch (e) {}
};
async function fetchPins() {
  const pins = cleanPins(await getJSON("/pins"));
  if (pins) keepPins(pins);
  return pins;
}
async function cachedPins() {
  try {
    const hit = await (await caches.open(DATA_CACHE)).match(PINS_KEY);
    return hit && apiAuth ? cleanPins(await hit.json()) : null;
  } catch (e) { return null; }
}
export async function remoteSavePins(changes, auth) {
  const pins = cleanPins(await postJSON(TAGS_API + "/pins", { pins: changes }, auth));
  if (!pins) throw new Error("Pins weren't saved");
  keepPins(pins);
  return pins;
}

// Harvests (views/harvest.js). The copy kept on this device shows with no signal.
const HARVESTS_KEY = "/state/harvests";
const harvestList = (raw) => (raw && Array.isArray(raw.harvests) ? raw.harvests.filter((h) => h && h.id && h.date && h.time) : null);
export async function fetchHarvests() {
  const list = harvestList(await getJSON("/harvests"));
  if (!list) throw new Error("Harvests aren't available");
  try { await (await caches.open(DATA_CACHE)).put(HARVESTS_KEY, new Response(JSON.stringify({ harvests: list }))); } catch (e) {}
  return list;
}
export async function cachedHarvests() {
  try {
    const hit = await (await caches.open(DATA_CACHE)).match(HARVESTS_KEY);
    return (hit && apiAuth && harvestList(await hit.json())) || [];
  } catch (e) { return []; }
}
// An uploaded photo's private address, before the photo list includes it.
export const uploadImageUrl = (id) =>
  `${TAGS_API}/media/${encodeURIComponent(id)}.jpg?m=${encodeURIComponent(mediaPass ? mediaPass.token : "")}`;
export async function postHarvest(body, auth) {
  const r = await postJSON(TAGS_API + "/harvests", body, auth);
  if (body.remove ? r.removed !== body.remove : !(r.harvest && r.harvest.id)) throw new Error("Not saved");
  return r;
}

export async function fetchLatestData() {
  const [res] = await Promise.all([apiGet("/data"), ensureMediaPass()]);
  const text = await res.text();
  const data = normalizePayload(parseDataScript(text));
  rememberData(text);
  return data;
}

// The newest weather forecast for DeerCast, straight from the weather service, in the
// form pull.py saves it. Only the rounded property point is sent. Resolves to null if
// it can't be had; the copy in the photo list is used then.
const FORECAST_VARS = ["temperature_2m", "precipitation", "pressure_msl", "wind_speed_10m",
  "wind_direction_10m", "wind_gusts_10m", "precipitation_probability"];
async function fetchForecast(data) {
  const cam = (data.cameras || []).find((c) => c.latitude != null && c.longitude != null);
  const at = data.forecast || (cam && { lat: cam.latitude, lng: cam.longitude });
  if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return null;
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast"
      + `?latitude=${at.lat.toFixed(2)}&longitude=${at.lng.toFixed(2)}&hourly=${FORECAST_VARS.join(",")}`
      + "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&past_days=7&forecast_days=9",
      { cache: "no-store", referrerPolicy: "no-referrer", credentials: "omit", signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const { hourly } = await r.json();
    const hours = hourly.time.map((_, i) => FORECAST_VARS.map((v) => (hourly[v][i] == null ? "" : hourly[v][i])).join("|"));
    if (!hours.length) return null;
    return { fetchedAt: new Date().toISOString(), lat: at.lat, lng: at.lng, start: hourly.time[0] + "Z", hours };
  } catch (e) { return null; }
}

export function loadInitialData() {
  return normalizePayload({});
}

/* ------------------------------ Shared edits ------------------------------ */
// window.TRAILHUB_TAGS_API (config.js) is the Worker: it serves everything and
// saves the family's edits for everyone.
const TAGS_API =
  typeof window !== "undefined" && window.TRAILHUB_TAGS_API
    ? String(window.TRAILHUB_TAGS_API).replace(/\/$/, "")
    : "";
const CAMERAS_API = TAGS_API ? TAGS_API + "/cameras" : "";
export const hasSharedTags = !!TAGS_API;

export function normalizeTagMap(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const [id, v] of Object.entries(raw)) {
      const arr = Array.isArray(v) ? v : v && Array.isArray(v.tags) ? v.tags : null;
      const clean = cleanTags(arr);
      if (clean.length) out[String(id)] = clean;
    }
  }
  return out;
}

export async function remoteLoadTags() {
  try { return normalizeTagMap(await getJSON("/")); } catch (e) { return null; }
}

// Every write to the Worker carries the family login. Without one, the Worker
// answers 401 and the edit stays on this device (see NotSignedIn).
export class NotSignedIn extends Error {}
export class TooManyAttempts extends Error {}

const basicAuth = ({ user, password }) => {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return "Basic " + btoa(String.fromCharCode(...bytes));
};
// A session token from /login when the Worker issues one; an older Worker only
// understands the password, which then stays in memory for this page load.
const authHeader = (auth) => (auth.token ? "Bearer " + auth.token : basicAuth(auth));

async function postJSON(url, body, auth) {
  if (!auth) throw new NotSignedIn("Sign in to save for everyone");
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(auth) },
    body: JSON.stringify(body),
  });
  if (r.status === 401) throw new NotSignedIn("Sign in to save for everyone");
  if (r.status === 429) throw new TooManyAttempts("Too many attempts");
  if (!r.ok) throw new Error("Save failed (" + r.status + ")");
  return r.json().catch(() => ({}));
}

export async function remoteSaveTags(id, tags, auth) {
  if (!TAGS_API) return { ok: false, reason: "no-endpoint" };
  await postJSON(TAGS_API, { id: String(id), tags }, auth);
  return { ok: true };
}

// Save many photos in one request (and one commit). `items` is {id: [tags]}.
export async function remoteSaveTagsBatch(items, auth) {
  if (!TAGS_API) return { ok: false, reason: "no-endpoint" };
  await postJSON(TAGS_API, { items }, auth);
  return { ok: true };
}

/* ---------------------------- Photo uploads ----------------------------- */
export const hasUploads = !!TAGS_API;
export class StorageFull extends Error {}

// Returns { status: "ok", auth } or { status: "denied" | "pending" | "limited" | "error" }.
// `auth` is { user, token, exp, admin }: the token is what's kept, never the password.
export async function uploadLogin(user, password) {
  try {
    const r = await fetch(TAGS_API + "/login", {
      method: "POST",
      headers: { Authorization: basicAuth({ user, password }) },
    });
    if (r.status === 401) return { status: "denied" };
    if (r.status === 403) return { status: "pending" };
    if (r.status === 429) return { status: "limited" };
    if (!r.ok) return { status: "error" };
    const body = await r.json().catch(() => ({}));
    if (!body.token) return { status: "ok", auth: { user, password, admin: false } };
    return { status: "ok", auth: { user: body.user || user, token: body.token, exp: body.exp, admin: !!body.admin } };
  } catch (e) {
    return { status: "error" };
  }
}

// Ask for an account. Returns { status: "ok" } or { status, error } where status is
// "invalid", "taken", "limited", "off" or "error".
// `website` is the sign-up form's hidden field: only a bot fills it in (tag-worker.js).
// Passwords: any characters, 8 to 256 of them, counted as characters (an emoji is
// one), the same rule the Worker uses. Returns a message, or "" when it's fine.
export function passwordProblem(pw, what = "password") {
  const n = [...String(pw || "")].length;
  if (!n) return `Enter a ${what}.`;
  if (n < 8) return `The ${what} is only ${n} character${n === 1 ? "" : "s"}. Use at least 8.`;
  if (n > 256) return `The ${what} is ${n} characters. Use at most 256.`;
  return "";
}

export async function registerAccount(user, password, website = "") {
  try {
    const r = await fetch(TAGS_API + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password, website }),
    });
    if (r.ok) return { status: "ok" };
    const body = await r.json().catch(() => ({}));
    const status = { 400: "invalid", 409: "taken", 429: "limited", 503: "off" }[r.status] || "error";
    return { status, error: body.error || "" };
  } catch (e) {
    return { status: "error" };
  }
}

// Admin only: the account list, and approve / remove / admin / unadmin.
export async function loadAccounts(auth) {
  if (!auth) throw new NotSignedIn("Sign in");
  const r = await fetch(TAGS_API + "/accounts", { headers: { Authorization: authHeader(auth) }, cache: "no-store" });
  if (r.status === 401) throw new NotSignedIn("Sign in");
  if (!r.ok) throw new Error("Couldn't load accounts (" + r.status + ")");
  return r.json();
}
export const accountAction = (auth, user, action, extra) => postJSON(TAGS_API + "/accounts", { user, action, ...extra }, auth);

// Who may edit or delete an upload: an admin, or the person who added it. Uploads
// from before names were recorded belong to the shared login, so admins only.
export const canEditUpload = (auth, capture) =>
  !!auth && (!!auth.admin || (!!capture.uploadedBy && capture.uploadedBy.toLowerCase() === String(auth.user || "").toLowerCase()));

/* ----------------------------- Push alerts ------------------------------ */
// { enabled, publicKey } from the Worker; enabled is false until it's set up.
export async function loadPushKey() {
  if (!TAGS_API) return { enabled: false };
  try {
    const r = await fetch(TAGS_API + "/push/key", { cache: "no-store" });
    return r.ok ? await r.json() : { enabled: false };
  } catch (e) {
    return { enabled: false, offline: true };
  }
}
// Save this phone's subscription with the species it wants (or remove it), and
// optionally which cameras ([] = all) and quiet hours ({ from, to, tz } or null).
export const savePushSubscription = (auth, subscription, species, cameras = [], quiet = null) =>
  postJSON(TAGS_API + "/push/subscribe", { subscription, species, cameras, quiet }, auth);

/* ------------------------------- Password -------------------------------- */
// Whether the signed-in account has a password ({ shared, hasPassword }): one made
// with Face ID may not, and the shared login's is set in the Worker, not here.
export async function loadPasswordInfo(auth) {
  if (!auth || !auth.token) throw new NotSignedIn("Sign in");
  const r = await fetch(TAGS_API + "/password", { headers: { Authorization: authHeader(auth) }, cache: "no-store" });
  if (r.status === 401) throw new NotSignedIn("Sign in");
  if (!r.ok) throw new Error("Couldn't load (" + r.status + ")");
  return r.json();
}
// Change it. Returns { status: "ok", auth } (a fresh session: the account's other
// devices are signed out), or "wrong" / "invalid" / "limited" / "signedout" / "error".
export async function changePassword(auth, current, password) {
  try {
    const r = await fetch(TAGS_API + "/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader(auth) },
      body: JSON.stringify({ current, password }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.token) {
      return { status: "ok", auth: { user: body.user, token: body.token, exp: body.exp, admin: !!body.admin } };
    }
    const status = { 401: "signedout", 403: "wrong", 400: "invalid", 429: "limited" }[r.status] || "error";
    return { status, error: body.error || "" };
  } catch (e) { return { status: "error" }; }
}

/* ------------------------------- Scrolling ------------------------------- */
// The page scrolls everywhere (styles.css, "Phone app frame" says why the fixed
// frame was dropped). These stay as the one place scrolling is read and set, so a
// scrolling box can come back without touching every caller.
export const scrollBox = () => null;
export const getScrollY = () => { const el = scrollBox(); return el ? el.scrollTop : window.scrollY; };
export const scrollToY = (top, smooth) => {
  const el = scrollBox();
  (el || window).scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
};

/* --------------------------- Face ID (passkeys) -------------------------- */
// Sign in with Face ID (Touch ID on a Mac) instead of a password. The phone keeps
// the key in its keychain; the Worker only ever sees the public half.
const toB64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64urlBytes = (s) => {
  const b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "===".slice((b.length + 3) % 4)), (c) => c.charCodeAt(0));
};
export const isAppleTouch = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// What the phone calls it, for button labels.
export const faceIdName = () => (isAppleTouch() ? "Face ID" : /Macintosh/.test(navigator.userAgent) ? "Touch ID" : "passkey");
const deviceLabel = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "Device";
};

// Whether this device can do it at all (an iPhone with Face ID or a passcode can).
export async function passkeyAvailable() {
  try {
    return !!TAGS_API && !!window.PublicKeyCredential &&
      (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}

async function passkeyPost(path, body, auth) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = authHeader(auth);
  const r = await fetch(TAGS_API + path, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
}

// The one-time challenge, fetched BEFORE the tap: iPhones only show Face ID
// straight from a tap, with no time to ask the server first. Good for ~3 minutes.
// Returns the ticket, or { error } (e.g. a taken username), or null when offline.
export async function getPasskeyTicket(purpose, { auth, user } = {}) {
  try {
    const r = await passkeyPost("/passkey/options", { purpose, user }, auth);
    if (r.status === 401) throw new NotSignedIn("Sign in");
    if (r.ok) return r.data;
    return { error: r.status === 429 ? "Too many tries. Wait a minute, then try again." : r.data.error || "That didn't work." };
  } catch (e) {
    if (e instanceof NotSignedIn) throw e;
    return null;
  }
}
export const passkeyTicketFresh = (t) => !!t && !t.error && t.expires > Date.now();

// Remember which accounts have Face ID on this device, so the app only offers to
// set it up where it isn't yet.
export function faceIdOn(user) {
  try { return (JSON.parse(localStorage.getItem(LS.faceIdUsers) || "[]")).includes(String(user).toLowerCase()); } catch (e) { return false; }
}
export function setFaceIdOn(user, on = true) {
  try {
    const name = String(user).toLowerCase();
    const list = (JSON.parse(localStorage.getItem(LS.faceIdUsers) || "[]")).filter((u) => u !== name);
    if (on) list.push(name);
    localStorage.setItem(LS.faceIdUsers, JSON.stringify(list));
  } catch (e) {}
}

// Whether the phone can offer Face ID from the keyboard, above the username box
// ("passkey autofill"): Safari on iOS 16+, Chrome and Edge.
export async function passkeyAutofillAvailable() {
  try {
    return !!window.PublicKeyCredential && !!PublicKeyCredential.isConditionalMediationAvailable &&
      (await PublicKeyCredential.isConditionalMediationAvailable());
  } catch (e) { return false; }
}

// Call straight from the tap with a fresh ticket. Returns like uploadLogin, plus
// "cancelled" and "unknown" (a passkey this site doesn't know).
// { autofill: true, signal } instead waits quietly for the keyboard's Face ID
// suggestion; abort the signal before starting a tap's own request.
export async function passkeySignIn(t, { autofill = false, signal } = {}) {
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: { challenge: fromB64urlBytes(t.challenge), rpId: t.rpId, userVerification: "required", timeout: autofill ? undefined : 60000 },
      ...(autofill ? { mediation: "conditional" } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (e) { return { status: "cancelled" }; }
  if (!cred) return { status: "cancelled" };
  try {
    const r = await passkeyPost("/passkey/login", { ticket: t.ticket, credential: {
      id: cred.id,
      clientDataJSON: toB64url(cred.response.clientDataJSON),
      authenticatorData: toB64url(cred.response.authenticatorData),
      signature: toB64url(cred.response.signature),
    } });
    if (r.ok && r.data.token) {
      setFaceIdOn(r.data.user);
      return { status: "ok", auth: { user: r.data.user, token: r.data.token, exp: r.data.exp, admin: !!r.data.admin } };
    }
    if (r.status === 403) return { status: "pending" };
    if (r.status === 429) return { status: "limited" };
    if (r.status === 401) return { status: "unknown", error: r.data.error };
    return { status: "error", error: r.data.error };
  } catch (e) { return { status: "error" }; }
}

// Make a passkey: for the signed-in account (purpose "add", needs auth) or for a
// new account request (purpose "signup"). Call straight from the tap.
export async function passkeyCreate(t, purpose, auth) {
  const user = t.user;
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      challenge: fromB64urlBytes(t.challenge),
      rp: { id: t.rpId, name: "Vale Trails" },
      user: { id: t.userId ? fromB64urlBytes(t.userId) : crypto.getRandomValues(new Uint8Array(16)), name: user, displayName: user },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", requireResidentKey: true, userVerification: "required" },
      excludeCredentials: (t.exclude || []).map((id) => ({ type: "public-key", id: fromB64urlBytes(id) })),
      attestation: "none",
      timeout: 60000,
    } });
  } catch (e) {
    const why = e && e.name;
    if (why === "InvalidStateError") return { status: "exists" };
    // Closing the Face ID sheet is NotAllowedError (or AbortError); anything else is a
    // real failure, worth showing instead of silently doing nothing.
    if (why === "NotAllowedError" || why === "AbortError") return { status: "cancelled" };
    return { status: "error", error: `${faceIdName()} couldn't make a sign-in here (${why || "unknown error"}). Use a password instead.` };
  }
  if (!cred) return { status: "cancelled" };
  try {
    const r = await passkeyPost("/passkey/register", { purpose, ticket: t.ticket, label: deviceLabel(), credential: {
      id: cred.id,
      clientDataJSON: toB64url(cred.response.clientDataJSON),
      attestationObject: toB64url(cred.response.attestationObject),
    } }, auth);
    if (r.ok) { setFaceIdOn(user); return { status: "ok", passkeys: r.data.passkeys || [] }; }
    if (r.status === 401) return { status: "signedout" };
    if (r.status === 429) return { status: "limited" };
    return { status: "error", error: r.data.error };
  } catch (e) { return { status: "error" }; }
}

// The signed-in account's Face ID sign-ins: [{ id, label, created }].
export async function loadPasskeys(auth) {
  if (!auth || !auth.token) throw new NotSignedIn("Sign in");
  const r = await fetch(TAGS_API + "/passkeys", { headers: { Authorization: authHeader(auth) }, cache: "no-store" });
  if (r.status === 401) throw new NotSignedIn("Sign in");
  if (!r.ok) throw new Error("Couldn't load (" + r.status + ")");
  return (await r.json()).passkeys || [];
}
export const removePasskey = (auth, id) => postJSON(TAGS_API + "/passkeys", { remove: id }, auth).then((r) => r.passkeys || []);
export const removePushSubscription = (auth, subscription) =>
  postJSON(TAGS_API + "/push/unsubscribe", { subscription }, auth);

// The sign-in survives a refresh: the session token is kept on this device until
// it expires (30 days) or you sign out. A password-only login is never stored.
export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(LS.session) || "null");
    if (s && s.token && s.user && s.exp > Date.now()) return s;
  } catch (e) {}
  return null;
}
export function saveSession(auth) {
  try {
    if (auth && auth.token) {
      localStorage.setItem(LS.session, JSON.stringify(auth));
      localStorage.setItem(LS.lastUser, auth.user);
    } else localStorage.removeItem(LS.session);
  } catch (e) {}
}
// The username last signed in on this device, kept after signing out so the
// sign-in screen can fill it in. The password is left to iCloud Keychain.
export function lastUser() {
  try { return localStorage.getItem(LS.lastUser) || ""; } catch (e) { return ""; }
}

export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const newUploadId = () => "up_" + crypto.randomUUID();

// Send one file with upload progress (fetch can't report progress, XHR can).
// Resolves with the Worker's JSON reply; rejects with its error message.
function sendFile(url, blob, auth, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", authHeader(auth));
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    if (onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    }
    xhr.onerror = () => reject(new Error("Couldn't reach the server"));
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch (e) {}
      if (xhr.status === 507) return reject(new StorageFull());
      if (xhr.status === 401) return reject(new NotSignedIn("Sign in to upload"));
      if (xhr.status === 429) return reject(new TooManyAttempts("Too many attempts. Wait a minute."));
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(body.error || "The upload failed (" + xhr.status + ")"));
      resolve(body);
    };
    xhr.send(blob);
  });
}

// A small JPEG preview for the grid, stored before the file itself under the same id.
export async function uploadThumb(blob, id, auth) {
  await sendFile(`${TAGS_API}/thumb?id=${encodeURIComponent(id)}`, blob, auth);
}

export async function uploadPhoto(blob, { id, date, camera, species, comment, author, buck, thumb }, auth, onProgress) {
  const query = new URLSearchParams({
    id: id || "", date, camera, species,
    comment: comment || "", author: author || "", buck: buck || "", thumb: thumb ? "1" : "",
  });
  return sendFile(`${TAGS_API}/upload?${query}`, blob, auth, onProgress);
}

// Edit an upload's camera / date / animal, or remove it entirely ({ id, remove: true }).
export async function updateUpload(patch, auth) {
  return postJSON(`${TAGS_API}/uploads`, patch, auth);
}

/* ------------------------------ Comments -------------------------------- */
// Anyone can read comments. Posting needs the upload login.
export async function remoteLoadComments() {
  try { return await getJSON("/comments"); } catch (e) { return null; }
}

// `body` is { photo, text, author } or { photo, remove }. Returns that photo's comments.
export async function saveComment(body, auth) {
  return (await postJSON(TAGS_API + "/comments", body, auth)).comments;
}

/* ------------------- Shared camera names (optional) --------------------- */
// Friendly camera names overlay the raw "Camera <id>" labels everywhere they show.
// Like tags: device-local until the Worker is configured, then global for everyone.
export function normalizeNameMap(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const [id, v] of Object.entries(raw)) {
      const s = (typeof v === "string" ? v : (v && v.name) || "").trim();
      if (s) out[String(id)] = s.slice(0, 60);
    }
  }
  return out;
}

export async function remoteLoadCameraNames() {
  try { return normalizeNameMap(await getJSON("/cameras")); } catch (e) { return null; }
}

export async function remoteSaveCameraName(id, name, auth) {
  if (!CAMERAS_API) return { ok: false, reason: "no-endpoint" };
  await postJSON(CAMERAS_API, { id: String(id), name: String(name || "") }, auth);
  return { ok: true };
}

// "Camera 6a309e41bdc62e4448c0a370" -> "Camera a370". The ids share their opening
// characters, so the end is the part that tells two cameras apart.
const shortCamera = (raw) => {
  const m = /^Camera [0-9a-f]{12,}$/i.exec(String(raw || ""));
  return m ? "Camera " + String(raw).slice(-4) : raw;
};

// Resolve a raw camera label to its friendly name (falls back to a short id).
export const displayCamera = (raw, names) =>
  (names && names[String(raw)]) || shortCamera(raw) || "Camera";

// Names set in the SPYPOINT app, keyed by raw label. Cameras sharing a name (such
// as an unchanged factory default) are left out so they stay distinguishable.
export function cameraLabels(cameras) {
  const seen = {};
  for (const c of cameras || []) if (c.label) seen[c.label] = (seen[c.label] || 0) + 1;
  const out = {};
  for (const c of cameras || []) if (c.label && seen[c.label] === 1) out[String(c.name)] = c.label;
  return out;
}

/* ---------------------- Per-photo metadata (optional) ------------------- */
// A generic key/value bag per photo id: notes, a favorite flag, and manual
// corrections to fields like temp/moon. Stored in metadata.json and synced by the
// same Worker (POST /meta). Like tags: device-local until the Worker is set up,
// then shared for everyone. Structural fields below are reserved so metadata can
// never clobber the tags / camera / image pipelines.
const META_API = TAGS_API ? TAGS_API + "/meta" : "";
const META_RESERVED = new Set(["id", "image", "thumb", "date", "camera", "tags", "species"]);

// Sanitize an incoming metadata entry into a plain, bounded object.
function cleanMetaEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).slice(0, 40).trim();
    if (!key || META_RESERVED.has(key)) continue;
    if (v == null) continue;
    if (typeof v === "string") { const s = v.slice(0, 500); if (s) out[key] = s; }
    else if (typeof v === "number") { if (Number.isFinite(v)) out[key] = v; }
    else if (typeof v === "boolean") out[key] = v;
    else if (Array.isArray(v)) out[key] = v.slice(0, 32).filter((x) => x != null && typeof x !== "object");
  }
  return out;
}

export function normalizeMetaMap(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const [id, v] of Object.entries(raw)) {
      const entry = cleanMetaEntry(v);
      if (entry && Object.keys(entry).length) out[String(id)] = entry;
    }
  }
  return out;
}

export async function remoteLoadMetadata() {
  try { return normalizeMetaMap(await getJSON("/meta")); } catch (e) { return null; }
}

// Save a metadata patch for one photo. Keys set to null are removed server-side;
// an empty patch object clears the whole entry.
export async function remoteSaveMetadata(id, patch, auth) {
  if (!META_API) return { ok: false, reason: "no-endpoint" };
  await postJSON(META_API, { id: String(id), meta: patch || {} }, auth);
  return { ok: true };
}

// The metadata overlay for one capture (or an empty object).
export const metaOf = (c, metaMap) => (metaMap && metaMap[String(c.id)]) || {};

// A capture with its metadata overlay applied for display (corrections to temp/
// moon/etc. win; reserved structural fields are never overwritten).
export function applyMeta(c, metaMap) {
  const m = metaOf(c, metaMap);
  if (!m || !Object.keys(m).length) return c;
  const merged = { ...c };
  for (const [k, v] of Object.entries(m)) {
    if (META_RESERVED.has(k)) continue;
    merged[k] = v;
  }
  return merged;
}

/* ----------------------------- Persistence ------------------------------ */
export const LS = {
  theme: "trailhub-theme",
  overrides: "trailhub-tag-overrides",
  legacyOverrides: "trailhub-species-overrides",
  archived: "trailhub-archived-ids",
  reviewed: "trailhub-reviewed-ids",
  deerUnsure: "trailhub-deer-unsure-ids",
  gridSize: "trailhub-grid-size",
  mapLayer: "trailhub-map-layer",
  camCoords: "trailhub-camera-coords",
  camNames: "trailhub-camera-names",
  meta: "trailhub-metadata",
  view: "trailhub-view",
  commentName: "trailhub-comment-name",
  filters: "trailhub-filters",
  uploadEdits: "trailhub-upload-edits",
  sidebarCollapsed: "trailhub-sidebar-collapsed",
  session: "trailhub-session",
  lastUser: "trailhub-last-user",
  alertSpecies: "trailhub-alert-species",
  alertCameras: "trailhub-alert-cameras",
  alertQuiet: "trailhub-alert-quiet",
  faceIdUsers: "trailhub-faceid-users",
  homeLatest: "trailhub-home-latest",
  castHours: "trailhub-deercast-hours",
  mapParcels: "trailhub-map-parcels",
  mapHarvests: "trailhub-map-harvests",
  alertsNudge: "trailhub-alerts-nudge",
};

// Local date helpers for the date-range filter and the upload date field.
export const parseIsoDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
// "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">.
export const toLocalInput = (d) => {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

// Merge new {id:[tags]} overrides with the legacy {id:"Species"} map.
export function loadOverrides() {
  const out = normalizeTagMap(readJSON(LS.overrides, null));
  const legacy = readJSON(LS.legacyOverrides, {}) || {};
  for (const [id, sp] of Object.entries(legacy)) {
    if (!out[String(id)] && sp) out[String(id)] = cleanTags([sp]);
  }
  return out;
}
export const loadArchived = () => new Set(readJSON(LS.archived, []) || []);
export const loadReviewed = () => new Set(readJSON(LS.reviewed, []) || []);
export const loadCameraNames = () => normalizeNameMap(readJSON(LS.camNames, null));
export const loadMetadata = () => normalizeMetaMap(readJSON(LS.meta, null));

/* ------------------------------- Hooks ---------------------------------- */
// Plain persisted primitive (string / boolean / number).
export function usePersistent(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? initial : v;
    } catch (e) {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, val); } catch (e) {}
  }, [key, val]);
  return [val, setVal];
}

// Persisted Set<string> (archived / reviewed ids).
export function usePersistentSet(key) {
  const [set, setSet] = useState(() => new Set(readJSON(key, []) || []));
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) {}
  }, [key, set]);
  const add = useCallback((id) => setSet((s) => new Set(s).add(String(id))), []);
  const remove = useCallback((id) => setSet((s) => { const n = new Set(s); n.delete(String(id)); return n; }), []);
  const clear = useCallback(() => setSet(new Set()), []);
  return [set, { add, remove, clear, setSet }];
}

// The photo list for whoever is signed in (nothing for anyone else): the copy
// kept on this device first, so the app opens at once and with no signal, then the
// Worker's, checked again every few minutes. A refused sign-in (the password was
// changed elsewhere, or the account removed) calls onSignedOut.
/* ------------------------------ App updates ------------------------------ */
// GitHub Pages stamps every file of a deploy with the deploy time, so a newer
// Last-Modified on index.html means a newer app than the one running. An app left
// open on a phone can otherwise run old code for days: switching back to it only
// resumes it.
const LIVE = /^https?:$/.test(location.protocol);
async function deployTime() {
  try {
    const res = await fetch("./index.html", { method: "HEAD", cache: "no-store" });
    const t = Date.parse(res.headers.get("Last-Modified") || "");
    return res.ok && Number.isFinite(t) ? Math.floor(t / 1000) : null;
  } catch (e) { return null; }
}
// The deploy this page came from: the page's own time (document.lastModified), or
// the server's at startup if that's older (a browser that reports "now" instead).
let loadedDeploy = (() => {
  const t = Date.parse(document.lastModified);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
})();
const startupCheck = LIVE ? deployTime().then((t) => {
  if (t != null) loadedDeploy = loadedDeploy == null ? t : Math.min(loadedDeploy, t);
}) : Promise.resolve();
const RELOADED_FOR = "trailhub-reloaded-for";

// Resolves to the newer deploy's time, or null (none, offline, or a local copy).
export async function newerDeploy() {
  if (!LIVE) return null;
  await startupCheck;
  if (loadedDeploy == null) return null;
  const deployed = await deployTime();
  if (deployed == null || deployed <= loadedDeploy) return null;
  // Never reload twice for one deploy, so mismatched clocks can't loop.
  try { if (sessionStorage.getItem(RELOADED_FOR) === String(deployed)) return null; } catch (e) {}
  return deployed;
}

export function reloadForDeploy(deployed) {
  try { sessionStorage.setItem(RELOADED_FOR, String(deployed)); } catch (e) {}
  window.location.reload();
}

// Nothing half-done on screen: no photo, sheet or form open, and no field being typed in.
export function safeToReload() {
  const a = document.activeElement;
  if (a && a.matches && a.matches("input, textarea, select, [contenteditable]")) return false;
  return !document.querySelector(".lb, .modal, .drawer, .mapbox.is-full, .harvestform");
}

export function useData(auth, onSignedOut, pollMs = 5 * 60 * 1000) {
  const [data, setData] = useState(loadInitialData);
  const [refreshing, setRefreshing] = useState(false);
  // The forecast is fetched on opening and refreshing, at most every 10 minutes by
  // itself and every minute by hand.
  const [forecast, setForecast] = useState(null);
  const forecastAt = useRef(0);
  const [pins, setPins] = useState(null);
  const mounted = useRef(true);
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;
  const user = auth && auth.token ? auth.user : null;

  const refresh = useCallback(async (opts) => {
    if (!user) return null;
    const byHand = !!opts && opts.byHand === true;
    setRefreshing(true);
    try {
      const fresh = await fetchLatestData();
      // pull.py only rewrites data.js (with a new generatedAt) when something changed.
      // Keeping the old object when it didn't saves re-filtering every photo on each
      // poll and every time the phone comes back to the app.
      const same = (prev) => prev.generatedAt && fresh.generatedAt &&
        prev.generatedAt.getTime() === fresh.generatedAt.getTime() && prev.captures.length === fresh.captures.length;
      if (mounted.current) setData((prev) => (same(prev) ? prev : fresh));
      fetchPins().then((p) => { if (p && mounted.current) setPins(p); }).catch(() => {});
      if (!document.hidden && Date.now() - forecastAt.current > (byHand ? 60000 : 600000)) {
        const before = forecastAt.current;
        forecastAt.current = Date.now();
        const job = fetchForecast(fresh).then((f) => {
          if (f && mounted.current) setForecast(f);
          else if (!f) forecastAt.current = before; // try again next time
        });
        if (byHand) await job;
      }
      return fresh;
    } catch (e) {
      if (e instanceof NotSignedIn && signedOut.current) signedOut.current();
      return null; // keep current data
    } finally { if (mounted.current) setRefreshing(false); }
  }, [user, auth && auth.token]);

  useEffect(() => {
    mounted.current = true;
    if (!user) { setData(loadInitialData()); setForecast(null); setPins(null); forecastAt.current = 0; return undefined; }
    cachedPins().then((p) => { if (p && mounted.current) setPins((now) => now || p); });
    loadCachedData().then((kept) => {
      if (kept && mounted.current) setData((prev) => (prev.captures.length ? prev : kept));
    });
    refresh();
    const t = setInterval(refresh, pollMs);
    // Coming back to the tab (or phone) should show new photos right away.
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollMs]);

  const shown = useMemo(() => {
    const kept = data.forecast;
    const newer = forecast && !(kept && Date.parse(kept.fetchedAt) > Date.parse(forecast.fetchedAt));
    if (!newer && !pins) return data;
    const out = { ...data };
    if (newer) out.forecast = forecast;
    if (pins) {
      out.canPin = true;
      if (data.cameras.some((c) => pins[c.name])) out.cameras = data.cameras.map((c) => (pins[c.name]
        ? { ...c, latitude: pins[c.name][0], longitude: pins[c.name][1], pinned: true } : c));
    }
    return out;
  }, [data, forecast, pins]);
  return { data: shown, refresh, refreshing, setPins };
}
