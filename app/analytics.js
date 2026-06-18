// Vale Trails — pure analytics helpers over the capture list.
// Every function respects user/shared tag overrides via effectiveSpecies/Tags.
import {
  effectiveSpecies, effectiveTags, isKnownSpecies, reviewReason,
  isoDay, fmtDate, WEEKDAYS, speciesColor,
} from "./core.js";

export const eff = (c, ov) => ({
  ...c,
  species: effectiveSpecies(c, ov),
  tags: effectiveTags(c, ov),
});

/* ------------------------------- Filtering ------------------------------ */
export function filterCaptures(captures, filters, ov) {
  const q = (filters.q || "").trim().toLowerCase();
  return captures.filter((c) => {
    const species = effectiveSpecies(c, ov);
    const tags = effectiveTags(c, ov);
    if (filters.species !== "All" && species !== filters.species && !tags.includes(filters.species)) return false;
    if (filters.camera !== "All" && c.camera !== filters.camera) return false;
    if (filters.tod === "day" && c.isNight) return false;
    if (filters.tod === "night" && !c.isNight) return false;
    if (filters.bucksOnly && !tags.includes("Buck")) return false;
    if (q && !(`${species} ${c.camera}`.toLowerCase().includes(q))) return false;
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
