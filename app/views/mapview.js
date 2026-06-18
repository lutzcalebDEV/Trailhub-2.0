// Vale Trails — Map: camera locations with activity-scaled markers (Leaflet).
import { html, useEffect, useRef, useMemo } from "../react.js";
import { FilterBar } from "../shell.js";
import { Icon } from "../icons.js";
import { Empty, Btn, Chip } from "../ui.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");
const TILES = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
};

export function MapView(app) {
  const { data, filtered, filters, setFilter, setView, spList, theme } = app;
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  const cams = useMemo(
    () => data.cameras.filter((c) => c.latitude != null && c.longitude != null),
    [data.cameras]
  );
  const countByCam = useMemo(() => {
    const m = new Map();
    for (const c of filtered) m.set(c.camera, (m.get(c.camera) || 0) + 1);
    return m;
  }, [filtered]);

  // (Re)create the map — also re-runs on theme change to swap tile colors.
  useEffect(() => {
    const L = window.L;
    if (!L || !elRef.current || !cams.length) return;
    const map = L.map(elRef.current, { zoomControl: true, scrollWheelZoom: true });
    L.tileLayer(theme === "light" ? TILES.light : TILES.dark, {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);
    mapRef.current = map;
    const pts = cams.map((c) => [c.latitude, c.longitude]);
    if (pts.length === 1) map.setView(pts[0], 13);
    else map.fitBounds(pts, { padding: [44, 44], maxZoom: 14 });
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, [cams, theme]);

  // Redraw markers whenever counts or the active camera change.
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;
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
      mk.bindPopup(`<b>${cam.name}</b><br>${count} capture${count === 1 ? "" : "s"}`);
      mk.on("click", () => setFilter({ camera: filters.camera === cam.name ? "All" : cam.name }));
    });
  }, [cams, countByCam, filters.camera]);

  if (!cams.length) {
    return html`<div className="col" style=${{ gap: 4 }}>
      <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras} speciesList=${spList} count=${filtered.length} />
      <${Empty} icon="map" title="No camera locations yet"
        message="When your cameras report GPS coordinates they'll appear here on the map." />
    </div>`;
  }

  const selected = filters.camera !== "All" ? cams.find((c) => c.name === filters.camera) : null;
  const rows = [...cams].sort((a, b) => (countByCam.get(b.name) || 0) - (countByCam.get(a.name) || 0));

  return html`<div className="col" style=${{ gap: 4 }}>
    <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras} speciesList=${spList} count=${filtered.length} />

    ${selected && html`<div className="row wrap" style=${{ marginBottom: 14, gap: 10 }}>
      <${Chip} active dotColor="var(--accent)" onClear=${() => setFilter({ camera: "All" })}>${selected.name}</${Chip}>
      <div className="spacer" />
      <${Btn} sm variant="primary" iconRight="arrowRight" onClick=${() => setView("gallery")}>
        View ${(countByCam.get(selected.name) || 0)} in Gallery
      </${Btn}>
    </div>`}

    <div className="mapwrap">
      <div className="camlist">
        ${rows.map((cam) => html`<button key=${cam.id}
          className=${cx("camrow", filters.camera === cam.name && "is-active")}
          onClick=${() => setFilter({ camera: filters.camera === cam.name ? "All" : cam.name })}>
          <span className="camrow__pin"><${Icon} name="pin" size=${18} /></span>
          <div style=${{ minWidth: 0 }}>
            <div className="camrow__name">${cam.name}</div>
            <div className="camrow__meta">${cam.latitude.toFixed(4)}, ${cam.longitude.toFixed(4)}</div>
          </div>
          <span className="camrow__count tnum">${countByCam.get(cam.name) || 0}</span>
        </button>`)}
      </div>
      <div className="map" ref=${elRef} />
    </div>
  </div>`;
}
