// Vale Trails — where scent likely goes when there's hardly any wind. Cooling air drains
// downhill at night, dawn and dusk, and warmed ground lifts it uphill by day. It's an
// estimate from USGS elevations sampled about 60 yards apart: small ditches, trees and
// water aren't in it.
import { sunTimes, compass } from "./deercast.js";

const HOUR = 3600000;
const M_LAT = 111200;
export const CALM = 4; // mph: at or above this the wind decides
const FLAT = 0.015; // a slope under 1.5% is too flat to steer air
const REACH = 110; // meters each way

// pull.py's grid: { lat, lng, step: [lat, lng], rows, cols, m: [...] } from the southwest
// corner, row by row going north.
function heightAt(g, lat, lng) {
  const y = (lat - g.lat) / g.step[0], x = (lng - g.lng) / g.step[1];
  const i = Math.floor(y), j = Math.floor(x);
  if (i < 0 || j < 0 || i >= g.rows - 1 || j >= g.cols - 1) return null;
  const at = (r, c) => g.m[r * g.cols + c];
  const four = [at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1)];
  if (!four.every(Number.isFinite)) return null;
  const fy = y - i, fx = x - j;
  return (four[0] * (1 - fx) + four[1] * fx) * (1 - fy) + (four[2] * (1 - fx) + four[3] * fx) * fy;
}

// The lie of the land around a spot: { slope, down } with `down` the compass degrees
// downhill, or null off the grid. A flat plane is fitted to the nearby heights.
export function slopeAt(g, lat, lng) {
  if (!g || !Array.isArray(g.m) || !Array.isArray(g.step)) return null;
  const mLng = M_LAT * Math.cos((lat * Math.PI) / 180);
  let xz = 0, yz = 0, n = 0;
  for (const dy of [-1, -0.5, 0, 0.5, 1]) for (const dx of [-1, -0.5, 0, 0.5, 1]) {
    const z = heightAt(g, lat + (dy * REACH) / M_LAT, lng + (dx * REACH) / mLng);
    if (z == null) return null;
    xz += dx * REACH * z; yz += dy * REACH * z; n += (dx * REACH) ** 2;
  }
  const gx = xz / n, gy = yz / n; // rise per meter going east, and north
  return { slope: Math.hypot(gx, gy), down: ((Math.atan2(-gx, -gy) * 180) / Math.PI + 360) % 360 };
}

// The air at a stand at time `t`: null when the wind decides, or
//   { kind: "drain" | "rise", toward, dir, text }   likely direction
//   { kind: "flat" | "turn" | "rain", text }        no likely direction
export function calmAir(terrain, spot, wind, t, site, raining) {
  if (!wind || !site || wind.speed >= CALM) return null;
  const s = slopeAt(terrain, spot.latitude, spot.longitude);
  if (!s) return null;
  const sun = sunTimes(new Date(t), site);
  if (raining) return { kind: "rain", text: "Calm and wet: scent may go anywhere" };
  if (s.slope < FLAT) return { kind: "flat", text: "Calm and flat: scent may go anywhere" };
  const drain = t < sun.rise + 1.5 * HOUR || t > sun.set - HOUR;
  const rise = t > sun.rise + 2.5 * HOUR && t < sun.set - 2 * HOUR;
  if (!drain && !rise) return { kind: "turn", text: "Calm: air is switching, scent may go anywhere" };
  const toward = drain ? s.down : (s.down + 180) % 360;
  const dir = compass(toward);
  return { kind: drain ? "drain" : "rise", toward, dir,
    text: drain ? `Calm: scent likely drains ${dir}, downhill` : `Calm: scent likely rises ${dir}, uphill` };
}

// Where scent goes from a stand, in words.
export function scentText(wind, air) {
  if (air) return air.text;
  if (!wind) return "";
  return wind.speed < 3 ? "Light wind: scent may drift anywhere" : wind.unsure ? "Wind direction uncertain" : `Scent blows ${compass(wind.deg + 180)}`;
}
