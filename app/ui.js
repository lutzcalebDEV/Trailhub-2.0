// Vale Trails — reusable UI primitives, chart widgets, photo tile and lightbox.
// Pure presentation: all data shaping happens in the views. Components map 1:1
// to the classes defined in styles.css.
import { html, useEffect, useRef, useState, Fragment } from "./react.js";
import { Icon } from "./icons.js";
import {
  speciesColor, fmtDate, fmtDateTime, timeAgo, labelHour, isoDay, TAG_OPTIONS, toLocalInput,
} from "./core.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");

/* ------------------------------- Buttons -------------------------------- */
export function Btn({ variant, sm, icon, iconRight, children, className = "", ...rest }) {
  return html`<button
    className=${cx("btn", variant && `btn--${variant}`, sm && "btn--sm", className)} ...${rest}>
    ${icon && html`<${Icon} name=${icon} size=${sm ? 15 : 16} />`}
    ${children != null && html`<span>${children}</span>`}
    ${iconRight && html`<${Icon} name=${iconRight} size=${sm ? 15 : 16} />`}
  </button>`;
}

export function IconBtn({ icon, bare, size = 18, className = "", ...rest }) {
  return html`<button className=${cx("iconbtn", bare && "iconbtn--bare", className)} ...${rest}>
    <${Icon} name=${icon} size=${size} />
  </button>`;
}

/* --------------------------- Chips / segmented -------------------------- */
export function Chip({ active, dotColor, onClear, children, className = "", ...rest }) {
  return html`<button className=${cx("chip", active && "is-active", className)} ...${rest}>
    ${dotColor && html`<span className="chip__dot" style=${{ background: dotColor }} />`}
    ${children}
    ${onClear && html`<span className="chip__x" role="button" onClick=${(e) => { e.stopPropagation(); onClear(); }}>
      <${Icon} name="x" size=${13} />
    </span>`}
  </button>`;
}

export function Segmented({ value, onChange, options }) {
  return html`<div className="segmented">
    ${options.map((o) => html`<button
      key=${o.value}
      className=${value === o.value ? "is-active" : ""}
      title=${o.title || o.label || ""}
      onClick=${() => onChange(o.value)}>
      ${o.icon && html`<${Icon} name=${o.icon} size=${15} />`}
      ${o.label && html`<span>${o.label}</span>`}
    </button>`)}
  </div>`;
}

/* ----------------------------- Form fields ------------------------------ */
export function Select({ value, onChange, options, className = "", ...rest }) {
  return html`<div className="field">
    <select className=${cx("select", className)} value=${value}
      onChange=${(e) => onChange(e.target.value)} ...${rest}>
      ${options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return html`<option key=${v} value=${v}>${l}</option>`;
      })}
    </select>
    <span className="field__chev"><${Icon} name="chevronDown" size=${15} /></span>
  </div>`;
}

export function Switch({ checked, onChange, children }) {
  return html`<button type="button" role="switch" aria-checked=${checked}
    className=${cx("switch", checked && "is-on")} onClick=${() => onChange(!checked)}>
    <span className="switch__track"><span className="switch__thumb" /></span>
    ${children && html`<span>${children}</span>`}
  </button>`;
}

/* ------------------------------ Containers ------------------------------ */
export function SecHead({ icon, title, children }) {
  return html`<div className="sec-head">
    <div className="h-sec">${icon && html`<${Icon} name=${icon} size=${17} />`}${title}</div>
    <span className="sec-head__line" />
    ${children}
  </div>`;
}

export function Panel({ title, icon, actions, pad, children, className = "" }) {
  return html`<section className=${cx("panel", className)}>
    ${(title || actions) && html`<div className="panel__head">
      <div className="h-sec">${icon && html`<${Icon} name=${icon} size=${16} />`}${title}</div>
      ${actions && html`<div className="row gap-sm" style=${{ marginLeft: "auto" }}>${actions}</div>`}
    </div>`}
    ${pad === false ? children : html`<div className="panel__body">${children}</div>`}
  </section>`;
}

export function Stat({ label, value, sub, icon, tone, delta }) {
  return html`<div className="stat">
    <div className="stat__top">
      <span className="stat__label">${label}</span>
      ${icon && html`<span className=${cx("stat__ico", tone)}><${Icon} name=${icon} size=${17} /></span>`}
    </div>
    <div className="stat__value tnum">${value}</div>
    ${sub != null && html`<div className="stat__sub">
      ${delta != null && delta !== 0 && html`<span className=${cx("delta", delta >= 0 ? "up" : "down")}>
        <${Icon} name=${delta >= 0 ? "arrowUp" : "arrowDown"} size=${13} />${Math.abs(delta)}%
      </span>`}
      ${sub}
    </div>`}
  </div>`;
}

/* ---------------------------- Species marks ----------------------------- */
export function SpeciesDot({ species, size = 9 }) {
  return html`<span className="sdot" style=${{ background: speciesColor(species), width: size, height: size }} />`;
}

/* ------------------------------- Charts --------------------------------- */
// Every chart takes an optional `onSelect`. With it, bars become buttons that open
// the matching photos; without it they stay plain marks.
export function Bars({ data, max, fmt, onSelect }) {
  const m = max || Math.max(1, ...data.map((d) => d.value));
  const Row = onSelect ? "button" : "div";
  return html`<div className="bars">
    ${data.map((d, i) => html`<${Row} className=${cx("bar", onSelect && "bar--btn")} key=${(d.label || "") + i}
      onClick=${onSelect ? () => onSelect(d, i) : undefined} title=${onSelect ? `Show ${d.label} photos` : undefined}>
      <span className="bar__label">
        ${d.color && html`<span className="sdot" style=${{ background: d.color }} />`}
        <span>${d.label}</span>
      </span>
      <span className="bar__track">
        <span className="bar__fill" style=${{ width: (d.value / m) * 100 + "%", background: d.color || "var(--accent)" }} />
      </span>
      <span className="bar__val">${fmt ? fmt(d.value) : d.value}</span>
    </${Row}>`)}
  </div>`;
}

export function SplitBar({ segments, onSelect }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const Seg = onSelect ? "button" : "i";
  return html`<div className="splitbar">
    ${segments.map((s, i) => s.value > 0 && html`<${Seg} key=${i} type=${onSelect ? "button" : undefined}
      onClick=${onSelect ? () => onSelect(s, i) : undefined}
      style=${{ width: (s.value / total) * 100 + "%", background: s.color }} title=${s.title || ""} />`)}
  </div>`;
}

export function Histogram({ hours, onSelect }) {
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  const Col = onSelect ? "button" : "div";
  return html`<div className="histwrap">
    <div className="hist">
      ${hours.map((v, h) => {
        const pct = (v / max) * 100;
        const cls = v === 0 ? "hist__bar dim" : (h === peak ? "hist__bar peak" : "hist__bar");
        return html`<${Col} className=${cx("hist__col", onSelect && "is-btn")} key=${h}
          onClick=${onSelect ? () => onSelect(h) : undefined}
          title=${`${labelHour(h)} · ${v} photo${v === 1 ? "" : "s"}`}>
          <div className=${cls} style=${{ height: Math.max(pct, v > 0 ? 6 : 2) + "%" }} />
        </${Col}>`;
      })}
    </div>
    <div className="axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
  </div>`;
}

// Compact 24-hour activity strip (one bar per hour), highlighting a peak window.
// Each strip is normalized to its own max so a species' shape is always readable.
export function HourStrip({ hours, color = "var(--accent)", peak, onSelect }) {
  const max = Math.max(1, ...hours);
  const inPeak = (h) => {
    if (!peak) return false;
    const { start, end } = peak;
    return start <= end ? h >= start && h < end : h >= start || h < end;
  };
  const Cell = onSelect ? "button" : "span";
  return html`<div className="hourstrip" role=${onSelect ? undefined : "img"} aria-label="Activity by hour">
    ${hours.map((v, h) => html`<${Cell} key=${h} className=${cx("hourstrip__c", inPeak(h) && "is-peak", onSelect && "is-btn")}
      onClick=${onSelect ? () => onSelect(h) : undefined}
      title=${`${labelHour(h)} · ${v} capture${v === 1 ? "" : "s"}`}>
      <i style=${{ height: Math.max((v / max) * 100, v > 0 ? 14 : 0) + "%", background: color }} />
    </${Cell}>`)}
  </div>`;
}

export function Sparkbars({ data, onSelect }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const Bar = onSelect ? "button" : "div";
  return html`<div className="spark">
    ${data.map((d, i) => html`<${Bar} className=${cx("spark__b", onSelect && "is-btn")} key=${i}
      onClick=${onSelect ? () => onSelect(d, i) : undefined}
      style=${{ height: Math.max((d.value / max) * 100, d.value > 0 ? 8 : 3) + "%" }}
      title=${(d.label ? d.label + " · " : "") + d.value}><i /></${Bar}>`)}
  </div>`;
}

export function CalHeat({ counts, weeks = 26, onSelect }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay()); // back to Sunday
  const cells = [];
  let max = 1;
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const n = counts.get(isoDay(d)) || 0;
    if (n > max) max = n;
    cells.push({ key: isoDay(d), n, date: new Date(d) });
  }
  const shade = (n) => n === 0
    ? "var(--surface-3)"
    : `color-mix(in srgb, var(--accent) ${20 + Math.ceil((n / max) * 4) * 18}%, var(--surface-3))`;
  const Cell = onSelect ? "button" : "div";
  return html`<div>
    <div className="cal">
      ${cells.map((c) => html`<${Cell} key=${c.key} className=${cx("cal__cell", onSelect && "is-btn")}
        onClick=${onSelect ? () => onSelect(c.key, c.date) : undefined}
        style=${{ background: shade(c.n) }}
        title=${`${fmtDate(c.date)} · ${c.n} capture${c.n === 1 ? "" : "s"}`} />`)}
    </div>
    <div className="row" style=${{ justifyContent: "flex-end", marginTop: 10 }}>
      <div className="heatlegend">Less
        ${[0, 1, 2, 3, 4].map((l) => html`<i key=${l}
          style=${{ background: l === 0 ? "var(--surface-3)" : `color-mix(in srgb, var(--accent) ${20 + l * 18}%, var(--surface-3))` }} />`)}
        More</div>
    </div>
  </div>`;
}

/* -------------------------------- Media --------------------------------- */
// A photo or video. Tiles use the small copy (`thumb`, about 400px) when one exists
// and let the browser pick the full photo only for large or high-density tiles.
// `playable` is the full view: full-size photo, or the video with controls.
const TILE_SIZES = "(max-width: 560px) 50vw, 260px";
export function Media({ capture, alt, className, playable, sizes }) {
  const thumb = playable ? "" : capture.thumb;
  if (capture.media === "video") {
    if (thumb) return html`<img className=${className} src=${thumb} alt=${alt} loading="lazy" />`;
    return html`<video className=${className} src=${playable ? capture.image : capture.image + "#t=0.1"}
      controls=${!!playable} muted=${!playable} playsInline preload="metadata" aria-label=${alt} />`;
  }
  if (thumb) {
    // If the small copy is missing, fall back to the full photo rather than a broken tile.
    const fallback = (e) => {
      const img = e.target;
      if (img.dataset.fell) return;
      img.dataset.fell = "1";
      img.removeAttribute("srcset");
      img.src = capture.image;
    };
    return html`<img className=${className} src=${thumb} srcset=${`${thumb} 400w, ${capture.image} 1600w`}
      sizes=${sizes || TILE_SIZES} alt=${alt} loading="lazy" onError=${fallback} />`;
  }
  return html`<img className=${className} src=${capture.image} alt=${alt} loading=${playable ? "eager" : "lazy"} />`;
}

/* ---------------------------- Camera status ----------------------------- */
// One card per camera, so a silent camera can't hide behind a busy one.
export function CameraCard({ name, row, onClick }) {
  return html`<button className="camcard" onClick=${onClick} title=${`Show photos from ${name}`}>
    <span className="camcard__top">
      <span className="camcard__name">${name}</span>
      <span className=${cx("pill", row.quiet ? "is-quiet" : "is-ok")}
        title=${row.quiet ? "No new photos lately. This can just mean no activity \u2014 if not, check battery and signal in the SPYPOINT app." : ""}>
        ${row.quiet ? (row.quietDays == null ? "No photos" : `Quiet ${row.quietDays}d`) : "Active"}
      </span>
    </span>
    <span className="camcard__sub">
      ${row.last ? `Last photo ${timeAgo(row.last)} \u00b7 ${row.week} this week` : "Nothing received yet"}
    </span>
  </button>`;
}

/* ------------------------------ Photo tile ------------------------------ */
export function Shot({ capture, species, onClick, cameraLabel, selectable, selected, burst, timeLabel }) {
  const c = capture;
  const cam = cameraLabel || c.camera;
  return html`<button className=${cx("shot", selectable && "is-selectable", selected && "is-selected")}
      onClick=${onClick} title=${`${species} · ${cam}`}>
    <div className="shot__thumb">
      ${c.image
        ? html`<${Media} capture=${c} alt=${species} />`
        : html`<div className="shot__noimg">No image</div>`}
      ${selectable && html`<span className=${cx("shot__check", selected && "is-on")}>
        ${selected && html`<${Icon} name="check" size=${14} />`}
      </span>`}
      ${species !== "Animal" && html`<div className="shot__tl">
        <span className="sbadge"><span className="sbadge__dot" style=${{ background: speciesColor(species) }} />${species}</span>
      </div>`}
      ${c.favorite && html`<div className="shot__tr">
        <span className="tod fav" title="Favorite"><${Icon} name="star" size=${13} /></span>
      </div>`}
      ${c.media === "video" && html`<span className="shot__play"><${Icon} name="play" size=${20} /></span>`}
      ${burst > 1 && html`<span className="shot__burst" title=${`${burst} photos from this trigger`}>
        <${Icon} name="images" size=${12} />${burst}
      </span>`}
    </div>
    <div className="shot__meta">
      <span className="shot__cam"><span>${cam}</span></span>
      <span className="shot__time">${timeLabel || timeAgo(c.date)}</span>
    </div>
  </button>`;
}

/* ------------------------------- Lightbox ------------------------------- */
// Editable per-photo metadata: favorite flag, a free-text note, and manual
// corrections to temp / moon. Remounts per photo (keyed by id) so the draft
// resets cleanly. Notes/temp save on blur; the star toggles immediately.
export function LightboxEdit({ capture, species, meta, onMeta, onToggleFavorite, onTag, buckNames, signedIn, onSignIn }) {
  const c = capture;
  const m = meta || {};
  const [note, setNote] = useState(m.note || "");
  const [buck, setBuck] = useState(m.buck || "");
  const [temp, setTemp] = useState(c.temp == null ? "" : String(c.temp));
  const [moon, setMoon] = useState(c.moon || "");
  const isFav = !!m.favorite;

  const commitNote = () => {
    const v = note.trim();
    if (v === (m.note || "")) return;
    onMeta({ note: v || null }, { okMsg: v ? "Note saved" : "Note removed" });
  };
  const commitBuck = () => {
    const v = buck.trim().slice(0, 40);
    if (v === (m.buck || "")) return;
    onMeta({ buck: v || null }, { okMsg: v ? `Named ${v}` : "Name removed" });
    if (v && species !== "Buck") onTag("Buck");
  };
  const commitTemp = () => {
    const raw = temp.trim();
    const n = raw === "" ? null : Number(raw);
    if (raw !== "" && !Number.isFinite(n)) { setTemp(c.temp == null ? "" : String(c.temp)); return; }
    if ((n == null && c.temp == null) || n === c.temp) return;
    onMeta({ temp: n }, { okMsg: n == null ? "Temp cleared" : `Temp set to ${n}\u00b0F` });
  };
  const commitMoon = () => {
    const v = moon.trim();
    if (v === (c.moon || "")) return;
    onMeta({ moon: v || null }, { okMsg: v ? "Moon updated" : "Moon cleared" });
  };

  return html`<div className="lb__edit">
    <div className="lb__edit-head">
      <span className="lb__edit-title"><${Icon} name="note" size=${14} />Details</span>
      ${!signedIn && html`<button className="lb__link" onClick=${onSignIn} title="Without signing in, edits stay on this device">
        Sign in to share
      </button>`}
      <button className=${cx("favbtn", isFav && "is-on")} onClick=${onToggleFavorite}
        title=${isFav ? "Remove from favorites" : "Add to favorites"} aria-pressed=${isFav}>
        <${Icon} name="star" size=${15} />
        <span>${isFav ? "Favorited" : "Favorite"}</span>
      </button>
    </div>
    <textarea className="lb__note" placeholder="Add a note about this photo\u2026" rows=${2}
      value=${note} onInput=${(e) => setNote(e.target.value)} onBlur=${commitNote} maxLength=${500} />
    <div className="lb__corrections">
      <label className="lb__field">
        <span><${Icon} name="paw" size=${13} />Animal</span>
        <select value=${species} onChange=${(e) => onTag(e.target.value)}>
          ${[...new Set([...TAG_OPTIONS, species])].map((s) => html`<option key=${s} value=${s}>${s}</option>`)}
        </select>
      </label>
      <label className="lb__field">
        <span><${Icon} name="target" size=${13} />Buck name</span>
        <input type="text" list="buck-names" value=${buck} placeholder="\u2014" maxLength=${40}
          onInput=${(e) => setBuck(e.target.value)} onBlur=${commitBuck}
          onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} />
        <datalist id="buck-names">
          ${(buckNames || []).map((n) => html`<option key=${n} value=${n} />`)}
        </datalist>
      </label>
      <label className="lb__field">
        <span><${Icon} name="thermo" size=${13} />Temp \u00b0F</span>
        <input type="number" inputMode="numeric" value=${temp}
          onInput=${(e) => setTemp(e.target.value)} onBlur=${commitTemp}
          onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} placeholder="\u2014" />
      </label>
      <label className="lb__field">
        <span><${Icon} name="moon" size=${13} />Moon</span>
        <input type="text" value=${moon}
          onInput=${(e) => setMoon(e.target.value)} onBlur=${commitMoon}
          onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} placeholder="\u2014" maxLength=${40} />
      </label>
    </div>
  </div>`;
}

// Fix or remove a photo someone added with the Upload button. The login is shared,
// so anyone signed in can edit any upload; the Animal field above handles species.
const OTHER_CAMERA = "Other camera";
export function UploadEdit({ capture, cameras, camName, auth, onSignIn, onEdit, onDelete }) {
  const c = capture;
  const [camera, setCamera] = useState(c.camera);
  const [when, setWhen] = useState(toLocalInput(c.date));
  const [busy, setBusy] = useState(false);
  const dirty = camera !== c.camera || when !== toLocalInput(c.date);
  const options = (cameras || []).map((cam) => ({ value: cam.name, label: camName ? camName(cam.name) : cam.name }));
  if (!options.some((o) => o.value === OTHER_CAMERA)) options.push({ value: OTHER_CAMERA, label: "Phone or other camera" });
  if (!options.some((o) => o.value === c.camera)) options.unshift({ value: c.camera, label: camName ? camName(c.camera) : c.camera });

  const save = async () => {
    const d = new Date(when);
    setBusy(true);
    await onEdit({ camera, date: isNaN(d.getTime()) ? c.date.toISOString() : d.toISOString() });
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm("Delete this upload for everyone? Its comments and notes go with it. This can't be undone.")) return;
    setBusy(true);
    await onDelete();
    setBusy(false);
  };

  return html`<div className="lb__edit lb__upload">
    <div className="lb__edit-head">
      <span className="lb__edit-title"><${Icon} name="upload" size=${14} />Upload</span>
      ${!auth && html`<button className="lb__link" onClick=${onSignIn}>Sign in to edit or delete</button>`}
    </div>
    ${auth && html`<${Fragment}>
      <div className="lb__corrections">
        <label className="lb__field">
          <span><${Icon} name="camera" size=${13} />Camera</span>
          <select value=${camera} onChange=${(e) => setCamera(e.target.value)}>
            ${options.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
          </select>
        </label>
        <label className="lb__field">
          <span><${Icon} name="clock" size=${13} />Taken</span>
          <input type="datetime-local" value=${when} onInput=${(e) => setWhen(e.target.value)} />
        </label>
      </div>
      <div className="row" style=${{ gap: 8 }}>
        <${Btn} sm variant="primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save"}</${Btn}>
        <div className="spacer" />
        <${Btn} sm className="lb__danger" icon="trash" disabled=${busy} onClick=${remove}>Delete</${Btn}>
      </div>
    </${Fragment}>`}
  </div>`;
}

/* -------------------------------- Zoom ---------------------------------- */
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.6;
const TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const HINT_KEY = "trailhub-zoom-hint";
const HINT_TIMES = 3;

const formatZoom = (s) => (Math.round(s * 10) / 10).toString().replace(/\.0$/, "") + "×";

// A photo you can pinch, double-tap, scroll or drag to zoom and pan. The frame keeps
// its size and clips the enlarged photo, so zooming never covers the details panel.
// `controls` receives zoomIn / zoomOut / reset for keyboard shortcuts.
export function ZoomImage({ capture, alt, onZoomChange, controls }) {
  const frame = useRef(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [moving, setMoving] = useState(false);
  const [hint, setHint] = useState(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(null);
  const lastTouchEnd = useRef(0);

  // Keep the photo covering the frame: no empty gaps at the edges while zoomed.
  const clamp = (s, x, y) => {
    const el = frame.current;
    const scale = Math.min(MAX_ZOOM, Math.max(1, s));
    if (!el || scale === 1) return { s: 1, x: 0, y: 0 };
    const w = el.clientWidth;
    const h = el.clientHeight;
    return {
      s: scale,
      x: Math.min(0, Math.max(w - w * scale, x)),
      y: Math.min(0, Math.max(h - h * scale, y)),
    };
  };
  // Zoom so the point under (fx, fy) stays put, as pinch and scroll zoom feel natural.
  const zoomAt = (s, fx, fy, from = viewRef.current) => {
    const target = Math.min(MAX_ZOOM, Math.max(1, s));
    const k = target / from.s;
    setView(clamp(target, fx - (fx - from.x) * k, fy - (fy - from.y) * k));
  };
  const local = (e) => {
    const r = frame.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const middle = () => ({ x: frame.current.clientWidth / 2, y: frame.current.clientHeight / 2 });
  const zoomIn = () => { const m = middle(); zoomAt(viewRef.current.s * ZOOM_STEP, m.x, m.y); };
  const zoomOut = () => { const m = middle(); zoomAt(viewRef.current.s / ZOOM_STEP, m.x, m.y); };
  const reset = () => setView({ s: 1, x: 0, y: 0 });
  const toggleAt = (p) => (viewRef.current.s > 1 ? reset() : zoomAt(TAP_ZOOM, p.x, p.y));
  if (controls) controls.current = { zoomIn, zoomOut, reset };

  const zoomed = view.s > 1;
  useEffect(() => { if (onZoomChange) onZoomChange(zoomed); }, [zoomed]);
  useEffect(() => () => { if (onZoomChange) onZoomChange(false); }, []);

  // Scroll wheel and trackpad pinch, plus Safari's own pinch gesture, need listeners
  // that can cancel the page's default zoom and scroll.
  useEffect(() => {
    const el = frame.current;
    const onWheel = (e) => {
      e.preventDefault();
      const p = local(e);
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(viewRef.current.s * Math.exp(-e.deltaY * speed), p.x, p.y);
    };
    const stopPageZoom = (e) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", stopPageZoom);
    el.addEventListener("gesturechange", stopPageZoom);
    // Rotating the phone changes the frame, so start over. Other resize events, like
    // Safari's toolbar sliding in and out, leave the zoom alone.
    let size = `${el.clientWidth}x${el.clientHeight}`;
    const onResize = () => {
      requestAnimationFrame(() => {
        const now = `${el.clientWidth}x${el.clientHeight}`;
        if (now === size) return;
        size = now;
        setView({ s: 1, x: 0, y: 0 });
      });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", stopPageZoom);
      el.removeEventListener("gesturechange", stopPageZoom);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // A short how-to, shown the first few times on each device.
  useEffect(() => {
    let shown = 0;
    try { shown = Number(localStorage.getItem(HINT_KEY)) || 0; } catch (e) {}
    if (shown >= HINT_TIMES) return;
    try { localStorage.setItem(HINT_KEY, String(shown + 1)); } catch (e) {}
    const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    setHint(touch ? "Pinch or double-tap to zoom" : "Scroll or double-click to zoom");
    const t = setTimeout(() => setHint(null), 3200);
    return () => clearTimeout(t);
  }, []);

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = {
        kind: "pinch", view: viewRef.current,
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    } else if (pts.length === 1) {
      gesture.current = { kind: "pan", view: viewRef.current, from: pts[0], moved: false };
    } else {
      gesture.current = null;
    }
  };

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    frame.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    startGesture();
    if (pointers.current.size >= 2) setHint(null);
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = Math.min(MAX_ZOOM, Math.max(1, g.view.s * (dist / g.dist)));
      const k = s / g.view.s;
      setMoving(true);
      setView(clamp(s,
        g.mid.x - (g.mid.x - g.view.x) * k + (mid.x - g.mid.x),
        g.mid.y - (g.mid.y - g.view.y) * k + (mid.y - g.mid.y)));
    } else if (g.kind === "pan") {
      const dx = p.x - g.from.x;
      const dy = p.y - g.from.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.view.s > 1 && g.moved) {
        setMoving(true);
        setView(clamp(g.view.s, g.view.x + dx, g.view.y + dy));
      }
    }
  };

  const onPointerEnd = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    const wasTap = gesture.current && gesture.current.kind === "pan" && !gesture.current.moved;
    pointers.current.delete(e.pointerId);
    setMoving(false);
    startGesture(); // a pinch that drops to one finger carries on as a pan
    if (e.pointerType === "mouse" || e.type !== "pointerup") return;
    lastTouchEnd.current = e.timeStamp;
    if (!wasTap || pointers.current.size) { lastTap.current = null; return; }
    const p = local(e);
    const prev = lastTap.current;
    if (prev && e.timeStamp - prev.t < DOUBLE_TAP_MS && Math.hypot(p.x - prev.x, p.y - prev.y) < 40) {
      lastTap.current = null;
      setHint(null);
      toggleAt(p);
    } else {
      lastTap.current = { t: e.timeStamp, x: p.x, y: p.y };
    }
  };

  const onDoubleClick = (e) => {
    // Phones can also send a double-click after a double-tap; that one is handled.
    if (e.timeStamp - lastTouchEnd.current < 700) return;
    setHint(null);
    toggleAt(local(e));
  };

  const stop = (e) => e.stopPropagation();
  return html`<div ref=${frame} className=${cx("lb__zoom", zoomed && "is-zoomed", moving && "is-moving")}
      onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
      onPointerUp=${onPointerEnd} onPointerCancel=${onPointerEnd} onDoubleClick=${onDoubleClick}>
    <img className="lb__img" src=${capture.image} alt=${alt} draggable=${false}
      style=${{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} />
    ${hint && html`<span className="lb__zoomhint" role="status">${hint}</span>`}
    <div className="lb__zoombar" onPointerDown=${stop} onDoubleClick=${stop}>
      <button type="button" onClick=${zoomOut} disabled=${!zoomed} aria-label="Zoom out" title="Zoom out (−)">−</button>
      <span className="lb__zoomlevel" aria-live="polite">${formatZoom(view.s)}</span>
      <button type="button" onClick=${zoomIn} disabled=${view.s >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (+)">+</button>
      ${zoomed && html`<button type="button" className="lb__zoomreset" onClick=${reset} title="Reset zoom (0)">Reset</button>`}
    </div>
  </div>`;
}

export function Lightbox({ capture, species, cameraLabel, meta, onMeta, onToggleFavorite, onTag, buckNames, comments, upload, signedIn, onSignIn, onClose, onPrev, onNext, hasPrev, hasNext }) {
  const zoomControls = useRef(null);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      // Arrow keys belong to the field or video being used, not photo navigation.
      if (e.key !== "Escape" && /^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(e.target.tagName)) return;
      const zoom = zoomControls.current;
      if (e.key === "Escape") onClose();
      else if ((e.key === "+" || e.key === "=") && zoom) zoom.zoomIn();
      else if ((e.key === "-" || e.key === "_") && zoom) zoom.zoomOut();
      else if (e.key === "0" && zoom) zoom.reset();
      else if (e.key === "ArrowLeft" && hasPrev) onPrev();
      else if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  // The page behind shouldn't scroll while a photo is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, []);

  // Each photo starts at the top, even if the details were scrolled down.
  const stage = useRef(null);
  const photoId = capture && capture.id;
  useEffect(() => { if (stage.current) stage.current.scrollTop = 0; }, [photoId]);

  // Swipe on a photo to move between photos. Videos are left out because dragging
  // there belongs to the player's seek bar, and a zoomed photo uses drags to pan.
  const swipe = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    swipe.current = !zoomed && e.target.tagName === "IMG" && e.touches.length === 1
      ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchMove = (e) => { if (e.touches.length > 1) swipe.current = null; };
  const onTouchEnd = (e) => {
    if (!swipe.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.current.x;
    const dy = t.clientY - swipe.current.y;
    swipe.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && hasNext) onNext();
    else if (dx > 0 && hasPrev) onPrev();
  };

  if (!capture) return null;
  const c = capture;
  return html`<div className="lb" onClick=${onClose}>
    <div className="lb__stage" ref=${stage} onClick=${(e) => e.stopPropagation()}
      onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd}>
      ${c.image && c.media === "video"
        ? html`<${Media} key=${c.id} className="lb__img" capture=${c} alt=${species} playable />`
        : c.image
        ? html`<${ZoomImage} key=${c.id} capture=${c} alt=${species}
            onZoomChange=${setZoomed} controls=${zoomControls} />`
        : html`<div className="shot__noimg" style=${{ width: "60vw", height: "60vh" }}>No image available</div>`}
      <div className="lb__close"><${IconBtn} icon="x" onClick=${onClose} aria-label="Close" /></div>
      ${hasPrev && html`<button className="lb__nav prev" onClick=${onPrev} aria-label="Previous"><${Icon} name="chevronLeft" size=${22} /></button>`}
      ${hasNext && html`<button className="lb__nav next" onClick=${onNext} aria-label="Next"><${Icon} name="chevronRight" size=${22} /></button>`}
      <div className="lb__panel">
        <div className="lb__info">
          <h3>
            <${SpeciesDot} species=${species} size=${12} />${species}
            ${meta && meta.favorite && html`<${Icon} name="star" size=${15} className="lb__fav" />`}
          </h3>
          <div className="row">
            <span><${Icon} name="camera" size=${15} />${cameraLabel || c.camera}</span>
            <span><${Icon} name="clock" size=${15} />${fmtDateTime(c.date)}</span>
            <span><${Icon} name=${c.isNight ? "moon" : "sun"} size=${15} />${c.isNight ? "Night" : "Day"}</span>
            ${c.temp != null && html`<span><${Icon} name="thermo" size=${15} />${c.tempEstimated ? "~" : ""}${c.temp}°F</span>`}
            ${c.weather && html`<span>Wind ${c.weather.wind} mph ${c.weather.windDir}</span>`}
            ${c.weather && html`<span>${c.weather.pressure} inHg${c.weather.trend ? ", " + c.weather.trend.toLowerCase() : ""}</span>`}
            ${c.moon && html`<span><${Icon} name="moon" size=${15} />${c.moon}</span>`}
            ${c.confidence != null && html`<span><${Icon} name="target" size=${15} />${c.aiTagged ? "AI " : ""}${Math.round(c.confidence * 100)}%</span>`}
          </div>
        </div>
        ${onMeta && html`<${LightboxEdit} key=${c.id} capture=${c} species=${species} meta=${meta}
          onMeta=${onMeta} onToggleFavorite=${onToggleFavorite} onTag=${onTag} buckNames=${buckNames}
          signedIn=${signedIn} onSignIn=${onSignIn} />`}
        ${upload && html`<${UploadEdit} key=${"up-" + c.id} capture=${c} ...${upload} />`}
        ${comments}
        <div className="lb__actions">
          ${c.image && html`<a className="btn btn--sm" href=${c.image} download target="_blank" rel="noopener">
            <${Icon} name="download" size=${15} /><span>Download</span>
          </a>`}
        </div>
      </div>
    </div>
  </div>`;
}

/* ------------------------- Empty / toast helpers ------------------------ */
export function Empty({ icon = "inbox", title, message, action }) {
  return html`<div className="empty">
    <div className="empty__ico"><${Icon} name=${icon} size=${30} /></div>
    <div>
      <h3>${title}</h3>
      ${message && html`<p className="mt-sm">${message}</p>`}
    </div>
    ${action}
  </div>`;
}

export function Toast({ kind = "ok", icon, action, children }) {
  return html`<div className=${cx("toast", kind)} role="status">
    <${Icon} name=${icon || (kind === "ok" ? "checkCircle" : "info")} size=${16} />${children}
    ${action && html`<button className="toast__act" onClick=${action.onClick}>${action.label}</button>`}
  </div>`;
}
