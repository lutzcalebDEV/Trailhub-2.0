// Saves what DeerCast says about the days ahead, once a day, so it can later be checked
// against what the cameras saw. An entry is written once and never changed. It holds
// only days that haven't started, so a forecast can't know how its day went.
//
//   node deercast_log.mjs          (the photo job, after data.js is written)
//
// The scores come from the site's own code (app/deercast.js).
import fs from "node:fs";

process.env.TZ = "America/New_York"; // the property's clock, for where days begin
// The app's modules expect a browser page. Nothing used here touches these.
globalThis.window ??= { React: { createElement() {} }, ReactDOM: {}, htm: () => null };
globalThis.location ??= { protocol: "node:", hash: "", search: "" };
globalThis.document ??= { lastModified: "" };
const { buildCast, MODEL } = await import("./app/deercast.js");
const { isoDay } = await import("./app/core.js");

const LOG = new URL("./deercast-log.json", import.meta.url);
const KEEP = 1100; // days, about three years
const FRESH = 12 * 3600000;

// An unreadable log stops here rather than being replaced by an empty one.
const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : {};
const now = Date.now();
const today = isoDay(new Date(now));

if (log[today]) {
  console.log(`DeerCast log: ${today} already saved.`);
} else {
  const text = fs.readFileSync(new URL("./data.js", import.meta.url), "utf8");
  const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const captures = data.captures.map((c) => ({ ...c, date: new Date(c.date) })).filter((c) => !isNaN(c.date));
  const cast = buildCast(data, captures, {}, { now });
  const days = cast ? cast.days.filter((d) => d.ahead >= 1) : [];
  if (!days.length || !cast.fetchedAt || now - cast.fetchedAt > FRESH) {
    console.log("DeerCast log: no fresh forecast to save yet.");
  } else {
    const r = (v, n = 2) => Number(v.toFixed(n));
    log[today] = {
      savedAt: new Date(now).toISOString(), forecastAt: cast.fetchedAt.toISOString(), model: MODEL, visits: cast.visits,
      days: days.map((d) => ({
        day: d.key, ahead: d.ahead, score: r(d.score),
        // [measurement, points] for each factor
        factors: Object.fromEntries(d.factors.map((f) => [f.id, [r(f.x), f.pts]])),
        windows: d.windows.map((w) => [w.start, w.end].map((t) => new Date(t).toISOString())),
        hours: d.points.filter((p, i) => i % 4 === 0 && i < d.points.length - 1).map((p) => r(p.score, 1)),
        wind: [r(d.wind.speed, 1), Math.round(d.wind.deg)],
      })),
    };
    const kept = Object.fromEntries(Object.entries(log).sort().slice(-KEEP));
    fs.writeFileSync(new URL("./deercast-log.json.tmp", import.meta.url), JSON.stringify(kept) + "\n");
    fs.renameSync(new URL("./deercast-log.json.tmp", import.meta.url), LOG);
    console.log(`DeerCast log: saved ${today}, ${days.length} days ahead.`);
  }
}
