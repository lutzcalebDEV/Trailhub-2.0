// Vale Trails — DeerCast's wind map: aerial photo, the stands, and streaks that
// drift the way the wind blows. One forecast covers the property, so every streak
// moves the same way.
import { html, useState, useEffect, useRef } from "../react.js";
import { loadLeaflet, SAT_TILES, SAT_CREDIT } from "./mapview.js";

// Fewer streaks on a small map, so the photo shows through.
const streaks = (w, h) => Math.round(Math.min(60, Math.max(20, (w * h) / 5200)));
const rad = (d) => (d * Math.PI) / 180;
const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Where scent blows from a stand, in the color of its rating.
const PLUME = { good: "52,211,153", risky: "245,181,63", avoid: "240,113,111" };
export const plumeColor = (rating, camera) => PLUME[rating && rating.level] || (camera ? "96,165,250" : "255,122,47");
// A stand's name tag. Cameras are blue, start with "(Cam)" and carry a camera.
export function makePin(s, extra = "") {
  const el = document.createElement("div");
  el.className = `windpin is-${s.rating ? s.rating.level : "none"}${s.camera ? " is-cam" : ""}${extra}`;
  if (s.camera) {
    const icon = document.createElement("i");
    icon.setAttribute("aria-hidden", "true");
    el.append(icon);
  }
  const name = document.createElement("b");
  name.textContent = (s.camera ? "(Cam) " : "") + s.label; // typed by people, so never as HTML
  el.append(name);
  return el;
}
const PUFFS = 90;
const puff = () => ({ at: Math.random(), side: (Math.random() + Math.random() + Math.random()) / 1.5 - 1, size: 1 + Math.random() * 1.7 });

// Draws the wind on a canvas over the map. `getWind` gives { speed, deg }, the mph and
// the direction it blows FROM; `getPlumes`, if given, each stand's { id, x, y, color, air } on
// the canvas (`air`, the calm-air estimate from terrain.js, steers its plume). Returns { wake, stop }.
export function runWind(canvas, getWind, getPlumes) {
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, frame = 0, last = 0, onScreen = true;
  // Eased toward the chosen hour, so moving the slider swings the streaks around.
  let cur = null;
  const seed = () => ({ x: Math.random(), y: Math.random(), age: Math.random(), life: 2.6 + Math.random() * 2, phase: Math.random() * 6.3 });
  const bits = [];
  const plumes = new Map(); // stand id -> its puffs

  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    const n = streaks(w, h);
    while (bits.length < n) bits.push(seed());
    bits.length = n;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = (dt) => {
    const want = getWind();
    if (!want) { ctx.clearRect(0, 0, w, h); return; }
    const to = { x: Math.sin(rad(want.deg + 180)), y: -Math.cos(rad(want.deg + 180)), s: want.speed };
    if (!cur || still()) cur = to;
    const k = Math.min(1, dt * 4);
    cur = { x: cur.x + (to.x - cur.x) * k, y: cur.y + (to.y - cur.y) * k, s: cur.s + (to.s - cur.s) * k };
    const len = Math.hypot(cur.x, cur.y) || 1;
    const ux = cur.x / len, uy = cur.y / len;
    const speed = 8 + cur.s * 5.5; // pixels a second
    const tail = 16 + Math.min(44, cur.s * 3);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const b of bits) {
      b.age += dt / b.life;
      if (b.age >= 1) Object.assign(b, seed(), { age: 0 });
      b.x += (ux * speed * dt) / w; b.y += (uy * speed * dt) / h;
      // Off one edge, back on the other.
      const px = (((b.x % 1) + 1) % 1) * (w + 80) - 40, py = (((b.y % 1) + 1) % 1) * (h + 80) - 40;
      const bend = Math.sin(b.phase + b.age * 5) * 3;
      const fade = still() ? 0.85 : Math.sin(Math.PI * b.age);
      const tx = px - ux * tail, ty = py - uy * tail;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo((px + tx) / 2 - uy * bend, (py + ty) / 2 + ux * bend, px, py);
        ctx.moveTo(px - ux * 6 - uy * 4, py - uy * 6 + ux * 4);
        ctx.lineTo(px, py);
        ctx.lineTo(px - ux * 6 + uy * 4, py - uy * 6 - ux * 4);
        ctx.stroke();
      };
      // A dark edge keeps the white readable over pale fields.
      ctx.strokeStyle = `rgba(0,0,0,${0.35 * fade})`; ctx.lineWidth = 3.6; path();
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * fade})`; ctx.lineWidth = 1.8; path();
    }
    // Scent: a cone of puffs from each stand. It opens wide when the wind is light or the
    // forecasts disagree, because then nobody knows where it goes.
    const reach = 70 + Math.min(90, cur.s * 9);
    const open = want.unsure || cur.s < 3 ? 0.62 : 0.2;
    for (const p of getPlumes ? getPlumes() : []) {
      if (p.x < -200 || p.y < -200 || p.x > w + 200 || p.y > h + 200) continue;
      if (!plumes.has(p.id)) plumes.set(p.id, Array.from({ length: PUFFS }, puff));
      // Calm air follows the ground: slower and wider than wind. With no likely way, it
      // pools around the stand.
      const own = p.air && p.air.toward != null;
      const pool = p.air && !own;
      const px = own ? Math.sin(rad(p.air.toward)) : ux, py = own ? -Math.cos(rad(p.air.toward)) : uy;
      for (const f of plumes.get(p.id)) {
        f.at += dt * (p.air ? 0.09 : 0.16 + cur.s * 0.025);
        if (f.at >= 1) Object.assign(f, puff(), { at: 0 });
        if (pool) {
          const turn = f.side * 3.14 + f.size * 9, out = f.at * 34;
          ctx.fillStyle = `rgba(${p.color},${(0.8 * (1 - f.at * 0.75)).toFixed(2)})`;
          ctx.beginPath(); ctx.arc(p.x + Math.cos(turn) * out, p.y + Math.sin(turn) * out, f.size + f.at * 1.6, 0, 6.3); ctx.fill();
          continue;
        }
        const along = f.at * (own ? 80 : reach), off = f.side * along * (own ? 0.42 : open);
        ctx.fillStyle = `rgba(${p.color},${(0.95 * (1 - f.at * 0.75)).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(p.x + px * along - py * off, p.y + py * along + px * off, f.size + f.at * 1.6, 0, 6.3);
        ctx.fill();
      }
    }
    // Keep the stand names clear.
    const at = canvas.getBoundingClientRect();
    for (const el of canvas.parentNode.querySelectorAll(".windpin")) {
      const r = el.getBoundingClientRect();
      ctx.clearRect(r.left - at.left - 2, r.top - at.top - 2, r.width + 4, r.height + 4);
    }
  };
  const loop = (t) => {
    frame = 0;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t;
    draw(dt);
    if (onScreen && !document.hidden && !still()) frame = requestAnimationFrame(loop);
  };
  const wake = () => { if (!frame) { last = 0; frame = requestAnimationFrame(loop); } };
  size();
  wake();
  // Nothing runs while the map is scrolled away or the app is in the background.
  const io = new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; if (onScreen) wake(); });
  io.observe(canvas);
  const ro = new ResizeObserver(() => { size(); wake(); });
  ro.observe(canvas);
  document.addEventListener("visibilitychange", wake);
  return {
    wake,
    stop() { cancelAnimationFrame(frame); frame = -1; io.disconnect(); ro.disconnect(); document.removeEventListener("visibilitychange", wake); },
  };
}

// `stands`: [{ name, label, latitude, longitude, rating }]; `wind`: { speed, gust, deg, dir }.
export function WindMap({ stands, site, wind, time, onOpen }) {
  const [ready, setReady] = useState(() => !!window.L);
  const [trouble, setTrouble] = useState("");
  const elRef = useRef(null);
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const animRef = useRef(null);
  const windRef = useRef(wind);
  windRef.current = wind;
  const standsRef = useRef(stands);
  standsRef.current = stands;

  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    loadLeaflet().then(() => { if (live) setReady(true); }).catch(() => { if (live) setTrouble("The map couldn’t load"); });
    return () => { live = false; };
  }, [ready]);

  // A picture, not a map to explore (that's the Map page), so scrolling never sticks.
  const spots = stands.map((s) => `${s.latitude},${s.longitude}`).join(";");
  useEffect(() => {
    const L = window.L;
    if (!ready || !L || !elRef.current) return undefined;
    const map = L.map(elRef.current, {
      zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false,
      boxZoom: false, keyboard: false, zoomSnap: 0.25,
    });
    map.attributionControl.setPrefix(false);
    mapRef.current = map;
    const frame = () => {
      map.invalidateSize();
      const pts = stands.map((s) => [s.latitude, s.longitude]);
      if (pts.length > 1) map.fitBounds(pts, { paddingTopLeft: [80, 110], paddingBottomRight: [80, 50], maxZoom: 15.5, animate: false });
      else map.setView(pts[0] || [site.lat, site.lng], 15);
    };
    frame();
    const tiles = L.tileLayer(SAT_TILES, { maxZoom: 18, maxNativeZoom: 16, attribution: SAT_CREDIT }).addTo(map);
    tiles.on("tileerror", () => setTrouble("Satellite photos couldn’t load"));
    tiles.on("tileload", () => setTrouble(""));
    const ro = new ResizeObserver(frame);
    ro.observe(elRef.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, [ready, spots]);

  // Stand names, with how the wind at the chosen time suits each.
  const labels = stands.map((s) => `${s.label}|${s.rating ? s.rating.level + s.rating.text : ""}`).join(";");
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (!L || !map) return undefined;
    const group = L.layerGroup().addTo(map);
    stands.forEach((s) => {
      const el = makePin(s);
      if (s.rating && !s.camera) { const r = document.createElement("span"); r.textContent = s.rating.text; el.append(r); }
      L.marker([s.latitude, s.longitude], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: el }) }).addTo(group);
    });
    return () => { group.remove(); };
  }, [ready, spots, labels]);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const a = runWind(canvasRef.current, () => windRef.current, () => {
      const map = mapRef.current;
      // Nobody sits at a camera pin, so only stands get a trail.
      return map ? standsRef.current.filter((s) => !s.camera).map((s) => {
        const at = map.latLngToContainerPoint([s.latitude, s.longitude]);
        return { id: s.id || s.name, x: at.x, y: at.y, color: plumeColor(s.rating, s.camera), air: s.air };
      }) : [];
    });
    animRef.current = a;
    return () => a.stop();
  }, []);
  // With motion turned off it's one still picture, redrawn when the hour changes.
  useEffect(() => { if (animRef.current) animRef.current.wake(); }, [wind && wind.deg, wind && wind.speed]);

  return html`<div className="windmap" role="group"
    aria-label=${wind ? `Wind at ${time}: from the ${wind.dir}, ${Math.round(wind.speed)} miles an hour` : "Wind map"}>
    <div className="windmap__map map is-sat" ref=${elRef} />
    ${trouble && html`<div className="mapbox__note is-low" role="status">${trouble}</div>`}
    <canvas className="windmap__wind" ref=${canvasRef} />
    ${wind && html`<div className="windmap__badge">
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" style=${{ transform: `rotate(${wind.deg + 180}deg)` }}>
        <path d="M12 3v18M6 9l6-6 6 6" /></svg>
      <span><b className="tnum">${Math.round(wind.speed)} mph</b><small>${wind.unsure ? "direction uncertain" : `from ${wind.dir}`} · gusts ${Math.round(wind.gust)}</small></span>
    </div>`}
    ${onOpen && html`<button type="button" className="windmap__tap" onClick=${onOpen} aria-label="Open Live wind" />`}
  </div>`;
}
