// Vale Trails — property lines for the map: North Carolina's public tax parcels
// (NC OneMap, which carries the county's own parcel data). Free, no key. Only lines,
// acres and parcel numbers are asked for; owners' names aren't.
// The state runs the same layer on two hosts. Either can stall for many seconds, so the
// second is asked when the first hasn't answered quickly; the first good reply wins.
const HOSTS = ["https://services.gis.nc.gov", "https://services.nconemap.gov"];
const PATH = "/secure/rest/services/NC1Map_Parcels/MapServer/1/query?";
const SECOND_AFTER = 4000;
async function askHost(host, query, signal) {
  const r = await fetch(host + PATH + query, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!r.ok) throw new Error("parcels " + r.status);
  const data = await r.json();
  if (!Array.isArray(data.features)) throw new Error("parcels reply");
  return data;
}
async function askParcels(query, signal) {
  const first = askHost(HOSTS[0], query, signal);
  const second = new Promise((res) => {
    const t = setTimeout(res, SECOND_AFTER);
    first.then(() => clearTimeout(t), () => { clearTimeout(t); res(); });
  }).then(() => askHost(HOSTS[1], query, signal));
  return Promise.any([first, second]);
}
export const PARCEL_ZOOM = 15; // further out the lines would be a blur
export const PARCEL_CREDIT = 'Parcels: <a href="https://www.nconemap.gov/">NC OneMap</a>';

// Keeps a Leaflet map's property lines up to date as it moves. `onState` hears "zoom"
// (too far out), "loading", "ok", "some" (more than one reply holds) or "error".
// Returns a function that takes the lines away.
export function showParcels(L, map, onState) {
  const renderer = L.canvas({ padding: 0.3 });
  const layer = L.geoJSON(null, {
    renderer,
    style: { color: "#ffd84d", weight: 1.6, opacity: 0.95, fill: true, fillOpacity: 0 },
    onEachFeature(f, shape) {
      shape.bindPopup(() => {
        const p = f.properties || {};
        const box = document.createElement("div");
        box.className = "vt-popup";
        const title = document.createElement("b");
        title.textContent = Number(p.gisacres) > 0 ? `${Number(p.gisacres).toFixed(2)} acres` : "Parcel";
        const sub = document.createElement("span");
        sub.textContent = p.parno ? `Parcel ${p.parno}` : "";
        box.append(title, sub);
        return box;
      });
    },
  }).addTo(map);
  map.attributionControl.addAttribution(PARCEL_CREDIT);
  let request = null, have = null, timer = 0, gone = false;

  const load = async () => {
    if (gone) return;
    if (map.getZoom() < PARCEL_ZOOM) {
      if (request) request.abort();
      layer.clearLayers(); have = null; onState("zoom");
      return;
    }
    const seen = map.getBounds();
    if (have && have.contains(seen)) { onState("ok"); return; }
    const area = seen.pad(0.15);
    if (request) request.abort();
    const mine = (request = new AbortController());
    const timeout = setTimeout(() => mine.abort(), 30000);
    onState("loading");
    try {
      const q = new URLSearchParams({
        where: "1=1", geometry: [area.getWest(), area.getSouth(), area.getEast(), area.getNorth()].map((v) => v.toFixed(5)).join(","),
        geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects",
        outFields: "parno,gisacres", returnGeometry: "true", geometryPrecision: "5", maxAllowableOffset: "0.00001", f: "geojson",
      });
      const data = await askParcels(q, mine.signal);
      if (gone || mine !== request) return;
      layer.clearLayers();
      layer.addData(data);
      const cut = !!(data.exceededTransferLimit || (data.properties && data.properties.exceededTransferLimit));
      have = cut ? null : area;
      onState(cut ? "some" : "ok");
    } catch (e) {
      // A newer request took over, or the layer is gone: not an error.
      if (!gone && mine === request) onState("error");
    } finally { clearTimeout(timeout); }
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  map.on("moveend zoomend", soon);
  load();
  return () => {
    gone = true;
    clearTimeout(timer);
    if (request) request.abort();
    map.off("moveend zoomend", soon);
    if (map.attributionControl) map.attributionControl.removeAttribution(PARCEL_CREDIT);
    layer.remove();
    renderer.remove();
  };
}
