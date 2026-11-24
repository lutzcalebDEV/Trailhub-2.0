// Vale Trails — Live wind: a full-screen map with the wind drifting over it, where scent
// blows from every stand, how the wind changes over the coming hours, and the stands
// themselves (add, name, move, delete). Stands are shared with everyone signed in.
import { html, useState, useEffect, useRef, useMemo, createPortal } from "../react.js";
import { Btn } from "../ui.js";
import { Icon } from "../icons.js";
import { LS, usePersistent, fmtTime } from "../core.js";
import { parseHours, windOver, standWind } from "../deercast.js";
import { calmAir, scentText } from "../terrain.js";
import { showParcels } from "../parcels.js";
import { loadLeaflet, SAT_TILES, SAT_CREDIT } from "./mapview.js";
import { runWind, plumeColor, makePin } from "./windmap.js";
import { useWindNow } from "./windnow.js";

const HOUR = 3600000;
const AHEAD = 18;
const PLAY_MS = 1500;
const hourLabel = (t, i) => (i === 0 ? "Now" : new Date(t).toLocaleTimeString([], { hour: "numeric" }));
const Arrow = ({ deg, size = 20 }) => html`<svg className="castarrow" width=${size} height=${size} viewBox="0 0 24 24" aria-hidden="true"
  style=${{ transform: `rotate(${deg + 180}deg)` }}><path d="M12 3v18M6 9l6-6 6 6" /></svg>`;
const apart = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

// The first real swing (over 45°, with enough wind to mean it) in the hours shown.
function shiftNote(hours) {
  const first = hours.find((h) => h.wind.speed >= 3);
  if (!first) return "Light wind for now. Scent may drift any direction.";
  const turn = hours.find((h) => h.t > first.t && h.wind.speed >= 3 && apart(h.wind.deg, first.wind.deg) > 45);
  // A smaller change counts once it holds for three hours.
  const easy = hours.findIndex((h, i) => h.t > first.t && h.wind.speed >= 3 && h.wind.dir !== first.wind.dir
    && [1, 2].every((n) => hours[i + n] && hours[i + n].wind.dir === h.wind.dir));
  if (easy > 0 && (!turn || hours[easy].t < turn.t)) {
    const when = fmtTime(new Date(hours[easy].t));
    return `${first.wind.dir} now, ${hours[easy].wind.dir} from ${when}${turn ? `, then ${turn.wind.dir} around ${fmtTime(new Date(turn.t))}` : ""}`;
  }
  return turn ? `${first.wind.dir} now, turning ${turn.wind.dir} around ${fmtTime(new Date(turn.t))}`
    : `Holding near ${first.wind.dir} through ${fmtTime(new Date(hours[hours.length - 1].t))}`;
}

// Every stand: the cameras (fixed here; their pins move on the Map page) and added ones.
export function allStands({ data, stands, camName }) {
  return [
    ...(data.cameras || []).filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({ id: "cam:" + c.name, camera: c.name, label: camName(c.name), latitude: c.latitude, longitude: c.longitude, pinned: c.pinned })),
    ...(stands || []).map((s) => ({ id: s.id, label: s.name, latitude: s.lat, longitude: s.lng, pinned: true, by: s.by })),
  ];
}

// `start`: "new" opens ready to place a stand, a stand's id opens it for changes; either
// way it closes when that's done. `show`: a stand to open on.
export function LiveWind({ app, site, start, show, onClose }) {
  const { data, stands, saveStand, removeStand, auth, refreshWeather } = app;
  const [now, setNow] = useState(() => Date.now());
  const [pick, setPick] = useState(0); // hours from now
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState(show || null); // a stand's id
  // { id?, name } while placing a stand
  const [edit, setEdit] = useState(() => {
    if (start === "new") return { name: "" };
    const s = start && allStands(app).find((x) => x.id === start);
    return s ? { id: s.id, name: s.label } : null;
  });
  const endEdit = () => { setError(""); if (start) onClose(); else setEdit(null); };
  const [listing, setListing] = useState(false); // the list of stands is open
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(() => !!window.L);
  const [trouble, setTrouble] = useState("");
  const [lines, setLines] = usePersistent(LS.mapParcels, "off");
  const [lineState, setLineState] = useState("ok");
  const elRef = useRef(null), canvasRef = useRef(null), mapRef = useRef(null), stripRef = useRef(null), animRef = useRef(null);

  // The newest forecast on opening and while open (the app limits how often it asks).
  useEffect(() => {
    refreshWeather();
    const id = setInterval(() => { setNow(Date.now()); if (!document.hidden) refreshWeather(); }, 5 * 60000);
    return () => clearInterval(id);
  }, [refreshWeather]);

  const hours = useMemo(() => {
    const all = parseHours(data.forecast);
    const start = Math.floor(now / HOUR) * HOUR;
    const out = [];
    for (let i = 0; i <= AHEAD; i++) { const r = all.get(start + i * HOUR); if (r) out.push({ t: r.t, i, rain: r.rain, wind: windOver([r]) }); }
    return out;
  }, [data.forecast, now]);
  const cur = hours[Math.min(pick, hours.length - 1)] || null;
  const wind = cur ? cur.wind : null;
  const list = allStands(app).map((s) => ({ ...s, rating: s.camera ? standWind((data.stands || {})[s.camera], wind) : null,
    air: cur ? calmAir(data.terrain, s, wind, cur.t, site, cur.rain >= 0.1) : null }));
  const chosen = list.find((s) => s.id === sel) || null;
  const mine = (s) => !s.camera && auth && (auth.admin || String(s.by).toLowerCase() === String(auth.user).toLowerCase());

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => setPick((p) => { if (p >= hours.length - 1) { setPlaying(false); return 0; } return p + 1; }), PLAY_MS);
    return () => clearInterval(id);
  }, [playing, hours.length]);
  useEffect(() => {
    const box = stripRef.current, b = box && box.children[pick];
    if (b) box.scrollTo({ left: b.offsetLeft - box.clientWidth / 2 + b.clientWidth / 2, behavior: "smooth" });
  }, [pick]);

  // Escape backs out one step; the page behind holds still.
  const closeRef = useRef(onClose);
  closeRef.current = () => { if (edit) endEdit(); else if (listing) setListing(false); else if (sel) setSel(null); else onClose(); };
  useEffect(() => {
    const root = document.documentElement, before = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") closeRef.current(); };
    // The phone's back gesture changes the page behind, so the map goes with it.
    const onPop = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => { root.style.overflow = before; window.removeEventListener("keydown", onKey); window.removeEventListener("popstate", onPop); };
  }, []);
  const airport = useWindNow(site, data.forecast, now);

  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    loadLeaflet().then(() => { if (live) setReady(true); }).catch(() => { if (live) setTrouble("The map couldn’t load"); });
    return () => { live = false; };
  }, [ready]);

  const fitAll = (animate) => {
    const map = mapRef.current;
    if (!map) return;
    const spots = list.map((s) => [s.latitude, s.longitude]);
    if (spots.length > 1) map.fitBounds(spots, { paddingTopLeft: [70, 130], paddingBottomRight: [90, 90], maxZoom: 16, animate });
    else map.setView(spots[0] || [site.lat, site.lng], 16, { animate });
  };
  useEffect(() => {
    const L = window.L;
    if (!ready || !L) return undefined;
    const map = L.map(elRef.current, { zoomControl: false, zoomSnap: 0.25 });
    // Phones pinch to zoom; the buttons would only cover the map.
    if (!window.matchMedia("(pointer: coarse)").matches) L.control.zoom({ position: "topleft" }).addTo(map);
    map.attributionControl.setPrefix(false);
    mapRef.current = map;
    const focus = list.find((s) => s.id === (show || start));
    if (focus) map.setView([focus.latitude, focus.longitude], 17, { animate: false });
    else fitAll(false);
    const tiles = L.tileLayer(SAT_TILES, { maxZoom: 19, maxNativeZoom: 16, attribution: SAT_CREDIT }).addTo(map);
    tiles.on("tileerror", () => setTrouble("Satellite photos couldn’t load"));
    tiles.on("tileload", () => setTrouble(""));
    map.on("click", () => { setSel(null); setListing(false); });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, [ready]);

  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (lines !== "on" || !L || !map) return undefined;
    return showParcels(L, map, setLineState);
  }, [lines, ready]);

  const pinKey = list.map((s) => [s.id, s.label, s.latitude, s.longitude, s.rating && s.rating.level].join()).join(";") + sel + (edit ? edit.id || "new" : "");
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (!L || !map) return undefined;
    const group = L.layerGroup().addTo(map);
    list.forEach((s) => {
      if (edit && edit.id === s.id) return; // the crosshair stands in for it
      const el = makePin(s, s.id === sel ? " is-sel" : "");
      const mk = L.marker([s.latitude, s.longitude], { title: s.label, interactive: !edit, keyboard: !edit,
        icon: L.divIcon({ className: "windpin__hit", iconSize: [44, 44], iconAnchor: [22, 22], html: el }) }).addTo(group);
      if (!edit) mk.on("click keypress", (e) => {
        if (e.type === "keypress" && e.originalEvent && e.originalEvent.key !== "Enter") return;
        setListing(false);
        setSel(s.id);
      });
    });
    return () => { group.remove(); };
  }, [ready, pinKey]);

  // The wind, and a plume from each stand, read fresh on every frame.
  const live = useRef({});
  live.current = { wind, list, edit };
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const a = runWind(canvasRef.current, () => live.current.wind, () => {
      const map = mapRef.current;
      if (!map) return [];
      const at = (lat, lng) => map.latLngToContainerPoint([lat, lng]);
      const e = live.current.edit, c = e && map.getSize().divideBy(2);
      return [...live.current.list.filter((s) => !e || e.id !== s.id).map((s) => ({ ...xy(at(s.latitude, s.longitude)), id: s.id, color: plumeColor(s.rating, s.camera), air: s.air })),
        ...(c ? [{ x: c.x, y: c.y, id: "edit", color: plumeColor(null) }] : [])];
    });
    animRef.current = a;
    return () => a.stop();
  }, []);
  useEffect(() => { if (animRef.current) animRef.current.wake(); }, [cur && cur.t, pinKey, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const wake = () => animRef.current && animRef.current.wake();
    map.on("move zoom", wake);
    return () => map.off("move zoom", wake);
  }, [ready]);

  const startEdit = (s) => {
    setSel(null); setListing(false); setError("");
    if (s && mapRef.current) mapRef.current.setView([s.latitude, s.longitude], Math.max(16, mapRef.current.getZoom()));
    setEdit(s ? { id: s.id, name: s.label } : { name: "" });
  };
  const goTo = (s) => {
    setListing(false); setSel(s.id);
    const map = mapRef.current;
    if (map) map.setView([s.latitude, s.longitude], Math.max(17, map.getZoom()));
  };
  const here = () => {
    setError("");
    if (!navigator.geolocation) { setError("This device can't share its location."); return; }
    setBusy("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(""); if (mapRef.current) mapRef.current.setView([p.coords.latitude, p.coords.longitude], 18); },
      () => { setBusy(""); setError("Couldn't get your location. Move the map instead."); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  };
  const save = async (e) => {
    e.preventDefault();
    const name = edit.name.trim();
    if (!name) { setError("Give the stand a name."); return; }
    if (list.some((s) => s.id !== edit.id && s.label.toLowerCase() === name.toLowerCase())) { setError("Another stand has that name."); return; }
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    setBusy("saving"); setError("");
    const saved = await saveStand({ ...(edit.id ? { id: edit.id } : {}), name, lat: c.lat, lng: c.lng });
    setBusy("");
    if (saved && start) onClose(); else if (saved) { setEdit(null); setSel(saved.id); } else setError("That didn't save. Check your connection and try again.");
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${chosen.label} for everyone?`)) return;
    setBusy("deleting");
    const ok = await removeStand(chosen.id);
    setBusy("");
    if (ok) setSel(null);
  };

  const notes = { zoom: "Zoom in to see property lines", loading: "Loading property lines", error: "Property lines are unavailable right now" };
  return createPortal(html`<div className="livewind" role="dialog" aria-modal="true" aria-label="Live wind">
    <div className="livewind__stage">
      <div className="livewind__map map is-sat" ref=${elRef} />
      <canvas className="windmap__wind" ref=${canvasRef} />
      ${edit && html`<div className="livewind__cross" aria-hidden="true" />`}

      <div className="livewind__top">
        <button type="button" className="livewind__round" onClick=${() => onClose()} aria-label="Close"><${Icon} name="x" size=${22} /></button>
        <div className="livewind__badge">
          ${wind ? html`<${Arrow} deg=${wind.deg} size=${26} />
            <span><b className="tnum">${Math.round(wind.speed)} mph ${wind.unsure ? "" : `from ${wind.dir}`}</b>
              <small>${wind.unsure ? "Direction uncertain · " : ""}Gusts ${Math.round(wind.gust)} · ${pick === 0 ? "now" : fmtTime(new Date(cur.t))}</small></span>`
            : html`<span><b>No wind forecast yet</b></span>`}
        </div>
      </div>
      ${!edit && html`<button type="button" className="livewind__add" onClick=${() => startEdit(null)}><${Icon} name="pin" size=${19} />Add stand</button>`}
      <div className="livewind__side">
        <button type="button" className="livewind__tile" aria-pressed=${lines === "on"} onClick=${() => setLines(lines === "on" ? "off" : "on")}>
          <${Icon} name="parcels" size=${20} /><span>Lines</span></button>
        ${!edit && html`<button type="button" className="livewind__tile" aria-expanded=${listing} aria-pressed=${listing} onClick=${() => setListing(!listing)}>
          <${Icon} name="stand" size=${20} /><span>Stands</span></button>`}
      </div>
      ${(trouble || (lines === "on" && notes[lineState])) && html`<div className="mapbox__note" role="status">${trouble || notes[lineState]}</div>`}
    </div>

    <div className="livewind__panel">
      ${edit ? html`<form className="livewind__form" onSubmit=${save}>
          <div className="livewind__head"><b>${edit.id ? "Edit stand" : "Add a stand"}</b><small>Move the map until the crosshair is on the stand.</small></div>
          <label className="field-row"><span>Stand name</span>
            <input className="input" maxLength=${40} value=${edit.name} placeholder="e.g. Creek ladder" onInput=${(e) => { setError(""); setEdit({ ...edit, name: e.target.value }); }} /></label>
          ${error && html`<p className="form-error" role="alert">${error}</p>`}
          <div className="livewind__acts">
            <${Btn} type="button" icon="target" disabled=${!!busy} onClick=${here}>${busy === "locating" ? "Finding you" : "My location"}</${Btn}>
            <div className="spacer" />
            <${Btn} type="button" disabled=${!!busy} onClick=${endEdit}>Cancel</${Btn}>
            <${Btn} type="submit" variant="primary" icon="check" disabled=${!!busy}>${busy === "saving" ? "Saving" : "Save"}</${Btn}>
          </div>
        </form>`
      : listing ? html`<div className="livewind__list">
          <div className="livewind__listhead"><b>${list.length} stand${list.length === 1 ? "" : "s"}</b>
            <button type="button" onClick=${() => { setSel(null); setListing(false); fitAll(true); }}>Show all on map</button>
            <button type="button" onClick=${() => { onClose(); app.setView("stands"); }}>Manage</button></div>
          ${list.length === 0 && html`<p className="faint">No stands yet. Tap Add stand.</p>`}
          ${list.map((s) => html`<button type="button" key=${s.id} className=${"livewind__row" + (s.id === sel ? " is-active" : "")} onClick=${() => goTo(s)}>
            <span className=${"standrow__icon" + (s.camera ? " is-cam" : "")}><${Icon} name=${s.camera ? "camera" : "stand"} size=${18} /></span>
            <span className="livewind__head"><b>${s.camera ? "(Cam) " : ""}${s.label}</b><small>${scentText(wind, s.air)}${s.rating && !s.air ? ` · ${s.rating.text} (guess)` : ""}</small></span>
            <${Icon} name="chevronRight" size=${17} className="standrow__chev" />
          </button>`)}
        </div>`
      : html`<div>
          ${chosen ? html`<div className="livewind__stand">
              <div className="livewind__head"><b>${chosen.camera ? "(Cam) " : ""}${chosen.label}</b>
                <small>${scentText(wind, chosen.air)}${chosen.air ? " (estimate)" : ""}${chosen.rating && !chosen.air ? ` · ${chosen.rating.text} (guess)` : ""}</small></div>
              ${mine(chosen) && html`<button type="button" className="livewind__icon" aria-label=${`Edit ${chosen.label}`} onClick=${() => startEdit(chosen)}><${Icon} name="pencil" size=${18} /><span>Edit</span></button>
                <button type="button" className="livewind__icon" aria-label=${`Delete ${chosen.label}`} disabled=${!!busy} onClick=${remove}><${Icon} name="trash" size=${18} /><span>Delete</span></button>`}
              <button type="button" className="livewind__icon" aria-label="Back to all stands" onClick=${() => setSel(null)}><${Icon} name="x" size=${18} /><span>Done</span></button>
            </div>`
          : html`<div className="livewind__next">
            <button type="button" className="livewind__play" onClick=${() => setPlaying(!playing)} aria-label=${playing ? "Pause" : "Play the coming hours"}>
              ${playing ? html`<span className="livewind__pause" />` : html`<${Icon} name="play" size=${20} />`}</button>
            <div><b>${hours.length > 1 ? shiftNote(hours) : "Waiting for the forecast"}</b>
              <small>${airport ? `Right now: ${airport.text} · ${airport.where}, ${airport.ago}` : `Forecast for the next ${Math.max(0, hours.length - 1)} hours`}</small></div>
          </div>`}
          <div className="livewind__strip" ref=${stripRef} role="group" aria-label="Wind by hour">
            ${hours.map((h, i) => html`<button type="button" key=${h.t} className=${"livewind__hour" + (i === pick ? " is-active" : "")} aria-pressed=${i === pick}
              aria-label=${`${hourLabel(h.t, i)}: ${h.wind.unsure ? "direction uncertain" : "from " + h.wind.dir}, ${Math.round(h.wind.speed)} miles an hour`}
              onClick=${() => { setPlaying(false); setPick(i); }}>
              <span>${hourLabel(h.t, i)}</span><${Arrow} deg=${h.wind.deg} size=${22} />
              <b className="tnum">${Math.round(h.wind.speed)}</b><small>${h.wind.unsure ? "?" : h.wind.dir}</small>
            </button>`)}
          </div>
        </div>`}
    </div>
  </div>`, document.body);
}
const xy = (p) => ({ x: p.x, y: p.y });
