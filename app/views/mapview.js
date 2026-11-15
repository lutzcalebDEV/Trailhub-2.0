// Vale Trails — Map: camera locations with activity-scaled markers (Leaflet).
import { html, useEffect, useRef, useMemo, useState } from "../react.js";
import { FilterBar } from "../shell.js";
import { Icon } from "../icons.js";
import { Empty, Btn, Chip } from "../ui.js";
import { filterCaptures } from "../analytics.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
// OpenStreetMap's public tiles: open data, no API key or account. Its usage policy
// requires the attribution below and a Referer header.
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Leaflet (~160 KB) is only needed here, so it loads the first time the map opens
// instead of on every app start. Its stylesheet goes in before app/styles.css so the
// app's .leaflet-* overrides still win. Both files are in the service worker shell.
let leafletLoad = null;
function loadLeaflet() {
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

export function MapView(app) {
  const { data, captures, ov, filtered, filters, setFilter, setView, spList, theme, camName, renameCamera, auth, openSignIn } = app;
  const [leafletReady, setLeafletReady] = useState(() => !!window.L);
  useEffect(() => {
    if (leafletReady) return;
    let live = true;
    loadLeaflet().then(() => { if (live) setLeafletReady(true); }).catch(() => {});
    return () => { live = false; };
  }, [leafletReady]);
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
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
  const countByCam = useMemo(() => {
    const m = new Map();
    for (const c of filterCaptures(captures, { ...filters, camera: "All" }, ov)) m.set(c.camera, (m.get(c.camera) || 0) + 1);
    return m;
  }, [captures, filters, ov]);

  // (Re)create the map — also re-runs on theme change to swap tile colors.
  useEffect(() => {
    const L = window.L;
    if (!auth || !L || !elRef.current || !cams.length) return;
    const map = L.map(elRef.current, { zoomControl: true, scrollWheelZoom: true });
    L.tileLayer(OSM_TILES, {
      maxZoom: 19,
      attribution: OSM_CREDIT,
      referrerPolicy: "strict-origin-when-cross-origin",
    }).addTo(map);
    mapRef.current = map;
    const pts = cams.map((c) => [c.latitude, c.longitude]);
    if (pts.length === 1) map.setView(pts[0], 13);
    else map.fitBounds(pts, { padding: [44, 44], maxZoom: 14 });
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, [auth, cams, theme, leafletReady]);

  // Redraw markers whenever counts or the active camera change.
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!auth || !L || !map) return;
    if (layerRef.current) layerRef.current.remove();
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;
    const maxC = Math.max(1, ...cams.map((c) => countByCam.get(c.name) || 0));
    cams.forEach((cam) => {
      const count = countByCam.get(cam.name) || 0;
      const size = Math.round(28 + (count / maxC) * 26);
      const active = filters.camera === cam.name;
      const markup = `<div class="vt-marker" style="width:${size}px;height:${size}px;${active ? "outline:3px solid var(--accent);outline-offset:2px;" : ""}">${count}</div>`;
      const icon = L.divIcon({ className: "", html: markup, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      const mk = L.marker([cam.latitude, cam.longitude], { icon }).addTo(group);
      // Leaflet renders popups as HTML and camera names are user-editable, so escape them.
      mk.bindPopup(`<b>${escapeHtml(camName(cam.name))}</b><br>${count} photo${count === 1 ? "" : "s"}`);
      mk.on("click", () => setFilter({ camera: filters.camera === cam.name ? "All" : cam.name }));
    });
  }, [auth, cams, countByCam, filters.camera, camName, leafletReady]);

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
      <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras} speciesList=${spList} count=${filtered.length} camName=${camName} />
      <${Empty} icon="map" title="No camera locations yet"
        message="When your cameras report GPS coordinates they'll appear here on the map." />
    </div>`;
  }

  const selected = filters.camera !== "All" ? cams.find((c) => c.name === filters.camera) : null;
  const rows = [...cams].sort((a, b) => (countByCam.get(b.name) || 0) - (countByCam.get(a.name) || 0));

  return html`<div className="col" style=${{ gap: 4 }}>
    <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras} speciesList=${spList} count=${filtered.length} camName=${camName} />

    ${selected && html`<div className="row wrap" style=${{ marginBottom: 14, gap: 10 }}>
      <${Chip} active dotColor="var(--accent)" onClear=${() => setFilter({ camera: "All" })}>${camName(selected.name)}</${Chip}>
      <div className="spacer" />
      <${Btn} sm variant="primary" iconRight="arrowRight" onClick=${() => setView("gallery")}>
        View ${(countByCam.get(selected.name) || 0)} in Gallery
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
                  <div className="camrow__meta">Approximate location</div>
                </div>
                <span className="camrow__count tnum">${countByCam.get(cam.name) || 0}</span>
              </button>
              <button className="camrow__edit" title="Rename camera" onClick=${() => beginEdit(cam)}>
                <${Icon} name="pencil" size=${15} />
              </button>
            </div>`)}
      </div>
      <div className="map" ref=${elRef} />
    </div>
  </div>`;
}
