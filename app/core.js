// Vale Trails — core domain logic.
// Data model, species taxonomy, persistence, shared-tag sync and React hooks.
// This preserves the original TrailHub data contract and localStorage keys so a
// returning visitor keeps their theme, tags, archives and review progress.
import { useState, useEffect, useRef, useCallback } from "./react.js";

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
  Person:   "var(--sp-person)",
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
        image: c.image || "",
        isNight: !!c.isNight,
        confidence: c.confidence == null ? null : c.confidence,
        aiTagged: !!c.aiTagged,
        tempEstimated: !!c.tempEstimated,
        media: c.media === "video" ? "video" : "photo",
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
    };
  });

  return {
    captures,
    cameras,
    demo: !!d.demo,
    generatedAt: parseUtc(d.generatedAt),
    weatherHours: d.weatherHours || null,
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

export async function fetchLatestData() {
  const res = await fetch(`data.js?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`data.js fetch failed (${res.status})`);
  return normalizePayload(parseDataScript(await res.text()));
}

export function loadInitialData() {
  const d = (typeof window !== "undefined" && window.TRAILHUB_DATA) || {};
  return normalizePayload(d);
}

/* ----------------------- Shared tag sync (optional) --------------------- */
// window.TRAILHUB_TAGS_API (config.js) enables global tag edits. Without it,
// edits stay in this browser only, on top of a committed tags.json overlay.
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
  const urls = [];
  if (TAGS_API) urls.push(TAGS_API + (TAGS_API.includes("?") ? "&" : "?") + "t=" + Date.now());
  urls.push("tags.json?t=" + Date.now());
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (r.ok) return normalizeTagMap(await r.json());
    } catch (e) { /* try next */ }
  }
  return null;
}

export async function remoteSaveTags(id, tags) {
  if (!TAGS_API) return { ok: false, reason: "no-endpoint" };
  const r = await fetch(TAGS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: String(id), tags }),
  });
  if (!r.ok) throw new Error("Tag save failed (" + r.status + ")");
  return { ok: true };
}

// Save many photos in one request (and one commit). `items` is {id: [tags]}.
export async function remoteSaveTagsBatch(items) {
  if (!TAGS_API) return { ok: false, reason: "no-endpoint" };
  const r = await fetch(TAGS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!r.ok) throw new Error("Tag save failed (" + r.status + ")");
  return { ok: true };
}

/* ---------------------------- Photo uploads ----------------------------- */
export const hasUploads = !!TAGS_API;
export class StorageFull extends Error {}

const basicAuth = ({ user, password }) => {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return "Basic " + btoa(String.fromCharCode(...bytes));
};

// Returns "ok", "denied" or "error".
export async function uploadLogin(user, password) {
  try {
    const r = await fetch(TAGS_API + "/login", {
      method: "POST",
      headers: { Authorization: basicAuth({ user, password }) },
    });
    return r.ok ? "ok" : r.status === 401 ? "denied" : "error";
  } catch (e) {
    return "error";
  }
}

export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

export async function uploadPhoto(blob, { date, camera, species, comment, author }, auth) {
  const query = new URLSearchParams({ date, camera, species, comment: comment || "", author: author || "" });
  const r = await fetch(`${TAGS_API}/upload?${query}`, {
    method: "POST",
    headers: { Authorization: basicAuth(auth), "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (r.status === 507) throw new StorageFull();
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || "The upload failed (" + r.status + ")");
  }
}

/* ------------------------------ Comments -------------------------------- */
// Anyone can read comments. Posting needs the upload login.
export async function remoteLoadComments() {
  const urls = [];
  if (TAGS_API) urls.push(TAGS_API + "/comments?t=" + Date.now());
  urls.push("comments.json?t=" + Date.now());
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (e) { /* try next */ }
  }
  return null;
}

// `body` is { photo, text, author } or { photo, remove }. Returns that photo's comments.
export async function saveComment(body, auth) {
  const r = await fetch(TAGS_API + "/comments", {
    method: "POST",
    headers: { Authorization: basicAuth(auth), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Comment failed (" + r.status + ")");
  return (await r.json()).comments;
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
  const urls = [];
  if (CAMERAS_API) urls.push(CAMERAS_API + (CAMERAS_API.includes("?") ? "&" : "?") + "t=" + Date.now());
  urls.push("camera-names.json?t=" + Date.now());
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (r.ok) return normalizeNameMap(await r.json());
    } catch (e) { /* try next */ }
  }
  return null;
}

export async function remoteSaveCameraName(id, name) {
  if (!CAMERAS_API) return { ok: false, reason: "no-endpoint" };
  const r = await fetch(CAMERAS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: String(id), name: String(name || "") }),
  });
  if (!r.ok) throw new Error("Camera name save failed (" + r.status + ")");
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
const META_RESERVED = new Set(["id", "image", "date", "camera", "tags", "species"]);

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
  const urls = [];
  if (META_API) urls.push(META_API + (META_API.includes("?") ? "&" : "?") + "t=" + Date.now());
  urls.push("metadata.json?t=" + Date.now());
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (r.ok) return normalizeMetaMap(await r.json());
    } catch (e) { /* try next */ }
  }
  return null;
}

// Save a metadata patch for one photo. Keys set to null are removed server-side;
// an empty patch object clears the whole entry.
export async function remoteSaveMetadata(id, patch) {
  if (!META_API) return { ok: false, reason: "no-endpoint" };
  const r = await fetch(META_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: String(id), meta: patch || {} }),
  });
  if (!r.ok) throw new Error("Metadata save failed (" + r.status + ")");
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
  gridSize: "trailhub-grid-size",
  camCoords: "trailhub-camera-coords",
  camNames: "trailhub-camera-names",
  meta: "trailhub-metadata",
  view: "trailhub-view",
  commentName: "trailhub-comment-name",
  filters: "trailhub-filters",
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

// Loads data instantly from window.TRAILHUB_DATA, then polls data.js for updates.
export function useData(pollMs = 5 * 60 * 1000) {
  const [data, setData] = useState(loadInitialData);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchLatestData();
      if (mounted.current) setData(fresh);
      return fresh;
    } catch (e) {
      return null; // keep current data
    } finally { if (mounted.current) setRefreshing(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
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

  return { data, refresh, refreshing };
}
