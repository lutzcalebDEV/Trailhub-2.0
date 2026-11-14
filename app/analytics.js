// Vale Trails — pure analytics helpers over the capture list.
// Every function respects user/shared tag overrides via effectiveSpecies/Tags.
import {
  effectiveSpecies, effectiveTags, isKnownSpecies, reviewReason,
  isoDay, fmtDate, WEEKDAYS, speciesColor, parseIsoDay,
} from "./core.js";

export const eff = (c, ov) => ({
  ...c,
  species: effectiveSpecies(c, ov),
  tags: effectiveTags(c, ov),
});

/* ------------------------------- Filtering ------------------------------ */
// Date-range presets. "Season" is the deer season, September through February,
// so in January it still reaches back to last September.
export const RANGE_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "season", label: "This season" },
  { value: "custom", label: "Custom dates" },
];

// [start, end) for the current range filter, either side null when open.
export function rangeBounds(filters, now = new Date()) {
  const days = { "7d": 7, "14d": 14, "30d": 30 }[filters.range];
  if (days) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    return { start, end: null };
  }
  if (filters.range === "season") {
    const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return { start: new Date(year, 8, 1), end: new Date(year + 1, 2, 1) };
  }
  if (filters.range === "custom") {
    const start = parseIsoDay(filters.from);
    const to = parseIsoDay(filters.to);
    const end = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : null;
    return { start, end };
  }
  return { start: null, end: null };
}

export function rangeLabel(filters) {
  if (filters.range === "custom") {
    const a = parseIsoDay(filters.from);
    const b = parseIsoDay(filters.to);
    if (a && b && filters.from === filters.to) return fmtDate(a);
    if (a && b) return `${fmtDate(a)} – ${fmtDate(b)}`;
    if (a) return `From ${fmtDate(a)}`;
    if (b) return `Until ${fmtDate(b)}`;
    return "Custom dates";
  }
  const opt = RANGE_OPTIONS.find((o) => o.value === filters.range);
  return opt ? opt.label : "";
}

export const WEEKDAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export function filterCaptures(captures, filters, ov) {
  const { start, end } = rangeBounds(filters);
  const hour = Number.isInteger(filters.hour) && filters.hour >= 0 ? filters.hour : -1;
  const wday = Number.isInteger(filters.wday) && filters.wday >= 0 ? filters.wday : -1;
  return captures.filter((c) => {
    const species = effectiveSpecies(c, ov);
    const tags = effectiveTags(c, ov);
    if (filters.species !== "All" && species !== filters.species && !tags.includes(filters.species)) return false;
    if (filters.camera !== "All" && c.camera !== filters.camera) return false;
    if (filters.tod === "day" && c.isNight) return false;
    if (filters.tod === "night" && !c.isNight) return false;
    if (filters.bucksOnly && !tags.includes("Buck")) return false;
    if (start && c.date < start) return false;
    if (end && c.date >= end) return false;
    if (hour >= 0 && c.date.getHours() !== hour) return false;
    if (wday >= 0 && c.date.getDay() !== wday) return false;
    return true;
  });
}

/* ------------------------------- Tallies -------------------------------- */
export function speciesCounts(captures, ov) {
  const m = new Map();
  for (const c of captures) {
    const s = effectiveSpecies(c, ov);
    m.set(s, (m.get(s) || 0) + 1);
  }
  return [...m.entries()]
    .map(([species, value]) => ({ species, value, color: speciesColor(species) }))
    .sort((a, b) => b.value - a.value);
}

export function cameraCounts(captures) {
  const m = new Map();
  for (const c of captures) m.set(c.camera, (m.get(c.camera) || 0) + 1);
  return [...m.entries()]
    .map(([camera, value]) => ({ camera, value }))
    .sort((a, b) => b.value - a.value);
}

// Per-camera freshness: newest photo, past-week count and whether it has gone quiet.
export const QUIET_DAYS = 3;
export function cameraStatus(captures, cameras, now = Date.now()) {
  const week = now - 7 * 86400000;
  const rows = new Map((cameras || []).map((c) => [c.name, { camera: c.name, last: null, week: 0 }]));
  for (const c of captures) {
    if (!rows.has(c.camera)) {
      if (cameras && cameras.length) continue; // e.g. a phone upload, which isn't a camera to watch
      rows.set(c.camera, { camera: c.camera, last: null, week: 0 });
    }
    const row = rows.get(c.camera);
    if (!row.last || c.date > row.last) row.last = c.date;
    if (c.date.getTime() >= week) row.week++;
  }
  return [...rows.values()].map((r) => {
    const quietDays = r.last ? Math.floor((now - r.last.getTime()) / 86400000) : null;
    return { ...r, quietDays, quiet: quietDays == null || quietDays >= QUIET_DAYS };
  });
}

// One tile per trigger: cameras fire multi-shot bursts of near-identical frames.
// Expects date-sorted captures (either direction); returns [{ capture, count }] in the same order.
export function collapseBursts(captures, limit = Infinity, gapMs = 120000) {
  const out = [];
  const open = new Map();
  for (const c of captures) {
    const group = open.get(c.camera);
    if (group && Math.abs(group.oldest - c.date) <= gapMs) {
      group.count++;
      group.oldest = c.date;
      continue;
    }
    if (out.length >= limit) break;
    const next = { capture: c, count: 1, oldest: c.date };
    open.set(c.camera, next);
    out.push(next);
  }
  return out;
}

// Where and when to sit: the camera and 3-hour window with the most recent activity.
// Sightings fade by half each week, so a pattern from last week beats an old one.
export const NOT_GAME = new Set(["Person", "Vehicle", "Empty"]);
const MIN_SIGHTINGS = 8;
export function bestSit(captures, ov, now = Date.now(), days = 21) {
  const recent = captures.filter((c) =>
    now - c.date.getTime() < days * 86400000 && !NOT_GAME.has(effectiveSpecies(c, ov)));
  const bucks = collapseBursts(recent.filter((c) => effectiveSpecies(c, ov) === "Buck"));
  const useBucks = bucks.length >= MIN_SIGHTINGS;
  const events = useBucks ? bucks : collapseBursts(recent);
  if (events.length < MIN_SIGHTINGS) return null;

  const byCamera = new Map();
  for (const { capture: c } of events) {
    if (!byCamera.has(c.camera)) byCamera.set(c.camera, { score: Array(24).fill(0), count: Array(24).fill(0) });
    const row = byCamera.get(c.camera);
    const h = c.date.getHours();
    row.score[h] += 0.5 ** ((now - c.date.getTime()) / (7 * 86400000));
    row.count[h]++;
  }
  let best = null;
  for (const [camera, row] of byCamera) {
    for (let start = 0; start < 24; start++) {
      const hours = [start, (start + 1) % 24, (start + 2) % 24];
      const score = hours.reduce((s, h) => s + row.score[h], 0);
      if (!best || score > best.score) {
        best = { camera, start, end: (start + 3) % 24, score, count: hours.reduce((s, h) => s + row.count[h], 0) };
      }
    }
  }
  return { ...best, total: events.length, subject: useBucks ? "buck" : "animal" };
}

// One profile per named buck. A sighting is a trigger, not a frame.
export function buckProfiles(captures) {
  const named = new Map();
  for (const c of captures) {
    if (!c.buck) continue;
    if (!named.has(c.buck)) named.set(c.buck, []);
    named.get(c.buck).push(c);
  }
  return [...named.entries()].map(([name, shots]) => {
    const events = collapseBursts(shots).map((e) => e.capture);
    const hours = hourHistogram(events);
    return {
      name, shots, hours,
      events: events.length,
      latest: shots[0],
      last: shots[0].date,
      first: shots[shots.length - 1].date,
      peak: peakWindow(hours),
      dayPct: daylightPct(events),
      cameras: cameraCounts(events),
    };
  }).sort((a, b) => b.last - a.last);
}

// Sightings per 100 hours of each condition, so common weather doesn't win by default.
const MIN_WEATHER_HOURS = 24;
export function weatherRates(captures, hours) {
  if (!hours) return null;
  const events = collapseBursts(captures).map((e) => e.capture).filter((c) => c.weather);
  if (events.length < 10) return null;
  const rates = (field, order) => {
    const counts = {};
    for (const c of events) {
      const k = c.weather[field];
      if (k) counts[k] = (counts[k] || 0) + 1;
    }
    return order
      .filter((label) => (hours[field]?.[label] || 0) >= MIN_WEATHER_HOURS)
      .map((label) => ({ label, value: ((counts[label] || 0) / hours[field][label]) * 100 }));
  };
  return {
    wind: rates("windBand", ["Under 5 mph", "5\u201310 mph", "10\u201315 mph", "15+ mph"]),
    trend: rates("trend", ["Falling", "Steady", "Rising"]),
    sky: rates("sky", ["Dry", "Rain"]),
  };
}

// False triggers aren't activity, so charts and summaries leave them out.
export const withoutEmpty = (captures, ov) => captures.filter((c) => effectiveSpecies(c, ov) !== "Empty");

// Charts describe wildlife, so people, vehicles and false triggers don't count.
export const animalActivity = (captures, ov) => captures.filter((c) => !NOT_GAME.has(effectiveSpecies(c, ov)));

export function speciesList(captures, ov) {
  return speciesCounts(captures, ov).map((x) => x.species);
}

export function hourHistogram(captures) {
  const hours = new Array(24).fill(0);
  for (const c of captures) hours[c.date.getHours()]++;
  return hours;
}

export function dayNightSplit(captures) {
  let day = 0, night = 0;
  for (const c of captures) (c.isNight ? night++ : day++);
  return { day, night, total: day + night };
}

export function daylightPct(captures) {
  const { day, total } = dayNightSplit(captures);
  return total ? Math.round((day / total) * 100) : 0;
}

// Last `days` days as {date, value, label, key}. Oldest first.
export function dailyCounts(captures, days = 14) {
  const map = new Map();
  for (const c of captures) {
    const k = isoDay(c.date);
    map.set(k, (map.get(k) || 0) + 1);
  }
  const out = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = isoDay(d);
    out.push({ key: k, date: d, value: map.get(k) || 0, label: fmtDate(d) });
  }
  return out;
}

export function isoDayCounts(captures) {
  const m = new Map();
  for (const c of captures) {
    const k = isoDay(c.date);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function weekdayCounts(captures) {
  const arr = new Array(7).fill(0);
  for (const c of captures) arr[c.date.getDay()]++;
  return arr.map((value, i) => ({ label: WEEKDAYS[i], value }));
}

// Per-species day/night breakdown (top N species).
export function speciesByDayNight(captures, ov, top = 6) {
  const m = new Map();
  for (const c of captures) {
    const s = effectiveSpecies(c, ov);
    const row = m.get(s) || { species: s, day: 0, night: 0, total: 0, color: speciesColor(s) };
    c.isNight ? row.night++ : row.day++;
    row.total++;
    m.set(s, row);
  }
  return [...m.values()].sort((a, b) => b.total - a.total).slice(0, top);
}

/* --------------------------- Activity timing ---------------------------- */
// Strongest contiguous activity window (default 3h, wraps past midnight) in a
// 24-hour histogram. Returns the window plus the share of captures inside it.
export function peakWindow(hours, span = 3) {
  const total = hours.reduce((s, n) => s + n, 0);
  if (!total) return null;
  let best = { start: 0, sum: -1 };
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let k = 0; k < span; k++) sum += hours[(s + k) % 24];
    if (sum > best.sum) best = { start: s, sum };
  }
  return { start: best.start, end: (best.start + span) % 24, count: best.sum, pct: Math.round((best.sum / total) * 100) };
}

// Per-species hourly activity, peak window and day/night mix (top N by volume).
// This is the core of "when is each species most active".
export function speciesActivity(captures, ov, top = 6) {
  const m = new Map();
  for (const c of captures) {
    const s = effectiveSpecies(c, ov);
    let row = m.get(s);
    if (!row) { row = { species: s, color: speciesColor(s), hours: new Array(24).fill(0), day: 0, night: 0, total: 0 }; m.set(s, row); }
    row.hours[c.date.getHours()]++;
    c.isNight ? row.night++ : row.day++;
    row.total++;
  }
  return [...m.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, top)
    .map((r) => ({ ...r, peak: peakWindow(r.hours), dayPct: Math.round((r.day / r.total) * 100) }));
}

export function tempBuckets(captures) {
  const temps = captures.map((c) => c.temp).filter((t) => t != null);
  if (!temps.length) return null;
  const min = Math.min(...temps), max = Math.max(...temps);
  const span = Math.max(1, max - min);
  const n = 6;
  const buckets = new Array(n).fill(0).map((_, i) => ({
    lo: Math.round(min + (span * i) / n),
    hi: Math.round(min + (span * (i + 1)) / n),
    value: 0,
  }));
  for (const t of temps) {
    let idx = Math.floor(((t - min) / span) * n);
    if (idx >= n) idx = n - 1;
    if (idx < 0) idx = 0;
    buckets[idx].value++;
  }
  return { buckets, min, max, count: temps.length };
}

export function moonCounts(captures) {
  const m = new Map();
  for (const c of captures) {
    if (!c.moon) continue;
    m.set(c.moon, (m.get(c.moon) || 0) + 1);
  }
  if (!m.size) return null;
  return [...m.entries()].map(([moon, value]) => ({ moon, value })).sort((a, b) => b.value - a.value);
}

/* ------------------------------- Review --------------------------------- */
// Captures that still need a human to confirm the species.
export function reviewQueue(captures, ov, archived, reviewed) {
  return captures.filter((c) => {
    const id = String(c.id);
    if (archived.has(id) || reviewed.has(id)) return false;
    return reviewReason(eff(c, ov)) != null;
  });
}

export function peakHour(captures) {
  const hours = hourHistogram(captures);
  const max = Math.max(...hours);
  if (max === 0) return null;
  return { hour: hours.indexOf(max), count: max };
}

/* ---------------- Period comparison (this vs previous window) ----------- */
export function periodDelta(captures, days = 7) {
  const now = Date.now();
  const span = days * 86400000;
  let cur = 0, prev = 0;
  for (const c of captures) {
    const age = now - c.date.getTime();
    if (age < span) cur++;
    else if (age < span * 2) prev++;
  }
  const delta = prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);
  return { cur, prev, delta };
}
