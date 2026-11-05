// Vale Trails — reusable UI primitives, chart widgets, photo tile and lightbox.
// Pure presentation: all data shaping happens in the views. Components map 1:1
// to the classes defined in styles.css.
import { html, useEffect, useRef, useState } from "./react.js";
import { Icon } from "./icons.js";
import {
  speciesColor, fmtDate, fmtDateTime, timeAgo, labelHour, isoDay, TAG_OPTIONS,
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
export function Bars({ data, max, fmt }) {
  const m = max || Math.max(1, ...data.map((d) => d.value));
  return html`<div className="bars">
    ${data.map((d, i) => html`<div className="bar" key=${(d.label || "") + i}>
      <span className="bar__label">
        ${d.color && html`<span className="sdot" style=${{ background: d.color }} />`}
        <span>${d.label}</span>
      </span>
      <span className="bar__track">
        <span className="bar__fill" style=${{ width: (d.value / m) * 100 + "%", background: d.color || "var(--accent)" }} />
      </span>
      <span className="bar__val">${fmt ? fmt(d.value) : d.value}</span>
    </div>`)}
  </div>`;
}

export function SplitBar({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return html`<div className="splitbar">
    ${segments.map((s, i) => s.value > 0 && html`<i key=${i}
      style=${{ width: (s.value / total) * 100 + "%", background: s.color }} title=${s.title || ""} />`)}
  </div>`;
}

export function Histogram({ hours }) {
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  return html`<div className="histwrap">
    <div className="hist">
      ${hours.map((v, h) => {
        const pct = (v / max) * 100;
        const cls = v === 0 ? "hist__bar dim" : (h === peak ? "hist__bar peak" : "hist__bar");
        return html`<div className="hist__col" key=${h} title=${`${labelHour(h)} · ${v} photo${v === 1 ? "" : "s"}`}>
          <div className=${cls} style=${{ height: Math.max(pct, v > 0 ? 6 : 2) + "%" }} />
        </div>`;
      })}
    </div>
    <div className="axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
  </div>`;
}

// Compact 24-hour activity strip (one bar per hour), highlighting a peak window.
// Each strip is normalized to its own max so a species' shape is always readable.
export function HourStrip({ hours, color = "var(--accent)", peak }) {
  const max = Math.max(1, ...hours);
  const inPeak = (h) => {
    if (!peak) return false;
    const { start, end } = peak;
    return start <= end ? h >= start && h < end : h >= start || h < end;
  };
  return html`<div className="hourstrip" role="img" aria-label="Activity by hour">
    ${hours.map((v, h) => html`<span key=${h} className=${cx("hourstrip__c", inPeak(h) && "is-peak")}
      title=${`${labelHour(h)} · ${v} capture${v === 1 ? "" : "s"}`}>
      <i style=${{ height: Math.max((v / max) * 100, v > 0 ? 14 : 0) + "%", background: color }} />
    </span>`)}
  </div>`;
}

export function Sparkbars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return html`<div className="spark">
    ${data.map((d, i) => html`<div className="spark__b" key=${i}
      style=${{ height: Math.max((d.value / max) * 100, d.value > 0 ? 8 : 3) + "%" }}
      title=${(d.label ? d.label + " · " : "") + d.value}><i /></div>`)}
  </div>`;
}

export function CalHeat({ counts, weeks = 26 }) {
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
  return html`<div>
    <div className="cal">
      ${cells.map((c) => html`<div key=${c.key} className="cal__cell"
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
// A photo or video. Tiles show a video's opening frame; `playable` adds controls.
export function Media({ capture, alt, className, playable }) {
  if (capture.media === "video") {
    return html`<video className=${className} src=${playable ? capture.image : capture.image + "#t=0.1"}
      controls=${!!playable} muted=${!playable} playsInline preload="metadata" aria-label=${alt} />`;
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
export function LightboxEdit({ capture, species, meta, onMeta, onToggleFavorite, onTag, buckNames }) {
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

export function Lightbox({ capture, species, cameraLabel, meta, onMeta, onToggleFavorite, onTag, buckNames, comments, onClose, onPrev, onNext, hasPrev, hasNext }) {
  useEffect(() => {
    const onKey = (e) => {
      // Arrow keys belong to the field or video being used, not photo navigation.
      if (e.key !== "Escape" && /^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(e.target.tagName)) return;
      if (e.key === "Escape") onClose();
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
  // there belongs to the player's seek bar.
  const swipe = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    swipe.current = e.target.tagName === "IMG" && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  };
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
      onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
      ${c.image
        ? html`<${Media} key=${c.id} className="lb__img" capture=${c} alt=${species} playable />`
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
          onMeta=${onMeta} onToggleFavorite=${onToggleFavorite} onTag=${onTag} buckNames=${buckNames} />`}
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

export function Toast({ kind = "ok", icon, children }) {
  return html`<div className=${cx("toast", kind)}>
    <${Icon} name=${icon || (kind === "ok" ? "checkCircle" : "info")} size=${16} />${children}
  </div>`;
}
