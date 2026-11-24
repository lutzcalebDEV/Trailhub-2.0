// Vale Trails — Harvests: the deer taken, when and where. Shared with everyone signed
// in; each person changes their own entries, and an admin can change any.
import { html, useState, useEffect, useRef } from "../react.js";
import { Btn, Empty, Panel, Stat, Segmented } from "../ui.js";
import { Icon } from "../icons.js";
import { isoDay, parseIsoDay, fmtDateLong, fmtTime, newUploadId, uploadPhoto, uploadThumb, uploadImageUrl, StorageFull } from "../core.js";
import { siteOf, conditionsAt } from "../deercast.js";
import { prepare } from "../upload.js";
import { allStands } from "./livewind.js";
import { loadLeaflet, SAT_TILES, SAT_CREDIT } from "./mapview.js";

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const timeLabel = (t) => { const [h, m] = t.split(":").map(Number); return fmtTime(new Date(2000, 0, 1, h, m)); };
const whenOf = (h) => `${h.date}T${h.time}`;
// The hunting year runs July through June.
const season = (iso) => { const [y, m] = iso.split("-").map(Number); return m >= 7 ? y : y - 1; };
const seasonName = (y) => `${y}–${String((y + 1) % 100).padStart(2, "0")} season`;

/* ------------------------------- Spot map --------------------------------- */
// Shows harvest spots, or with `onPick` lets one be tapped (or dragged) into place.
function SpotMap({ spots, center, onPick }) {
  const el = useRef(null), mapRef = useRef(null), pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [ready, setReady] = useState(() => !!window.L);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    loadLeaflet().then(() => { if (live) setReady(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [ready]);
  useEffect(() => {
    const L = window.L;
    if (!ready || !L) return undefined;
    const map = L.map(el.current, { scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    mapRef.current = map;
    const first = spots.length ? spots.map((s) => [s.lat, s.lng]) : [center];
    if (first.length > 1) map.fitBounds(first, { padding: [40, 40], maxZoom: 16 });
    else map.setView(first[0], 16);
    L.tileLayer(SAT_TILES, { maxZoom: 18, maxNativeZoom: 16, attribution: SAT_CREDIT }).addTo(map);
    if (onPick) map.on("click", (e) => pickRef.current([e.latlng.lat, e.latlng.lng]));
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, [ready]);
  const key = spots.map((s) => [s.id, s.lat, s.lng, s.label].join()).join(";");
  useEffect(() => {
    const L = window.L, map = mapRef.current;
    if (!L || !map) return undefined;
    const group = L.layerGroup().addTo(map);
    spots.forEach((s) => {
      const pin = document.createElement("div");
      pin.className = "harvestpin";
      const mk = L.marker([s.lat, s.lng], { draggable: !!onPick, title: s.label || "",
        icon: L.divIcon({ className: "", iconSize: [44, 44], iconAnchor: [22, 22], html: pin }) }).addTo(group);
      if (onPick) mk.on("dragend", () => { const p = mk.getLatLng(); pickRef.current([p.lat, p.lng]); });
      else { const t = document.createElement("span"); t.textContent = s.label; mk.bindPopup(t); }
    });
    // A spot set away from the map (a stand, or this phone's location) is brought into view.
    if (onPick && spots[0] && !map.getBounds().pad(-0.1).contains([spots[0].lat, spots[0].lng])) {
      map.setView([spots[0].lat, spots[0].lng], Math.max(16, map.getZoom()));
    }
    return () => { group.remove(); };
  }, [ready, key]);
  if (failed) return html`<p className="form-note">The map couldn't load. You can still save with a place name.</p>`;
  return html`<div className="spotmap map is-sat" ref=${el} />`;
}

/* ---------------------------------- Form ---------------------------------- */
// A photo goes up like any other upload (shrunk, its GPS removed), listed under "Other
// camera" so it never counts as a camera sighting.
async function sendPhoto(file, when, kind, buck, auth) {
  const id = newUploadId();
  const { full, thumb } = await prepare(file);
  let hasThumb = false;
  try { await uploadThumb(thumb, id, auth); hasThumb = true; } catch (e) { if (e instanceof StorageFull) throw e; }
  await uploadPhoto(full, { id, date: when.toISOString(), camera: "Other camera", species: kind, comment: "", author: "", buck, thumb: hasThumb }, auth, () => {});
  return id;
}

function HarvestForm({ app, entry, startBuck, onDone }) {
  const { data, auth, saveHarvest, removeHarvest, buckNames } = app;
  const now = new Date();
  const [date, setDate] = useState(entry ? entry.date : isoDay(now));
  const [time, setTime] = useState(entry ? entry.time : hhmm(now));
  const [kind, setKind] = useState(entry ? entry.kind : "Buck");
  const [hunter, setHunter] = useState(entry ? entry.hunter : auth.user);
  const [place, setPlace] = useState(entry ? entry.place : "");
  const [spot, setSpot] = useState(entry && entry.lat != null ? [entry.lat, entry.lng] : null);
  const [buck, setBuck] = useState(entry ? entry.buck || "" : startBuck || "");
  const [photo, setPhoto] = useState(entry ? entry.photo || "" : "");
  const [file, setFile] = useState(null); // a new photo, sent when saved
  const [preview, setPreview] = useState("");
  const fileRef = useRef(null);
  useEffect(() => {
    if (!file) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const [notes, setNotes] = useState(entry ? entry.notes : "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const site = siteOf(data);
  useEffect(() => { app.loadStands(); }, [app.loadStands]);
  const stands = allStands(app);
  useEffect(() => { if (spot || place.trim()) setError(""); }, [spot, place]);

  const locate = () => {
    setError("");
    if (!navigator.geolocation) { setError("This device can't share its location. Tap the map instead."); return; }
    setBusy("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(""); setSpot([p.coords.latitude, p.coords.longitude]); },
      () => { setBusy(""); setError("Couldn't get your location. Tap the map instead."); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (new Date(`${date}T${time}`) > new Date()) { setError("That date and time hasn't happened yet."); return; }
    if (!spot && !place.trim()) { setError("Add a location: choose a stand, tap the map, or type a place."); return; }
    setError(""); setBusy("saving");
    const when = new Date(`${date}T${time}`);
    let photoId = photo;
    if (file) {
      try {
        photoId = await sendPhoto(file, when, kind, kind === "Buck" ? buck.trim() : "", auth);
        // Kept, so trying the save again doesn't send it twice.
        setPhoto(photoId); setFile(null);
      } catch (err) {
        setBusy("");
        setError(err instanceof StorageFull ? "Photo storage is full. Remove the photo to save without it." : "The photo didn't upload. Try again, or remove it to save without it.");
        return;
      }
    }
    const same = entry && entry.date === date && entry.time === time;
    const conditions = (same && entry.conditions) || conditionsAt(data, app.captures, app.ov, when);
    const ok = await saveHarvest({
      ...(entry ? { id: entry.id } : {}), date, time, kind, hunter: hunter.trim() || auth.user,
      place: place.trim(), lat: spot ? spot[0] : null, lng: spot ? spot[1] : null, notes: notes.trim(),
      buck: kind === "Buck" ? buck.trim() : "", photo: photoId, conditions,
    });
    setBusy("");
    if (ok) onDone();
  };
  const remove = async () => {
    if (!window.confirm("Delete this harvest for everyone?")) return;
    setBusy("deleting");
    const ok = await removeHarvest(entry.id);
    setBusy("");
    if (ok) onDone();
  };

  return html`<form className="harvestform" onSubmit=${submit}>
    <${Panel} title=${entry ? "Edit harvest" : "Log a harvest"}>
      <div className="harvestform__grid">
        <label className="field-row"><span>Date</span>
          <input className="input" type="date" required max=${isoDay(now)} value=${date} onInput=${(e) => setDate(e.target.value)} /></label>
        <label className="field-row"><span>Time</span>
          <input className="input" type="time" required value=${time} onInput=${(e) => setTime(e.target.value)} /></label>
        <div className="field-row"><span>Deer</span>
          <${Segmented} value=${kind} onChange=${setKind} label="Deer" options=${[{ value: "Buck", label: "Buck" }, { value: "Doe", label: "Doe" }]} /></div>
        <label className="field-row"><span>Hunter</span>
          <input className="input" maxLength=${40} value=${hunter} onInput=${(e) => setHunter(e.target.value)} /></label>
      </div>

      ${kind === "Buck" && html`<label className="field-row"><span>Buck name (optional)</span>
        <input className="input" list="harvest-bucks" maxLength=${40} value=${buck} placeholder="e.g. Big 8" onInput=${(e) => setBuck(e.target.value)} />
        <datalist id="harvest-bucks">${(buckNames || []).map((n) => html`<option key=${n} value=${n} />`)}</datalist></label>`}

      <div className="harvestform__loc">
        <div className="field-row"><span>Location</span></div>
        <div className="harvestform__chips">
          ${stands.map((s) => html`<button type="button" key=${s.id} className=${"chip" + (place === s.label ? " is-active" : "")}
            onClick=${() => { setPlace(s.label); setSpot([s.latitude, s.longitude]); }}>${s.label}</button>`)}
          <button type="button" className="chip" onClick=${locate} disabled=${busy === "locating"}>
            <${Icon} name="target" size=${14} />${busy === "locating" ? "Finding you" : "My location"}</button>
        </div>
        ${site && html`<${SpotMap} center=${[site.lat, site.lng]} onPick=${setSpot}
          spots=${spot ? [{ id: "pick", lat: spot[0], lng: spot[1], label: "Harvest spot" }] : []} />`}
        <p className="form-note">${spot ? "Tap the map or drag the pin to adjust it." : "Choose a stand or tap the map where the deer was."}
          ${spot && html` <button type="button" className="lb__link" onClick=${() => setSpot(null)}>Clear pin</button>`}</p>
        <label className="field-row"><span>Place name (optional with a pin)</span>
          <input className="input" maxLength=${60} value=${place} placeholder="e.g. Creek bottom" onInput=${(e) => setPlace(e.target.value)} /></label>
      </div>

      <div className="harvestform__photo">
        <input ref=${fileRef} type="file" accept="image/*" hidden
          onChange=${(e) => { const f = e.target.files[0]; if (f) setFile(f); e.target.value = ""; }} />
        ${(preview || photo) && html`<img src=${preview || uploadImageUrl(photo)} alt="Harvest" onError=${(e) => { e.target.style.visibility = "hidden"; }} />`}
        <${Btn} type="button" icon="camera" disabled=${!!busy} onClick=${() => fileRef.current.click()}>${file || photo ? "Change photo" : "Add a photo"}</${Btn}>
        ${(file || photo) && html`<${Btn} type="button" variant="ghost" disabled=${!!busy} onClick=${() => { setFile(null); setPhoto(""); }}>Remove</${Btn}>`}
      </div>

      <label className="field-row"><span>Notes (optional)</span>
        <textarea className="input" rows=${3} maxLength=${300} value=${notes} placeholder="Points, weight, weapon…" onInput=${(e) => setNotes(e.target.value)} /></label>
      ${error && html`<p className="form-error" role="alert">${error}</p>`}
      <div className="harvestform__foot">
        ${entry && html`<${Btn} type="button" icon="trash" variant="ghost" disabled=${!!busy} onClick=${remove}>${busy === "deleting" ? "Deleting" : "Delete"}</${Btn}>`}
        <div className="spacer" />
        <${Btn} type="button" disabled=${!!busy} onClick=${onDone}>Cancel</${Btn}>
        <${Btn} type="submit" variant="primary" icon="check" disabled=${!!busy}>${busy === "saving" ? "Saving" : "Save"}</${Btn}>
      </div>
    </${Panel}>
  </form>`;
}

function HarvestPhoto({ h, allCaptures, openLightbox }) {
  const [gone, setGone] = useState(false);
  const c = allCaptures.find((x) => String(x.id) === h.photo);
  if (gone) return null;
  const img = html`<img src=${c ? c.thumb || c.image : uploadImageUrl(h.photo)} alt=${`${h.kind} taken by ${h.hunter}`} loading="lazy" onError=${() => setGone(true)} />`;
  return c ? html`<button type="button" className="harvest__photo" aria-label="Open photo" onClick=${() => openLightbox([c], 0)}>${img}</button>`
    : html`<div className="harvest__photo">${img}</div>`;
}
const conditionsText = (c) => [c.score != null && `DeerCast ${c.score}/10`, c.temp != null && `${c.temp}°`,
  c.wind != null && `${c.dir} ${c.wind} mph`, c.pressure != null && `${c.pressure.toFixed(2)} inHg`].filter(Boolean).join(" · ");

/* ---------------------------------- Page ---------------------------------- */
// "Log this buck" on a buck's page opens the form with its name filled in.
let openWith = null;
export const startHarvest = (buck) => { openWith = buck || ""; };

export function Harvests(app) {
  const { harvests, harvestsReady, loadHarvests, auth, allCaptures, openLightbox } = app;
  const [startBuck] = useState(() => { const b = openWith; openWith = null; return b; });
  const [form, setForm] = useState(startBuck != null ? "new" : null); // null, "new", or an entry
  useEffect(() => { loadHarvests(); }, [loadHarvests]);
  const close = () => { setForm(null); window.scrollTo(0, 0); };
  if (form) return html`<${HarvestForm} app=${app} entry=${form === "new" ? null : form} startBuck=${startBuck} onDone=${close} />`;

  if (harvestsReady === "error" && !harvests.length) {
    return html`<${Empty} icon="tag" title="Couldn't load harvests" message="Check your connection and try again."
      action=${html`<${Btn} icon="refresh" onClick=${loadHarvests}>Try again</${Btn}>`} />`;
  }
  if (harvestsReady === "loading" && !harvests.length) return html`<p className="faint">Loading harvests…</p>`;
  const list = [...harvests].sort((a, b) => whenOf(b).localeCompare(whenOf(a)));
  const add = html`<${Btn} variant="primary" icon="tag" onClick=${() => setForm("new")}>Log a harvest</${Btn}>`;
  if (!list.length) {
    return html`<${Empty} icon="tag" title="No harvests yet" message="Log a deer with its date, time and location. Everyone signed in can see it." action=${add} />`;
  }
  const cur = season(isoDay(new Date()));
  const mine = list.filter((h) => season(h.date) === cur);
  const spots = list.filter((h) => h.lat != null).map((h) => ({ id: h.id, lat: h.lat, lng: h.lng,
    label: `${h.kind}, ${fmtDateLong(parseIsoDay(h.date))}, ${h.hunter}` }));
  const seasons = [...new Set(list.map((h) => season(h.date)))];
  const canEdit = (h) => auth && (auth.admin || String(h.by).toLowerCase() === String(auth.user).toLowerCase());

  return html`<div className="col" style=${{ gap: 18 }}>
    <div className="row">${add}</div>
    <div className="grid grid--stats">
      <${Stat} label="This season" value=${mine.length} sub=${seasonName(cur)} />
      <${Stat} label="Bucks" value=${mine.filter((h) => h.kind === "Buck").length} sub="This season" />
      <${Stat} label="Does" value=${mine.filter((h) => h.kind === "Doe").length} sub="This season" />
    </div>
    ${spots.length > 0 && html`<${SpotMap} key=${spots.map((s) => s.id + s.lat + s.lng).join()} spots=${spots} />`}
    ${seasons.map((y) => html`<${Panel} key=${y} title=${seasonName(y)}>
      <ul className="harvests">
        ${list.filter((h) => season(h.date) === y).map((h) => html`<li key=${h.id} className="harvest">
          ${h.photo && html`<${HarvestPhoto} h=${h} allCaptures=${allCaptures} openLightbox=${openLightbox} />`}
          <div className="harvest__body">
            <b>${h.buck || h.kind} · ${h.hunter}</b>
            <span>${fmtDateLong(parseIsoDay(h.date))}, ${timeLabel(h.time)}</span>
            <span><${Icon} name="pin" size=${13} />${h.place || "Pinned on the map"}</span>
            ${h.conditions && html`<span>${conditionsText(h.conditions)}</span>`}
            ${h.notes && html`<p>${h.notes}</p>`}
          </div>
          ${canEdit(h) && html`<${Btn} sm icon="pencil" onClick=${() => { setForm(h); window.scrollTo(0, 0); }}>Edit</${Btn}>`}
        </li>`)}
      </ul>
    </${Panel}>`)}
    <p className="form-note">This is your family's record. It doesn't report the harvest to the state.</p>
  </div>`;
}
