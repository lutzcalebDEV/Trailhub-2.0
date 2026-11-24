// Vale Trails — DeerCast: how much deer should move, hour by hour, for the next week.
// Pure calculations; the Home card and the page are in views/deercast.js.
//
// The weights are starting estimates. Time of day and the rut lead because collar
// studies agree on them. Weather only nudges: temperature has the best support, wind
// and rain matter at extremes, pressure is contested. The moon is shown, never scored.
import { effectiveTags, effectiveSpecies, isoDay, moonFromDate } from "./core.js";
import { isDeer } from "./analytics.js";

const HOUR = 3600000, DAY = 24 * HOUR;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const DAYS_AHEAD = 7;
// Raise this whenever the scoring changes, so saved forecasts (deercast_log.mjs) are
// only compared with others scored the same way.
export const MODEL = 1;

/* --------------------------------- Sun ----------------------------------- */
// Daylight counts from 30 minutes before sunrise to 30 minutes after sunset.
export const EDGE = 30 * 60000;
const atNoon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function sunTimes(date, site) {
  const rad = Math.PI / 180;
  const n = Math.round((atNoon(date).getTime() / DAY + 2440587.5) - 2451545 + site.lng / 360);
  const noon = n - site.lng / 360;
  const M = (357.5291 + 0.98560028 * noon) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 282.9372) % 360;
  const transit = 2451545 + noon + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const decl = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(site.lat * rad) * Math.sin(decl)) / (Math.cos(site.lat * rad) * Math.cos(decl));
  const w = Math.acos(clamp(cosW, -1, 1)) / rad / 360;
  const ms = (j) => (j - 2440587.5) * DAY;
  return { rise: ms(transit - w), set: ms(transit + w) };
}
export function daylight(date, site) {
  const s = sunTimes(date, site);
  return { ...s, start: s.rise - EDGE, end: s.set + EDGE };
}
export const inDaylight = (date, site) => {
  const d = daylight(date, site);
  return date.getTime() >= d.start && date.getTime() <= d.end;
};
// Where the property is (rounded), from the private data.
export function siteOf(data) {
  const f = data && data.forecast;
  if (f && Number.isFinite(f.lat) && Number.isFinite(f.lng)) return { lat: f.lat, lng: f.lng };
  const cam = ((data && data.cameras) || []).find((c) => c.latitude != null && c.longitude != null);
  return cam ? { lat: cam.latitude, lng: cam.longitude } : null;
}

/* -------------------------------- Weather --------------------------------- */
// One "temp|rain|pressure|wind|direction|gust|rain chance" string per hour.
export function parseHours(forecast) {
  const start = forecast ? Date.parse(forecast.start) : NaN;
  const map = new Map();
  if (!Number.isFinite(start)) return map;
  forecast.hours.forEach((row, i) => {
    const v = row.split("|").map((x) => (x === "" ? NaN : Number(x)));
    if (!v.slice(0, 5).every(Number.isFinite)) return;
    map.set(start + i * HOUR, {
      t: start + i * HOUR, temp: v[0], rain: v[1], pressure: v[2], wind: v[3], dir: v[4],
      gust: Number.isFinite(v[5]) ? v[5] : v[3], chance: Number.isFinite(v[6]) ? v[6] : null,
    });
  });
  return map;
}
const between = (hours, a, b) => {
  const out = [];
  for (let t = Math.floor(a / HOUR) * HOUR; t < b; t += HOUR) if (hours.has(t)) out.push(hours.get(t));
  return out;
};
// Directions are averaged as arrows: 350° and 10° make north, not south. Each hour
// counts by its speed, and the arrow's length shows whether the direction held.
export function windOver(rows) {
  if (!rows.length) return null;
  const rad = Math.PI / 180;
  const speed = mean(rows.map((r) => r.wind));
  const x = mean(rows.map((r) => r.wind * Math.sin(r.dir * rad)));
  const y = mean(rows.map((r) => r.wind * Math.cos(r.dir * rad)));
  const deg = (Math.atan2(x, y) / rad + 360) % 360;
  return {
    speed, gust: Math.max(...rows.map((r) => r.gust)), deg,
    dir: COMPASS[Math.floor(((deg + 22.5) % 360) / 45)],
    steady: speed >= 3 && Math.hypot(x, y) / speed >= 0.7,
  };
}

/* ---------------------------------- Rut ----------------------------------- */
// The state wildlife agency's peak conception date for the county: December 7. The
// phases around it are estimates.
const RUT_PEAK = { month: 11, day: 7 };
const RUT_CURVE = [[-24, 0], [-15, 0.45], [-12, 0.8], [-3, 1], [4, 1], [19, 0]];
export function rutOn(date) {
  // Early-year dates belong to the rut just past.
  const year = date.getMonth() < 5 ? date.getFullYear() - 1 : date.getFullYear();
  const d = Math.round((atNoon(date) - new Date(year, RUT_PEAK.month, RUT_PEAK.day, 12)) / DAY);
  let level = 0;
  for (let i = 1; i < RUT_CURVE.length; i++) {
    const [x0, y0] = RUT_CURVE[i - 1], [x1, y1] = RUT_CURVE[i];
    if (d >= x0 && d <= x1) { level = y0 + ((y1 - y0) * (d - x0)) / (x1 - x0); break; }
  }
  const phase = d < -23 || d > 18 ? null
    : d < -14 ? "Pre-rut" : d < -3 ? "Seeking and chasing" : d <= 4 ? "Peak breeding" : "Rut tapering";
  return { level, phase, daysToPeak: -d };
}

/* ------------------------------ Time of day ------------------------------- */
// Sunrise and sunset move through the season, so time of day is measured against
// them: 6 is sunrise, 12 the middle of the day, 18 sunset, 0 the middle of the night.
function phaseOf(t, site) {
  const d = new Date(t);
  const s = sunTimes(d, site);
  if (t >= s.rise && t <= s.set) return { p: 6 + (12 * (t - s.rise)) / (s.set - s.rise), len: (s.set - s.rise) / 12 };
  const a = t > s.set ? s.set : sunTimes(addDays(d, -1), site).set;
  const b = t > s.set ? sunTimes(addDays(d, 1), site).rise : s.rise;
  return { p: (18 + (12 * (t - a)) / (b - a)) % 24, len: (b - a) / 12 };
}
const around = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); };
const bump = (p, c, w) => Math.exp(-(around(p, c) ** 2) / (2 * w * w));
// The textbook deer day: most movement at dawn and dusk, some all night, least at noon.
const typical = (p) => {
  const base = p >= 6 && p <= 18 ? 0.2 : 0.34;
  return base + (1 - base) * Math.max(bump(p, 6.2, 1.3), bump(p, 17.8, 1.4));
};

// Separate visits: photos at one camera within 30 minutes are one visit.
export function deerVisits(captures, ov) {
  const last = new Map();
  const out = [];
  const deer = captures.filter((c) => !c.uploadedBySite && isDeer(effectiveSpecies(c, ov), effectiveTags(c, ov)));
  for (const c of deer.sort((a, b) => a.date - b.date)) {
    const prev = last.get(c.camera);
    if (!prev || c.date - prev > 30 * 60000) out.push(c);
    last.set(c.camera, c.date);
  }
  return out;
}

// The textbook day blended with the last 60 days on these cameras. It counts as much
// as 60 visits would, so the cameras take over gradually.
const PRIOR_VISITS = 60, PATTERN_DAYS = 60;
export function dayPattern(visits, site, now) {
  const recent = visits.filter((c) => now - c.date.getTime() < PATTERN_DAYS * DAY && c.date.getTime() <= now);
  const seen = recent.map((c) => phaseOf(c.date.getTime(), site));
  const bins = Array.from({ length: 96 }, (_, i) => i / 4);
  const norm = (a) => { const m = mean(a) || 1; return a.map((v) => v / m); };
  const book = norm(bins.map(typical));
  const own = norm(bins.map((p) => sum(seen.map((s) => bump(p, s.p, 0.9) / s.len))));
  const w = seen.length / (seen.length + PRIOR_VISITS);
  const mix = bins.map((_, i) => book[i] * (1 - w) + own[i] * w);
  const top = Math.max(...mix);
  return {
    visits: seen.length,
    at: (p) => {
      const x = (p * 4) % 96, i = Math.floor(x), f = x - i;
      return (mix[i] * (1 - f) + mix[(i + 1) % 96] * f) / top;
    },
  };
}

/* --------------------------------- Score ---------------------------------- */
export const BANDS = [[7.5, "Great"], [6.5, "Good"], [4.5, "Fair"], [0, "Slow"]];
export const bandOf = (s) => BANDS.find(([min]) => s >= min)[1];
const START = 5;

// `x` is the plain measurement behind each factor, kept for the forecast log.
function factors(day, rows, prior) {
  const list = [];
  const add = (id, x, label, detail, pts, reason) => list.push({ id, x, label, detail, pts: Math.round(pts * 10) / 10, reason });

  const rut = rutOn(day);
  const away = rut.daysToPeak;
  add("rut", rut.level, "Rut", rut.phase
    ? `${rut.phase}${away > 0 ? `, ${away} day${away === 1 ? "" : "s"} to peak` : away === 0 ? ", peak day" : `, ${-away} day${away === -1 ? "" : "s"} past peak`}`
    : "Outside the rut", 2 * rut.level, rut.phase && rut.phase.toLowerCase());

  const temp = mean(rows.map((r) => r.temp));
  // "Usual" is the same stretch of the clock over the seven days before.
  const usual = mean(prior.flat().map((r) => r.temp));
  if (usual != null) {
    const diff = temp - usual;
    const n = Math.round(Math.abs(diff));
    add("temp", diff, "Temperature", n < 2 ? "Near this week's average" : `${n}° ${diff < 0 ? "cooler" : "warmer"} than the week before`,
      1.2 * clamp(-diff / 12, -1, 1), diff < 0 ? "cooler than usual" : "warmer than usual");
  }
  const yday = prior[0] || [];
  if (yday.length) {
    const hi = Math.max(...rows.map((r) => r.temp)), was = Math.max(...yday.map((r) => r.temp));
    const n = Math.round(Math.abs(hi - was));
    add("change", hi - was, "Change from day before", n < 2 ? "High about the same" : `High ${n}° ${hi < was ? "lower" : "higher"}`,
      0.6 * clamp((was - hi) / 12, -1, 1), hi < was ? "temperature dropping" : "warming up");
  }
  const wind = windOver(rows);
  add("wind", wind.speed, "Wind", `${Math.round(wind.speed)} mph average, gusts ${Math.round(wind.gust)}`,
    wind.speed >= 18 ? -0.9 : wind.speed >= 13 ? -0.5 : 0, "strong wind");
  const rain = sum(rows.map((r) => r.rain));
  const wet = rows.filter((r) => r.rain >= 0.1).length;
  add("rain", rain, "Rain", rain < 0.2 ? "Dry" : `${(rain / 25.4).toFixed(2)} in over ${wet} hour${wet === 1 ? "" : "s"}`,
    rain >= 10 ? -0.6 : rain >= 4 ? -0.3 : 0, "steady rain");
  // Against the same stretch the day before.
  if (yday.length) {
    const p = mean(rows.map((r) => r.pressure)), d = p - mean(yday.map((r) => r.pressure));
    add("pressure", d, "Pressure", `${(p * 0.02953).toFixed(2)} inHg, ${d > 2 ? "up" : d < -2 ? "down" : "about the same"}${Math.abs(d) > 2 ? ` ${Math.abs(d * 0.02953).toFixed(2)}` : ""} from the day before`,
      0.3 * clamp(d / 8, -1, 1), d > 0 ? "pressure rising" : "pressure falling");
  }
  return { list, temp, hi: Math.max(...rows.map((r) => r.temp)), lo: Math.min(...rows.map((r) => r.temp)), wind, rain, rut };
}

const sentence = (list) => {
  const top = list.filter((f) => Math.abs(f.pts) >= 0.3 && f.reason)
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 2).map((f) => f.reason);
  const s = top.join(", ");
  return s ? s[0].toUpperCase() + s.slice(1) : "Ordinary conditions";
};

// The best unbroken stretch in [a, b]: around its busiest moment, while movement stays
// within 80% of it, at most 3 hours.
const STEP = 15 * 60000;
function bestWindow(points, a, b) {
  const pts = points.filter((x) => x.t >= a && x.t <= b);
  if (pts.length < 4) return null;
  let top = 0;
  pts.forEach((x, i) => { if (x.raw > pts[top].raw) top = i; });
  let i = top, j = top;
  while (j - i < 12) {
    const left = i > 0 ? pts[i - 1].raw : -1, right = j < pts.length - 1 ? pts[j + 1].raw : -1;
    const next = Math.max(left, right);
    if (next < 0 || (next < pts[top].raw * 0.8 && j - i >= 4)) break;
    if (left >= right) i--; else j++;
  }
  return { start: pts[i].t, end: pts[j].t, score: Math.max(...pts.slice(i, j + 1).map((x) => x.score)) };
}

function buildDay(date, hours, site, pattern, allHours) {
  const from = startOf(date).getTime(), to = addDays(date, 1).getTime();
  const full = between(hours, from, to);
  if (full.length < 20) return null;
  const light = daylight(date, site);
  const span = allHours ? [from, to] : [light.start, light.end];
  const rows = between(hours, span[0], span[1]);
  if (!rows.length) return null;
  const prior = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, -i);
    const l = daylight(d, site);
    const r = allHours ? between(hours, startOf(d).getTime(), startOf(addDays(d, 1)).getTime()) : between(hours, l.start, l.end);
    if (r.length >= rows.length * 0.8) prior.push(r); else if (i === 1) prior.push([]);
  }
  const f = factors(date, rows, prior);
  const score = clamp(START + sum(f.list.map((x) => x.pts)), 1, 10);

  // Hour by hour: the usual day, with the rut filling in the middle of it and heavy
  // rain or wind thinning the hours they fall in. The best hour reads the day's score.
  const points = [];
  for (let t = from; t <= to; t += STEP) {
    const w = hours.get(Math.floor(Math.min(t, to - 1) / HOUR) * HOUR);
    const p = pattern.at(phaseOf(t, site).p);
    const lit = t >= light.start && t <= light.end;
    const raw = (p + (lit ? 0.15 * f.rut.level * (1 - p) : 0))
      * (w && w.rain >= 2 ? 0.8 : 1) * (w && w.wind >= 18 ? 0.88 : 1);
    points.push({ t, raw, weather: w || null, light: lit });
  }
  const inSpan = points.filter((x) => x.t >= span[0] && x.t <= span[1]);
  const top = Math.max(...inSpan.map((x) => x.raw));
  for (const x of points) x.score = clamp(score * (0.15 + 0.85 * (x.raw / top)), 1, 10);

  const noon = (light.rise + light.set) / 2;
  const windows = [["Morning", span[0], noon], ["Evening", noon, span[1]]].map(([label, a, b]) => {
    const w = bestWindow(points, a, b);
    return w && { label, ...w, wind: windOver(between(hours, w.start, w.end)) };
  }).filter(Boolean);

  return {
    key: isoDay(date), date, score, shown: Math.round(score), band: bandOf(score), factors: f.list,
    why: sentence(f.list), hi: f.hi, lo: f.lo, wind: f.wind, rain: f.rain, rut: f.rut,
    moon: moonFromDate(atNoon(date)), light, points, windows,
  };
}

// The week from the next hunt on: today until its daylight runs out, then tomorrow.
export function buildCast(data, captures, ov, { allHours = false, now = Date.now() } = {}) {
  const site = siteOf(data);
  if (!data || !data.forecast || !site) return null;
  const hours = parseHours(data.forecast);
  const today = new Date(now);
  const pattern = dayPattern(deerVisits(captures, ov), site, now);
  const first = !allHours && now > daylight(today, site).end ? 1 : 0;
  const days = [];
  for (let i = first; i < first + DAYS_AHEAD; i++) {
    const day = buildDay(addDays(today, i), hours, site, pattern, allHours);
    if (day) days.push({ ...day, ahead: i });
  }
  if (!days.length) return null;
  const fetched = Date.parse(data.forecast.fetchedAt);
  return {
    days, visits: pattern.visits, fetchedAt: Number.isFinite(fetched) ? new Date(fetched) : null,
    stale: !(now - fetched < 24 * HOUR),
  };
}

// What it was like at one moment, for a harvest: the weather, and DeerCast's score for
// then when there's enough of the days before to compare with. Null when the forecast
// doesn't reach back that far (about a week).
export function conditionsAt(data, captures, ov, when) {
  const site = siteOf(data);
  if (!data || !data.forecast || !site) return null;
  const hours = parseHours(data.forecast);
  const w = hours.get(Math.floor(when.getTime() / HOUR) * HOUR);
  if (!w) return null;
  const out = { temp: Math.round(w.temp), wind: Math.round(w.wind), dir: windOver([w]).dir,
    pressure: Number((w.pressure * 0.02953).toFixed(2)), score: null };
  const had = [1, 2, 3].every((n) => hours.has(startOf(addDays(when, -n)).getTime()));
  const day = had && buildDay(startOf(when), hours, site, dayPattern(deerVisits(captures, ov), site, when.getTime()), false);
  if (day) {
    const p = day.points.reduce((b, x) => (Math.abs(x.t - when) < Math.abs(b.t - when) ? x : b));
    out.score = Math.round(p.score);
  }
  return out;
}

/* ------------------------------ Stand wind -------------------------------- */
export function standWind(stand, wind) {
  if (!stand || !wind) return null;
  if (!wind.steady) return { level: "risky", text: wind.speed < 3 ? "Light, scent may drift" : "Shifting" };
  if ((stand.good || []).includes(wind.dir)) return { level: "good", text: "Good" };
  if ((stand.avoid || []).includes(wind.dir)) return { level: "avoid", text: "Avoid" };
  return { level: "risky", text: "Risky" };
}
