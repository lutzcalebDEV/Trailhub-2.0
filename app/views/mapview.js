// Vale Trails — Map: camera locations with activity-scaled markers (Leaflet).
import { html, useEffect, useRef, useMemo, useState } from "../react.js";
import { FilterBar } from "../shell.js";
import { Icon } from "../icons.js";
import { Empty, Btn, Chip, healthItems } from "../ui.js";
import { filterCaptures, cameraStatus, NOT_GAME } from "../analytics.js";
import { LS, usePersistent, timeAgo, fmtDateLong, parseIsoDay } from "../core.js";
import { showParcels, PARCEL_ZOOM } from "../parcels.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
// OpenStreetMap's public tiles: open data, no API key or account. Its usage policy
// requires the attribution below and a Referer header.
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Aerial photos from the USGS National Map: public domain, no key, US only. Its
// photos go to zoom 16 here; Leaflet enlarges them for the last two levels.
export const SAT_TILES = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
export const SAT_CREDIT = 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>';

// A marker: a circle sized by photo count, ringed when it's the chosen camera.
function markerIcon(L, size, count, active) {
  const ring = active ? "outline:3px solid var(--accent);outline-offset:2px;" : "";
  return L.divIcon({
    className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<div class="vt-marker" style="width:${size}px;height:${size}px;${ring}">${count}</div>`,
  });
}

// Leaflet (~160 KB) is only needed here, so it loads the first time the map opens
// instead of on every app start. Its stylesheet goes in before app/styles.css so the
// app's .leaflet-* overrides still win. Both files are in the service worker shell.
let leafletLoad = null;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletLoad) {
    leafletLoad = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "vendor/leaflet/leaflet.css";
      const appCss = document.querySelector('link[href="app/styles.css"]');
      document.head.insertBefore(css, appCss || null);
      const js = document.createElement("script");
      js.src = "vendor/leaflet/leaflet.js";
      js.onload = () => resolve(window.L);
      js.onerror = () => { leafletLoad = null; js.remove(); reject(new Error("Leaflet failed to load")); };
      document.head.appendChild(js);
    });
  }
  return leafletLoad;
}

// On a touch screen one finger scrolls the page, even over the map, and two fingers
// zoom it. Dragging the map is for the full-screen map, where nothing else scrolls.
const coarse = () => window.matchMedia("(pointer: coarse)").matches;

export function MapView(app) {
  const { data, captures, ov, filters, setFilter, setView, spList, theme, camName, renameCamera, savePins, openWind, stands, loadStands, harvests, loadHarvests, auth, openSignIn } = app;
  const [leafletReady, setLeafletReady] = useState(() => !!window.L);
  useEffect(() => {
    if (leafletReady) return;
    let live = true;
    loadLeaflet().then(() => { if (live) setLeafletReady(true); }).catch(() => { if (live) setTrouble("The map couldn’t load"); });
    return () => { live = false; };
  }, [leafletReady]);
  const [trouble, setTrouble] = useState("");
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [full, setFull] = useState(false);
  // Aerial photos by default: the street map shows almost nothing in the woods.
  const [layer, setLayer] = usePersistent(LS.mapLayer, "satellite");
  const sat = layer === "satellite";
  const tilesRef = useRef(null);
  const markersRef = useRef(new Map());
  // Moving pins: drag each camera to its real spot on the full-screen map, then save.
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moved, setMoved] = useState(0);
  const draftsRef = useRef({});
  const beginMove = () => { draftsRef.current = {}; setMoved(0); setMenu(false); setMoving(true); setFull(true); };
  const endMove = () => { draftsRef.current = {}; setMoving(false); setFull(false); };
  const saveMove = async () => {
    setSaving(true);
    const ok = await savePins(draftsRef.current);
    setSaving(false);
    if (ok) endMove();
  };
  const endRef = useRef(endMove);
  endRef.current = endMove;

  const cameraRef = useRef(filters.camera);
  cameraRef.current = filters.camera;
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");

  const beginEdit = (cam) => { setEditing(cam.name); setDraft(camName(cam.name)); };
  const cancelEdit = () => setEditing(null);
  const commitEdit = (cam) => { renameCamera(cam.name, draft); setEditing(null); };

  const cams = useMemo(
    () => data.cameras.filter((c) => c.latitude != null && c.longitude != null),
    [data.cameras]
  );
  // Each camera's count honors every filter except the camera one. Otherwise picking
  // a camera would zero out all the others and the markers would jump in size.
  // The counts are of animals: passing trucks, people and empty frames would say more
  // about the road than the deer. Picking one of those species on purpose counts it.
  const countByCam = useMemo(() => {
    const m = new Map();
    for (const c of filterCaptures(captures, { ...filters, camera: "All", gameOnly: true }, ov)) m.set(c.camera, (m.get(c.camera) || 0) + 1);
    return m;
  }, [captures, filters, ov]);
  const animalsOnly = !NOT_GAME.has(filters.species);
  const shown = useMemo(() => filterCaptures(captures, { ...filters, gameOnly: true }, ov).length, [captures, filters, ov]);
  const noun = animalsOnly ? "animal photo" : "photo";

  // (Re)create the map — also re-runs on theme change to swap tile colors.
  useEffect(() => {
    const L = window.L;
    if (!auth || !L || !elRef.current || !cams.length) return;
    const map = L.map(elRef.current, { zoomControl: true, scrollWheelZoom: true, dragging: !coarse() });
    mapRef.current = map;
    const pts = cams.map((c) => [c.latitude, c.longitude]);
    if (pts.length === 1) map.setView(pts[0], 13);
    else map.fitBounds(pts, { padding: [44, 44], maxZoom: 14 });
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; tilesRef.current = null; };
  }, [auth, cams, theme, leafletReady]);

  // Street map or aerial photos, swapped without moving the map.
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;
    if (tilesRef.current) tilesRef.current.remove();
    tilesRef.current = sat
      ? L.tileLayer(SAT_TILES, { maxZoom: 18, maxNativeZoom: 16, attribution: SAT_CREDIT })
      : L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_CREDIT, referrerPolicy: "strict-origin-when-cross-origin" });
    tilesRef.current.on("tileerror", () => setTrouble("Map pictures couldn’t load"));
    tilesRef.current.on("tileload", () => setTrouble(""));
    tilesRef.current.addTo(map);
  }, [sat, auth, cams, theme, leafletReady]);

  // Property lines, when turned on.
  const [parcels, setParcels] = usePersistent(LS.mapParcels, "off");
  const [parcelState, setParcelState] = useState("ok");
  const lines = parcels === "on";
  const zoomForLines = useRef(false);
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (!lines || !auth || !L || !map) return undefined;
    if (zoomForLines.current) {
      zoomForLines.current = false;
      if (map.getZoom() < PARCEL_ZOOM) map.setZoom(PARCEL_ZOOM, { animate: false });
    }
    return showParcels(L, map, setParcelState);
  }, [lines, auth, cams, theme, leafletReady]);
  const parcelNote = { zoom: "Zoom in to see property lines", loading: "Loading property lines",
    some: "Too many to show. Zoom in for the rest", error: "Property lines are unavailable right now",
    ok: "Approximate tax parcels, not a survey" }[parcelState];

  // Stands added on the Live wind map.
  useEffect(() => { loadStands(); }, [loadStands]);
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (moving || !auth || !L || !map) return undefined;
    const group = L.layerGroup().addTo(map);
    stands.forEach((s) => {
      const el = document.createElement("div");
      el.className = "windpin is-none";
      const b = document.createElement("b");
      b.textContent = s.name; // typed by people, so never as HTML
      el.append(b);
      L.marker([s.lat, s.lng], { interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0], html: el }) }).addTo(group);
    });
    return () => { group.remove(); };
  }, [stands, moving, auth, cams, theme, leafletReady]);

  // Where deer were taken, when turned on.
  const [harvestLayer, setHarvestLayer] = usePersistent(LS.mapHarvests, "off");
  const showHarvests = harvestLayer === "on";
  useEffect(() => { if (showHarvests) loadHarvests(); }, [showHarvests, loadHarvests]);
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (!showHarvests || moving || !auth || !L || !map) return undefined;
    const group = L.layerGroup().addTo(map);
    harvests.filter((h) => h.lat != null).forEach((h) => {
      const pin = document.createElement("div");
      pin.className = "harvestpin";
      const pop = document.createElement("div");
      pop.className = "vt-popup";
      const title = document.createElement("b");
      title.textContent = `${h.buck || h.kind} · ${h.hunter}`; // typed by people, so never as HTML
      const sub = document.createElement("span");
      sub.textContent = fmtDateLong(parseIsoDay(h.date));
      pop.append(title, sub);
      L.marker([h.lat, h.lng], { title: title.textContent,
        icon: L.divIcon({ className: "", iconSize: [44, 44], iconAnchor: [22, 22], html: pin }) }).bindPopup(pop).addTo(group);
    });
    return () => { group.remove(); };
  }, [showHarvests, harvests, moving, auth, cams, theme, leafletReady]);

  // Markers are rebuilt when counts or names change. Choosing a camera only re-rings
  // them (below): rebuilding would close the popup the tap just opened.
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!auth || !L || !map) return;
    if (layerRef.current) layerRef.current.remove();
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;
    markersRef.current = new Map();
    if (moving) {
      cams.forEach((cam) => {
        const el = document.createElement("div");
        el.className = "movepin";
        const name = document.createElement("b");
        name.textContent = camName(cam.name); // user-editable, so never as HTML
        el.append(name, document.createElement("i"));
        const mk = L.marker(draftsRef.current[cam.name] || [cam.latitude, cam.longitude], {
          draggable: true, autoPan: true, title: "Drag to move",
          icon: L.divIcon({ className: "", iconSize: [48, 48], iconAnchor: [24, 24], html: el }),
        }).addTo(group);
        mk.on("dragend", () => {
          const at = mk.getLatLng();
          draftsRef.current[cam.name] = [Number(at.lat.toFixed(5)), Number(at.lng.toFixed(5))];
          setMoved(Object.keys(draftsRef.current).length);
        });
      });
      return;
    }
    const maxC = Math.max(1, ...cams.map((c) => countByCam.get(c.name) || 0));
    cams.forEach((cam) => {
      const count = countByCam.get(cam.name) || 0;
      const size = Math.round(28 + (count / maxC) * 26);
      const mk = L.marker([cam.latitude, cam.longitude], { icon: markerIcon(L, size, count, cameraRef.current === cam.name) }).addTo(group);
      markersRef.current.set(cam.name, { mk, size, count });
      // Built as elements, not HTML: camera names are user-editable.
      const pop = document.createElement("div");
      pop.className = "vt-popup";
      const title = document.createElement("b");
      title.textContent = camName(cam.name);
      const sub = document.createElement("span");
      sub.textContent = `${count} photo${count === 1 ? "" : "s"}`;
      const go = document.createElement("button");
      go.className = "btn btn--primary btn--sm";
      go.textContent = "View photos";
      go.addEventListener("click", () => { setFilter({ camera: cam.name, gameOnly: true }); setView("gallery"); });
      pop.append(title, sub, go);
      mk.bindPopup(pop);
      mk.on("click", () => setFilter({ camera: cameraRef.current === cam.name ? "All" : cam.name }));
    });
  }, [auth, cams, countByCam, camName, leafletReady, setFilter, setView, moving]);

  useEffect(() => {
    const L = window.L;
    if (!L) return;
    for (const [name, m] of markersRef.current) m.mk.setIcon(markerIcon(L, m.size, m.count, filters.camera === name));
  }, [filters.camera, auth, cams, countByCam, camName, leafletReady]);

  // Full-screen map: dragging on, the page held still, Escape or the X to close.
  useEffect(() => {
    const map = mapRef.current;
    if (map && coarse()) { if (full) map.dragging.enable(); else map.dragging.disable(); }
    requestAnimationFrame(() => { const m = mapRef.current; if (m) m.invalidateSize(); });
    if (!full) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") endRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { root.style.overflow = before; window.removeEventListener("keydown", onKey); };
  }, [full, leafletReady]);

  // Keep Leaflet sized to its container when the viewport changes — rotating a
  // phone (portrait<->landscape) or resizing the window otherwise leaves gray,
  // misaligned tiles until the next pan. invalidateSize() re-measures the map.
  useEffect(() => {
    const sync = () => { const m = mapRef.current; if (m) m.invalidateSize(); };
    const onResize = () => requestAnimationFrame(sync);
    const onOrient = () => { requestAnimationFrame(sync); setTimeout(sync, 350); };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrient);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrient);
    };
  }, []);

  if (!auth) {
    return html`<div className="map-access">
      <${Empty} icon="map" title="Sign in to view the map"
        message="Camera locations are only available when you're signed in."
        action=${html`<${Btn} variant="primary" icon="user" onClick=${() => openSignIn("Sign in to view camera locations on the map.")}>Sign in</${Btn}>`} />
    </div>`;
  }

  if (!cams.length) {
    return html`<div className="col" style=${{ gap: 4 }}>
      <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras} speciesList=${spList} count=${shown} noun=${noun} camName=${camName} />
      <${Empty} icon="map" title="No camera locations yet"
        message="When your cameras report GPS coordinates they'll appear here on the map." />
    </div>`;
  }

  const selected = filters.camera !== "All" ? cams.find((c) => c.name === filters.camera) : null;
  const lastByCam = new Map(cameraStatus(captures, data.cameras).map((r) => [r.camera, r.last]));
  // Under each camera: its newest photo, battery and signal, and anything needing a visit.
  const rowMeta = (cam) => {
    const last = lastByCam.get(cam.name);
    const items = healthItems(cam.health).filter((h) => h.key === "bat" || h.key === "sig" || h.warn);
    return html`<div className="camrow__meta">
      <span>${last ? `Last photo ${timeAgo(last)}` : "No photos yet"}</span>
      ${items.map((h) => html`<span key=${h.key} className=${cx("camrow__stat", h.warn && "is-warn")} title=${h.title}>${h.text}</span>`)}
    </div>`;
  };
  const rows = [...cams].sort((a, b) => (countByCam.get(b.name) || 0) - (countByCam.get(a.name) || 0));

  return html`<div className="col" style=${{ gap: 4 }}>
    <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras} speciesList=${spList} count=${shown} noun=${noun} camName=${camName} />

    ${selected && html`<div className="row wrap" style=${{ marginBottom: 14, gap: 10 }}>
      <${Chip} active dotColor="var(--accent)" onClear=${() => setFilter({ camera: "All" })}>${camName(selected.name)}</${Chip}>
      <div className="spacer" />
      <${Btn} sm variant="primary" iconRight="arrowRight" onClick=${() => { setFilter({ gameOnly: true }); setView("gallery"); }}>
        View ${(countByCam.get(selected.name) || 0)} in Photos
      </${Btn}>
    </div>`}

    <div className="mapwrap">
      <div className="camlist">
        ${rows.map((cam) => editing === cam.name
          ? html`<div key=${cam.id} className="camrow is-editing">
              <span className="camrow__pin"><${Icon} name="pencil" size=${16} /></span>
              <input className="camrow__input" autoFocus value=${draft}
                onInput=${(e) => setDraft(e.target.value)}
                onKeyDown=${(e) => {
                  if (e.key === "Enter") commitEdit(cam);
                  else if (e.key === "Escape") cancelEdit();
                }}
                placeholder=${cam.name} />
              <button className="camrow__act" title="Save" onClick=${() => commitEdit(cam)}><${Icon} name="check" size=${16} /></button>
              <button className="camrow__act" title="Cancel" onClick=${cancelEdit}><${Icon} name="x" size=${16} /></button>
            </div>`
          : html`<div key=${cam.id} className=${cx("camrow", filters.camera === cam.name && "is-active")}>
              <button className="camrow__hit"
                onClick=${() => setFilter({ camera: filters.camera === cam.name ? "All" : cam.name })}>
                <span className="camrow__pin"><${Icon} name="pin" size=${18} /></span>
                <div className="camrow__body">
                  <div className="camrow__name">${camName(cam.name)}</div>
                  ${rowMeta(cam)}
                </div>
                <span className="camrow__count tnum">${countByCam.get(cam.name) || 0}</span>
              </button>
              <button className="camrow__edit" title="Rename camera" onClick=${() => beginEdit(cam)}>
                <${Icon} name="pencil" size=${15} />
              </button>
            </div>`)}
      </div>
      <div className=${cx("mapbox", full && "is-full")}>
        <div className=${cx("map", sat && "is-sat")} ref=${elRef} />
        ${trouble && html`<div className="mapbox__note is-low" role="status">${trouble}</div>`}
        ${lines && html`<div className="mapbox__note" role="status">${parcelNote}</div>`}
        ${data.canPin && !moving && html`<button type="button" className="mapbox__move" onClick=${beginMove}>
          <${Icon} name="pin" size=${16} />Move pins
        </button>`}
        ${!moving && html`<button type="button" className="mapbox__move is-second" onClick=${() => openWind({ start: "new" })}>
          <${Icon} name="stand" size=${16} />Add stand
        </button>`}
        ${moving && html`<div className="movebar" role="region" aria-label="Move pins">
          <span>${moved ? `${moved} pin${moved === 1 ? "" : "s"} moved` : "Drag each pin to its exact spot"}</span>
          <div className="row gap-sm">
            <${Btn} sm onClick=${endMove} disabled=${saving}>Cancel</${Btn}>
            <${Btn} sm variant="primary" icon="check" onClick=${saveMove} disabled=${!moved || saving}>${saving ? "Saving" : "Save"}</${Btn}>
          </div>
        </div>`}
        <div className="mapbox__tools">
          <button type="button" className="mapbox__pill" onClick=${() => (moving ? endMove() : setFull(!full))}>
            <${Icon} name=${full ? "x" : "expand"} size=${17} />${full ? "Close" : "Full screen"}
          </button>
          <button type="button" className="mapbox__pill" aria-expanded=${menu} onClick=${() => setMenu(!menu)}>
            <${Icon} name="layers" size=${17} />Layers
          </button>
          ${menu && html`<div className="mapbox__menu" role="group" aria-label="Map layers">
            ${[["Satellite photos", sat, () => setLayer(sat ? "map" : "satellite")],
              ["Property lines", lines, () => { zoomForLines.current = !lines; setParcels(lines ? "off" : "on"); }],
              ["Harvests", showHarvests, () => setHarvestLayer(showHarvests ? "off" : "on")]].map(([label, on, flip]) => html`
              <button type="button" key=${label} role="switch" aria-checked=${on} onClick=${flip}>
                <span>${label}</span><i className=${on ? "is-on" : ""} /></button>`)}
          </div>`}
        </div>
      </div>
    </div>
  </div>`;
}
