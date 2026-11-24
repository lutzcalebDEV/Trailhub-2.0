// Vale Trails — reusable UI primitives, chart widgets, photo tile and lightbox.
// Pure presentation: all data shaping happens in the views. Components map 1:1
// to the classes defined in styles.css.
import { html, useEffect, useLayoutEffect, useRef, useState, Fragment } from "./react.js";
import { Icon } from "./icons.js";
import { confirmSheet } from "./ask.js";
import {
  speciesColor, fmtDate, fmtDateTime, timeAgo, labelHour, isoDay, TAG_OPTIONS, toLocalInput, canEditUpload,
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
// A chip that can be cleared clears on a tap anywhere on it: the little x alone is
// too small a target for a thumb.
export function Chip({ active, dotColor, onClear, children, className = "", ...rest }) {
  return html`<button type="button" className=${cx("chip", active && "is-active", className)} onClick=${onClear} ...${rest}>
    ${dotColor && html`<span className="chip__dot" style=${{ background: dotColor }} />`}
    ${children}
    ${onClear && html`<span className="chip__x" role="button" onClick=${(e) => { e.stopPropagation(); onClear(); }}>
      <${Icon} name="x" size=${13} />
    </span>`}
  </button>`;
}

// An option with only an icon gets its `title` as the name screen readers read out.
export function Segmented({ value, onChange, options, label }) {
  const at = options.findIndex((o) => o.value === value);
  return html`<div className="segmented" role="group" aria-label=${label} style=${{ "--n": options.length, "--i": Math.max(0, at) }} data-on=${at >= 0 ? "1" : undefined}>
    ${options.map((o) => html`<button
      key=${o.value}
      className=${value === o.value ? "is-active" : ""}
      title=${o.title || o.label || ""}
      aria-label=${o.label ? undefined : o.title}
      aria-pressed=${value === o.value}
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

/* ------------------------------ Bottom sheets ---------------------------- */
// A sheet follows a downward drag and closes past a threshold (or on a quick flick),
// otherwise it springs back. The drag starts on the grip, or anywhere on the sheet
// while its own content is scrolled to the top. The scrim dims less as it goes.
export function useSheetDrag(open, onClose) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const sheet = ref.current;
    if (!open || !sheet) return;
    const scrim = sheet.parentElement;
    let start = null, dragging = false, dy = 0, lastY = 0, lastT = 0, speed = 0;
    const place = (y, animate) => {
      const ease = animate ? "transform .26s cubic-bezier(.2,.8,.2,1)" : "none";
      sheet.style.transition = ease;
      sheet.style.transform = y ? `translateY(${y}px)` : "";
      if (scrim) {
        scrim.style.transition = animate ? "background-color .26s ease" : "none";
        scrim.style.setProperty("--sheet-fade", String(Math.max(0, 1 - y / (sheet.offsetHeight || 1))));
      }
    };
    const onStart = (e) => {
      start = null;
      if (e.touches.length !== 1 || !window.matchMedia("(max-width: 900px)").matches) return;
      const grip = !!(e.target.closest && e.target.closest(".drawer__grip"));
      if (!grip && sheet.scrollTop > 0) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, grip };
      dragging = false; dy = 0; lastY = t.clientY; lastT = e.timeStamp; speed = 0;
    };
    const onMove = (e) => {
      if (!start) return;
      const t = e.touches[0];
      const d = t.clientY - start.y;
      if (!dragging) {
        // Scrolling the sheet's content up, or a sideways swipe: not a drag.
        if (d < -4 || Math.abs(t.clientX - start.x) > Math.abs(d) + 4) { start = null; return; }
        if (d < 6) return;
        if (!start.grip && sheet.scrollTop > 0) { start = null; return; }
        dragging = true;
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, d);
      const dt = e.timeStamp - lastT;
      if (dt > 0) speed = (t.clientY - lastY) / dt;
      lastY = t.clientY; lastT = e.timeStamp;
      place(dy, false);
    };
    const onEnd = () => {
      if (!start) return;
      const was = dragging;
      start = null; dragging = false;
      if (!was) return;
      if (dy > Math.min(140, sheet.offsetHeight * 0.3) || speed > 0.5) {
        place(sheet.offsetHeight + 40, true);
        setTimeout(() => close.current(), 220);
      } else place(0, true);
    };
    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
    };
  }, [open]);
  return ref;
}

// A pop-up: a centred box on a computer, a sheet from the bottom on a phone (drag
// it down, tap outside it or tap the X to close).
export function Dialog({ title, label, icon, wide, onClose, children }) {
  const sheet = useSheetDrag(true, onClose);
  return html`<div className="modal" onClick=${onClose}>
    <div ref=${sheet} className=${cx("modal__box", wide && "modal__box--wide")} role="dialog" aria-modal="true"
      aria-label=${label || title} onClick=${(e) => e.stopPropagation()}>
      <div className="drawer__grip modal__grip" />
      <div className="modal__head">
        <h2 className="h-sec">${icon && html`<${Icon} name=${icon} size=${17} />`} ${title}</h2>
        <${IconBtn} icon="x" bare onClick=${onClose} aria-label="Close" />
      </div>
      ${children}
    </div>
  </div>`;
}

const coarsePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/* ------------------------------- Swipe row -------------------------------- */
// A list row that slides left under a finger to show its actions, as in iPhone lists.
// `actions`: [{ label, icon, danger, onClick }]. One row is open at a time. With a mouse
// nothing slides; the row's own menu has the same actions.
let openRow = null;
const ACTION_PX = 76;
export function SwipeRow({ actions, className = "", children }) {
  const ref = useRef(null);
  const room = actions.length * ACTION_PX;
  const state = useRef({ x: 0 });
  const place = (x, ease) => {
    const el = ref.current;
    if (!el) return;
    state.current.x = x;
    el.style.transition = ease ? "transform .28s cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = x ? `translateX(${x}px)` : "";
  };
  const close = useRef(() => place(0, true));
  useEffect(() => {
    const el = ref.current;
    if (!el || !room) return undefined;
    let start = null, sliding = false;
    const down = (e) => {
      if (openRow && openRow !== close) { openRow.current(); openRow = null; }
      if (e.touches.length !== 1 || e.touches[0].clientX < 28) { start = null; return; } // the left edge is for going back
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, from: state.current.x };
      sliding = false;
    };
    const move = (e) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
      if (!sliding) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { start = null; return; }
        if (Math.abs(dx) < 10) return;
        sliding = true;
      }
      if (e.cancelable) e.preventDefault();
      const want = start.from + dx;
      place(want > 0 ? 0 : want < -room ? -room + (want + room) * 0.25 : want, false);
    };
    const up = (e) => {
      if (sliding) {
        const show = state.current.x < -room * 0.4;
        place(show ? -room : 0, true);
        openRow = show ? close : null;
        if (e.cancelable) e.preventDefault(); // the slide isn't a tap
      }
      start = null; sliding = false;
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
    return () => {
      if (openRow === close) openRow = null;
      el.removeEventListener("touchstart", down); el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up); el.removeEventListener("touchcancel", up);
    };
  }, [room]);
  // A tap on an open row closes it instead of opening what's in it.
  const onClickCapture = (e) => {
    if (state.current.x < 0) { e.stopPropagation(); e.preventDefault(); place(0, true); openRow = null; }
  };
  return html`<li className=${cx("swiperow", className)}>
    ${room > 0 && html`<div className="swiperow__acts" aria-hidden="true">
      ${actions.map((a) => html`<button type="button" tabIndex=${-1} key=${a.label} className=${a.danger ? "is-danger" : ""}
        onClick=${() => { place(0, true); openRow = null; a.onClick(); }}><${Icon} name=${a.icon} size=${19} /><span>${a.label}</span></button>`)}
    </div>`}
    <div className="swiperow__face" ref=${ref} onClickCapture=${onClickCapture}>${children}</div>
  </li>`;
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

// With a mouse, a click on a bar opens its photos. On a touch screen the bars are
// narrower than a fingertip, so a touch (or a drag across the chart) picks the hour
// and shows it below, with a button to open its photos.
export function Histogram({ hours, onSelect }) {
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  const Col = onSelect ? "button" : "div";
  const [touch] = useState(coarsePointer);
  const [picked, setPicked] = useState(null);
  const scrub = !!onSelect && touch;
  const wrap = useRef(null);
  const pickAt = (e) => {
    const r = wrap.current.getBoundingClientRect();
    setPicked(Math.min(23, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 24))));
  };
  const count = picked == null ? 0 : hours[picked];
  return html`<div className="histwrap">
    <div className=${cx("hist", scrub && "is-scrub")} ref=${wrap}
      onPointerDown=${scrub ? pickAt : undefined}
      onPointerMove=${scrub ? (e) => { if (e.pointerType !== "mouse" || e.buttons) pickAt(e); } : undefined}>
      ${hours.map((v, h) => {
        const pct = (v / max) * 100;
        const cls = v === 0 ? "hist__bar dim" : (h === peak ? "hist__bar peak" : "hist__bar");
        return html`<${Col} className=${cx("hist__col", onSelect && "is-btn", scrub && picked === h && "is-picked")} key=${h}
          onClick=${!onSelect ? undefined : scrub ? () => setPicked(h) : () => onSelect(h)}
          aria-pressed=${scrub ? picked === h : undefined}
          title=${`${labelHour(h)} · ${v} photo${v === 1 ? "" : "s"}`}>
          <div className=${cls} style=${{ height: Math.max(pct, v > 0 ? 6 : 2) + "%" }} />
        </${Col}>`;
      })}
    </div>
    <div className="axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
    ${scrub && html`<div className="hist__readout" role="status">
      ${picked == null
        ? html`<span className="faint">Touch a bar to pick an hour</span>`
        : html`<span><b>${labelHour(picked)}</b> · ${count} photo${count === 1 ? "" : "s"}</span>
            <${Btn} sm variant="primary" iconRight="arrowRight" disabled=${!count} onClick=${() => onSelect(picked)}>See photos</${Btn}>`}
    </div>`}
  </div>`;
}

// On a touch screen a chart's marks are narrower than a fingertip: touching or dragging
// picks one, shows it, and a button opens its photos. `spot` turns a pointer position
// into a mark's number. Returns the handlers, the pick, and the line to show under it.
function useScrub(active, spot, count, describe, onOpen, hint) {
  const ref = useRef(null);
  const [picked, setPicked] = useState(null);
  const pickAt = (e) => {
    const r = ref.current.getBoundingClientRect();
    const i = spot((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (i != null && i >= 0 && i < count) setPicked(i);
  };
  const at = picked != null && picked < count ? picked : null;
  const d = at == null ? null : describe(at);
  return {
    ref, picked: at, setPicked,
    props: active ? { onPointerDown: pickAt, onPointerMove: pickAt } : {},
    readout: active && html`<div className="hist__readout" role="status">
      ${d ? html`<span><b>${d.label}</b> · ${d.n} photo${d.n === 1 ? "" : "s"}</span>
          <${Btn} sm variant="primary" iconRight="arrowRight" disabled=${!d.n} onClick=${() => onOpen(at)}>See photos</${Btn}>`
        : html`<span className="faint">${hint}</span>`}
    </div>`,
  };
}
const across = (n) => (x) => Math.min(n - 1, Math.max(0, Math.floor(x * n)));

// Compact 24-hour activity strip (one bar per hour), highlighting a peak window.
// Each strip is normalized to its own max so a species' shape is always readable.
export function HourStrip({ hours, color = "var(--accent)", peak, onSelect }) {
  const max = Math.max(1, ...hours);
  const inPeak = (h) => {
    if (!peak) return false;
    const { start, end } = peak;
    return start <= end ? h >= start && h < end : h >= start || h < end;
  };
  const [touch] = useState(coarsePointer);
  const scrub = !!onSelect && touch;
  const pick = useScrub(scrub, across(24), 24, (h) => ({ label: labelHour(h), n: hours[h] }), onSelect, "");
  const Cell = onSelect && !scrub ? "button" : "span";
  return html`<${Fragment}>
    <div className=${cx("hourstrip", scrub && "is-scrub")} ref=${pick.ref} ...${pick.props}
      role=${onSelect && !scrub ? undefined : "img"} aria-label="Activity by hour">
      ${hours.map((v, h) => html`<${Cell} key=${h} className=${cx("hourstrip__c", inPeak(h) && "is-peak", onSelect && !scrub && "is-btn", pick.picked === h && "is-picked")}
        onClick=${onSelect && !scrub ? () => onSelect(h) : undefined}
        title=${`${labelHour(h)} · ${v} capture${v === 1 ? "" : "s"}`}>
        <i style=${{ height: Math.max((v / max) * 100, v > 0 ? 14 : 0) + "%", background: color }} />
      </${Cell}>`)}
    </div>
    ${pick.picked != null && pick.readout}
  </${Fragment}>`;
}

export function Sparkbars({ data, onSelect }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [touch] = useState(coarsePointer);
  const scrub = !!onSelect && touch;
  const pick = useScrub(scrub, across(data.length), data.length,
    (i) => ({ label: data[i].label, n: data[i].value }), (i) => onSelect(data[i], i), "Touch a bar to pick a day");
  const Bar = onSelect && !scrub ? "button" : "div";
  return html`<${Fragment}>
    <div className=${cx("spark", scrub && "is-scrub")} ref=${pick.ref} ...${pick.props}>
      ${data.map((d, i) => html`<${Bar} className=${cx("spark__b", onSelect && !scrub && "is-btn", pick.picked === i && "is-picked")} key=${i}
        onClick=${onSelect && !scrub ? () => onSelect(d, i) : undefined}
        style=${{ height: Math.max((d.value / max) * 100, d.value > 0 ? 8 : 3) + "%" }}
        title=${(d.label ? d.label + " · " : "") + d.value}><i /></${Bar}>`)}
    </div>
    ${pick.readout}
  </${Fragment}>`;
}

export function CalHeat({ counts, weeks = 26, onSelect }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [touch] = useState(coarsePointer);
  const scrub = !!onSelect && touch;
  const span = scrub ? Math.min(weeks, 18) : weeks; // fewer weeks on a phone, so days are bigger
  const start = new Date(today);
  start.setDate(start.getDate() - (span * 7 - 1));
  start.setDate(start.getDate() - start.getDay()); // back to Sunday
  const cells = [];
  let max = 1;
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const n = counts.get(isoDay(d)) || 0;
    if (n > max) max = n;
    cells.push({ key: isoDay(d), n, date: new Date(d) });
  }
  const columns = Math.ceil(cells.length / 7);
  const pick = useScrub(scrub, (x, y) => across(columns)(x) * 7 + across(7)(y), cells.length,
    (i) => ({ label: fmtDate(cells[i].date), n: cells[i].n }), (i) => onSelect(cells[i].key, cells[i].date), "Touch a square to pick a day");
  const shade = (n) => n === 0
    ? "var(--surface-3)"
    : `color-mix(in srgb, var(--accent) ${20 + Math.ceil((n / max) * 4) * 18}%, var(--surface-3))`;
  const Cell = onSelect && !scrub ? "button" : "div";
  return html`<div>
    <div className=${cx("cal", scrub && "is-scrub")} ref=${pick.ref} ...${pick.props}>
      ${cells.map((c, i) => html`<${Cell} key=${c.key} className=${cx("cal__cell", onSelect && !scrub && "is-btn", pick.picked === i && "is-picked")}
        onClick=${onSelect && !scrub ? () => onSelect(c.key, c.date) : undefined}
        style=${{ background: shade(c.n) }}
        title=${`${fmtDate(c.date)} · ${c.n} capture${c.n === 1 ? "" : "s"}`} />`)}
    </div>
    ${pick.readout}
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
  const health = healthItems(row.health);
  const checkIn = checkInAge(row.health);
  const quietHint = !row.quiet ? ""
    : checkIn != null && checkIn < STALE_CHECKIN_MS
      ? `No new photos lately, but the camera checked in ${timeAgo(new Date(row.health.lastCheckIn))}, so it's probably just a quiet spot.`
      : health.length
        ? "No new photos lately. Battery and signal are under the camera name."
        : "No new photos lately. This can just mean no activity \u2014 if not, check battery and signal in the SPYPOINT app.";
  // A phone shows each camera as one line: a dot for its state, a short name, when it
  // last sent a photo. The "Active" pill and the longer wording are for wider screens.
  const short = shortCamera(name);
  return html`<button className="camcard" onClick=${onClick} title=${`Show photos from ${name}`}>
    <span className="camcard__top">
      <span className=${cx("camcard__dot", row.quiet && "is-quiet")} aria-hidden="true" />
      <span className="camcard__name">
        ${short !== name
          ? html`<span className="shot__cam-full">${name}</span><span className="shot__cam-short">${short}</span>`
          : name}
      </span>
      <span className=${cx("pill", row.quiet ? "is-quiet" : "is-ok")} title=${quietHint}>
        ${row.quiet ? (row.quietDays == null ? "No photos" : `Quiet ${row.quietDays}d`) : "Active"}
      </span>
    </span>
    <span className="camcard__sub">
      ${row.last
        ? html`<span className="camcard__wide">Last photo </span>${timeAgo(row.last)} \u00b7 ${row.week} this week`
        : "Nothing received yet"}
    </span>
    ${health.length > 0 && html`<span className="camcard__health">
      ${health.map((h) => html`<span key=${h.key} className=${cx("camcard__stat", h.warn && "is-warn")} title=${h.title}>${h.text}</span>`)}
    </span>`}
  </button>`;
}

// What SPYPOINT last reported about a camera, as short labels. Anything it didn't
// report is left out; values that need a trip to the camera are flagged.
const STALE_CHECKIN_MS = 36 * 3600000;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function checkInAge(health) {
  const t = health && health.lastCheckIn ? Date.parse(health.lastCheckIn) : NaN;
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : null;
}
export function healthItems(health) {
  if (!health) return [];
  const out = [];
  const battery = num(health.battery);
  if (battery != null) out.push({ key: "bat", text: `Battery ${battery}%`, warn: battery <= 25,
    title: battery <= 25 ? "Battery is low" : `Battery${health.power ? ` (${String(health.power).toLowerCase()})` : ""}` });
  const bars = num(health.signalBars), signal = num(health.signal);
  if (bars != null || signal != null) {
    const weak = bars != null ? bars <= 1 : signal <= 20;
    out.push({ key: "sig", text: bars != null ? `Signal ${bars}/5` : `Signal ${signal}%`, warn: weak,
      title: weak ? "Weak signal: photos may arrive late or not at all" : "Cell signal" });
  }
  const sd = num(health.sdUsed);
  if (sd != null) out.push({ key: "sd", text: `SD ${sd}%`, warn: sd >= 90,
    title: sd >= 90 ? "SD card is nearly full" : "SD card used" });
  const used = num(health.planPhotos), cap = num(health.planLimit);
  if (used != null && cap) out.push({ key: "plan", text: `Plan ${used}/${cap}`, warn: used >= cap * 0.9,
    title: used >= cap * 0.9 ? "Close to the plan's photo limit" : "Photos used on the SPYPOINT plan" });
  const age = checkInAge(health);
  if (age != null && age >= STALE_CHECKIN_MS) out.push({ key: "chk", warn: true,
    text: `Checked in ${timeAgo(new Date(health.lastCheckIn))}`,
    title: "The camera hasn't reported to SPYPOINT lately: check its battery and signal" });
  return out;
}

/* ------------------------------ Photo tile ------------------------------ */
// "Food Plot (Tall Stand)" -> "Food Plot": the part in brackets is detail a phone tile
// has no room for. The full name is still in the tile's title and the photo view.
export const shortCamera = (name) => String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || name;

const LONG_PRESS_MS = 450;
export function Shot({ capture, species, onClick, onLongPress, cameraLabel, selectable, selected, burst, timeLabel }) {
  const c = capture;
  const cam = cameraLabel || c.camera;
  const short = shortCamera(cam);
  // Press and hold (touch) starts selecting. Selecting reflows the grid, so the click
  // that follows the hold can land anywhere; the next click on the page is eaten.
  const press = useRef(null);
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  const onPointerDown = (e) => {
    if (!onLongPress || e.pointerType === "mouse") return;
    const start = { x: e.clientX, y: e.clientY };
    press.current = { start, timer: setTimeout(() => {
      press.current = null;
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", eat, true), 800);
      if (navigator.vibrate) navigator.vibrate(12);
      onLongPress();
    }, LONG_PRESS_MS) };
  };
  const onPointerMove = (e) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) > 10) cancelPress();
  };
  return html`<button className=${cx("shot", selectable && "is-selectable", selected && "is-selected")}
      onClick=${onClick} title=${`${species} · ${cam}`}
      onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerUp=${cancelPress}
      onPointerCancel=${cancelPress} onPointerLeave=${cancelPress}
      onContextMenu=${onLongPress ? (e) => e.preventDefault() : undefined}>
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
      <span className="shot__cam">
        ${short !== cam
          ? html`<span className="shot__cam-full">${cam}</span><span className="shot__cam-short">${short}</span>`
          : html`<span>${cam}</span>`}
      </span>
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
  // Temperature and moon are read from the photo; fixing them is rare, so the two
  // boxes stay folded away until asked for.
  const [fixing, setFixing] = useState(false);
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
      ${fixing && html`<label className="lb__field">
        <span><${Icon} name="thermo" size=${13} />Temp \u00b0F</span>
        <input type="number" inputMode="numeric" value=${temp}
          onInput=${(e) => setTemp(e.target.value)} onBlur=${commitTemp}
          onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} placeholder="\u2014" />
      </label>`}
      ${fixing && html`<label className="lb__field">
        <span><${Icon} name="moon" size=${13} />Moon</span>
        <input type="text" value=${moon}
          onInput=${(e) => setMoon(e.target.value)} onBlur=${commitMoon}
          onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} placeholder="\u2014" maxLength=${40} />
      </label>`}
    </div>
    ${!fixing && html`<button type="button" className="lb__link lb__fixlink" onClick=${() => setFixing(true)}>
      Fix the temperature or moon
    </button>`}
  </div>`;
}

// Fix or remove a photo someone added with the Upload button. The person who added
// it and admins can edit or delete it; the Animal field above handles species.
const OTHER_CAMERA = "Other camera";
export function UploadEdit({ capture, cameras, camName, auth, onSignIn, onEdit, onDelete }) {
  const c = capture;
  const mine = canEditUpload(auth, c);
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
    if (!(await confirmSheet({ title: "Delete this upload for everyone?", message: "Its comments and notes go with it. This can't be undone." }))) return;
    setBusy(true);
    await onDelete();
    setBusy(false);
  };

  return html`<div className="lb__edit lb__upload">
    <div className="lb__edit-head">
      <span className="lb__edit-title"><${Icon} name="upload" size=${14} />${c.uploadedBy ? `Added by ${c.uploadedBy}` : "Upload"}</span>
      ${!auth && html`<button className="lb__link" onClick=${onSignIn}>Sign in to edit or delete</button>`}
    </div>
    ${auth && !mine && html`<p className="form-note">Only ${c.uploadedBy || "an admin"}${c.uploadedBy ? " or an admin" : ""} can change this upload.</p>`}
    ${mine && html`<${Fragment}>
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
// `controls` receives zoomIn / zoomOut / reset / toggle for the keys and toolbar button.
export function ZoomImage({ capture, alt, onZoomChange, controls }) {
  const frame = useRef(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [moving, setMoving] = useState(false);
  // Fixed per photo: once the host is known to allow it, photos load in a way the
  // share sheet can reuse (see checkShareFiles). Never switched on a shown photo.
  const [cors] = useState(() => (shareFilesOk === true ? "anonymous" : undefined));
  // On a phone the small copy (usually already on the phone from the grid) shows at
  // once, stretched to size, and the full photo takes its place when it has arrived.
  // On a weak signal that's a soft photo for a moment, not an empty screen.
  const [src, setSrc] = useState(() => (capture.thumb && coarsePointer() ? capture.thumb : capture.image));
  useEffect(() => {
    if (src === capture.image) return undefined;
    let live = true;
    const full = new Image();
    if (cors) full.crossOrigin = cors;
    const show = () => { if (live) setSrc(capture.image); };
    full.onload = show;
    full.onerror = show;
    full.src = capture.image;
    return () => { live = false; full.onload = null; full.onerror = null; };
  }, []);
  const [hint, setHint] = useState(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(null);

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
  const toggle = () => toggleAt(middle());
  if (controls) controls.current = { zoomIn, zoomOut, reset, toggle };

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
    setHint(touch ? "Swipe for more · pinch to zoom" : "Click to zoom, scroll for more");
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
    if (e.type !== "pointerup") return;
    // Mouse: one click zooms in on that spot, or back out. A drag (to pan) isn't a click.
    if (e.pointerType === "mouse") {
      if (wasTap) { setHint(null); toggleAt(local(e)); }
      return;
    }
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

  // Zooming is done on the photo itself (click, double-tap, pinch, scroll) or with the
  // zoom button in the viewer's top bar. The level shows briefly while it changes.
  return html`<div ref=${frame} className=${cx("lb__zoom", zoomed && "is-zoomed", moving && "is-moving")}
      onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
      onPointerUp=${onPointerEnd} onPointerCancel=${onPointerEnd}>
    <img className=${cx("lb__img", src !== capture.image && "is-preview")} src=${src} alt=${alt} draggable=${false} crossOrigin=${cors}
      onError=${() => { if (src !== capture.image) setSrc(capture.image); }}
      style=${{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} />
    ${hint && html`<span className="lb__zoomhint" role="status">${hint}</span>`}
    ${zoomed && html`<span className="lb__zoomlevel" key=${view.s} aria-live="polite">${formatZoom(view.s)}</span>`}
  </div>`;
}

/* --------------------------------- Share --------------------------------- */
// The phone's share sheet (Messages, AirDrop, Save to Photos). The photo itself is
// attached when its host allows the site to download it (CORS on the R2 bucket);
// otherwise the share carries a link to the photo, which Messages shows as the
// picture. It's fetched ahead of the tap because iPhones only open the share sheet
// straight from a tap, not after waiting on a download.
//
// Whether the host allows it is checked once per visit with a separate URL (the
// small preview plus a marker). Asking for the on-screen photo's own URL in a way
// the host refuses can stop that photo from showing, so that URL is only fetched
// once the answer is yes, and from then on the viewer loads photos the same way
// (crossOrigin), so the share copy comes from the browser cache, not a second download.
export let shareFilesOk = null; // null = not checked yet
let shareProbe = null;
function checkShareFiles(c) {
  if (shareFilesOk !== null) return Promise.resolve(shareFilesOk);
  if (!shareProbe) {
    const src = c.thumb || c.image;
    shareProbe = fetch(src + (src.includes("?") ? "&" : "?") + "share-check=1", { mode: "cors", cache: "no-store" })
      .then((r) => (shareFilesOk = r.ok), () => (shareFilesOk = false));
  }
  return shareProbe;
}

function usePhotoShare(c, species, cameraLabel, onToast) {
  const file = useRef(null);
  const id = c && c.id;
  useEffect(() => {
    file.current = null;
    if (!c || !c.image || c.media === "video" || !navigator.canShare) return;
    const ctrl = new AbortController();
    checkShareFiles(c)
      .then((ok) => (ok && !ctrl.signal.aborted ? fetch(c.image, { mode: "cors", signal: ctrl.signal }) : null))
      .then((r) => (r && r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob) return;
        const name = `${species}-${isoDay(c.date)}.jpg`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
        const f = new File([blob], name, { type: blob.type || "image/jpeg" });
        if (navigator.canShare({ files: [f] })) file.current = f;
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [id]);

  return () => {
    if (!c || !c.image) return;
    const url = new URL(c.image, window.location.href).href;
    const text = `${species} · ${cameraLabel || c.camera} · ${fmtDateTime(c.date)}`;
    const copyLink = () => navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(url).then(() => onToast && onToast("ok", "Photo link copied"), () => window.open(url, "_blank"))
      : window.open(url, "_blank");
    if (!navigator.share) { copyLink(); return; }
    const data = file.current ? { files: [file.current], text } : { title: "Vale Trails", text, url };
    navigator.share(data).catch((e) => { if (e && e.name !== "AbortError") copyLink(); });
  };
}

/* -------------------------- Swipe from the edge ---------------------------
   In the iPhone Home Screen app there's no browser around the page, so no system
   swipe-back. A drag that starts at the left edge slides the photo view away and
   goes back to the tab, as in iPhone apps. Safari and Android have their own back
   gesture (closing the photo through history, see main.js), so this stays off there
   to never go back twice. */
const EDGE_PX = 28;
export const edgeBackHere = () => {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && (navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches);
};

// One-tap labels for the common cases; "Other…" opens the full list in the details.
const QUICK_TAGS = ["Buck", "Doe", "Deer", "Empty"];

export function Lightbox({ capture, species, cameraLabel, meta, onMeta, onToggleFavorite, onTag, onToast, buckNames, comments, upload, signedIn, onSignIn, onClose, onPrev, onNext, hasPrev, hasNext, position, total, neighbors }) {
  const share = usePhotoShare(capture, species, cameraLabel, onToast);
  // Phones: the row of one-tap labels above the action bar, opened by its Tag button.
  const [tagOpen, setTagOpen] = useState(false);
  const zoomControls = useRef(null);
  const [zoomed, setZoomed] = useState(false);
  const [navIdle, setNavIdle] = useState(false);
  // Full screen is just the photo: details hidden, controls fading out when idle.
  // The browser's Fullscreen API is used when there is one; iPhones don't offer it
  // for photos, and there the same view simply fills the page.
  const [immersive, setImmersive] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const panel = useRef(null);
  const navTimer = useRef(null);
  const root = useRef(null);
  const stage = useRef(null);
  const lastPointer = useRef("mouse");
  const tapTimer = useRef(null);
  const photoId = capture && capture.id;
  const wakeNavigation = () => {
    setNavIdle(false);
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => setNavIdle(true), 2500);
  };
  useEffect(() => {
    wakeNavigation();
    return () => {
      if (navTimer.current) clearTimeout(navTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);
  // Leaving the browser's full screen (Esc, a swipe, its own button) leaves ours too.
  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) setImmersive(false); };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const enterFullscreen = () => {
    setImmersive(true);
    wakeNavigation();
    const el = root.current;
    if (el && el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen({ navigationUI: "hide" }).catch(() => { /* the in-page view still works */ });
    }
  };
  const exitFullscreen = () => {
    setImmersive(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  const toggleFullscreen = () => (immersive ? exitFullscreen() : enterFullscreen());
  // In full screen a single tap on the photo shows or hides the controls. It waits a
  // moment so a double-tap (zoom) isn't also read as two single taps.
  const onStageClick = (e) => {
    e.stopPropagation();
    // On a phone, tapping the photo while the details sheet is up lowers the sheet.
    if (sheetOpen && !e.target.closest(".lb__panel, button")) { setSheetOpen(false); return; }
    if (tagOpen && !e.target.closest(".lb__tagpop, .lb__bar")) { setTagOpen(false); return; }
    if (!immersive || lastPointer.current === "mouse" || !e.target.closest(".lb__zoom")) return;
    if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; return; }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      if (navTimer.current) clearTimeout(navTimer.current);
      setNavIdle((idle) => !idle);
    }, 280);
  };
  useEffect(() => {
    const onKey = (e) => {
      // Arrow keys belong to the field or video being used, not photo navigation.
      if (e.key !== "Escape" && /^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(e.target.tagName)) return;
      const zoom = zoomControls.current;
      if (e.key === "Escape" && immersive) exitFullscreen();
      else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && capture && capture.media !== "video") toggleFullscreen();
      else if (e.key === "Escape") onClose();
      else if ((e.key === "+" || e.key === "=") && zoom) zoom.zoomIn();
      else if ((e.key === "-" || e.key === "_") && zoom) zoom.zoomOut();
      else if (e.key === "0" && zoom) zoom.reset();
      else if (e.key === "ArrowLeft" && hasPrev) onPrev();
      else if (e.key === "ArrowRight" && hasNext) onNext();
      wakeNavigation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext, immersive, capture]);

  // The page behind shouldn't scroll while a photo is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, []);

  // Each photo starts at the top, even if the details were scrolled down.
  useEffect(() => {
    if (stage.current) stage.current.scrollTop = 0;
    if (panel.current) panel.current.scrollTop = 0;
    setTagOpen(false);
  }, [photoId]);

  // The photos either side are fetched ahead (small copies of both, and the full
  // copy of the next), so a swipe shows a photo, not a wait.
  useEffect(() => {
    const [prev, next] = neighbors || [];
    const cors = shareFilesOk === true ? "anonymous" : undefined;
    const fetchAhead = (url) => { if (!url) return; const im = new Image(); if (cors) im.crossOrigin = cors; im.src = url; };
    const t = setTimeout(() => {
      for (const n of [prev, next]) if (n && n.media !== "video") fetchAhead(n.thumb);
      if (next && next.media !== "video") fetchAhead(next.image);
    }, 350);
    return () => clearTimeout(t);
  }, [photoId]);

  // A swipe to the next photo slides this one off; when the next one is drawn it
  // comes in from the side it was waiting on (see fling, below).
  const flung = useRef(null);
  useLayoutEffect(() => {
    const el = root.current;
    const dir = flung.current;
    flung.current = null;
    if (!el) return undefined;
    el.style.removeProperty("--dragx");
    if (!dir) { delete el.dataset.swipe; return undefined; }
    el.dataset.swipe = "from-" + dir;
    const t = setTimeout(() => { if (el.dataset.swipe === "from-" + dir) delete el.dataset.swipe; }, 260);
    return () => clearTimeout(t);
  }, [photoId]);

  // Swipe on a photo: sideways moves between photos; on a phone, down closes the
  // view and up raises the details. Videos are left out because dragging there
  // belongs to the player's seek bar, and a zoomed photo uses drags to pan.
  const swipe = useRef(null);
  // Big phones on their side are wider than 900px, so a short touch screen counts too.
  const isPhone = () => window.matchMedia("(max-width: 900px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)").matches;
  // On a phone held sideways the details slide in from the right instead of up.
  const isSidePanel = () => window.matchMedia("(orientation: landscape) and (max-height: 500px) and (pointer: coarse)").matches;
  const setDrag = (dy) => {
    const el = root.current;
    if (!el) return;
    if (dy == null) {
      el.classList.remove("is-dragging");
      el.style.removeProperty("--drag");
      el.style.removeProperty("--drag-fade");
      return;
    }
    el.classList.add("is-dragging");
    el.style.setProperty("--drag", dy + "px");
    el.style.setProperty("--drag-fade", String(Math.max(0.25, 1 - dy / 420)));
  };
  // Sideways the photo follows the finger too. `data-swipe` (not a class, which a
  // redraw would wipe) tells the styles whether it's being dragged or let go.
  const setSide = (dx) => {
    const el = root.current;
    if (!el) return;
    if (dx == null) { delete el.dataset.swipe; el.style.removeProperty("--dragx"); return; }
    el.dataset.swipe = "drag";
    el.style.setProperty("--dragx", dx + "px");
  };
  // Let go far enough: the photo slides off that side, then the next one is shown
  // (and slides in, see the effect above).
  const fling = (dir) => {
    const el = root.current;
    if (!el) { (dir === "next" ? onNext : onPrev)(); return; }
    el.dataset.swipe = "fling";
    el.style.setProperty("--dragx", (dir === "next" ? -1 : 1) * window.innerWidth + "px");
    setTimeout(() => { flung.current = dir; (dir === "next" ? onNext : onPrev)(); }, 150);
  };
  const onTouchStart = (e) => {
    const t = e.touches[0];
    if (edgeOn && t.clientX <= EDGE_PX) { swipe.current = null; return; } // that's a back swipe
    // Anywhere on the photo or the space around it. A video keeps its drags for its
    // own seek bar, but the space around a video still swipes on to the next photo.
    const free = !(e.target.closest && e.target.closest("video, button, a, .lb__panel, .lb__bar, .lb__tagpop"));
    swipe.current = !zoomed && free && e.touches.length === 1 && root.current.dataset.swipe !== "fling"
      ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchMove = (e) => {
    if (e.touches.length > 1) { swipe.current = null; setDrag(null); setSide(null); return; }
    const s = swipe.current;
    if (!s || !isPhone() || sheetOpen) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.way) {
      if (dy > 12 && dy > Math.abs(dx) * 1.3) s.way = "down";
      else if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) s.way = "side";
    }
    // The photo follows a downward drag and the backdrop fades, so it's clear that
    // letting go will close it.
    if (s.way === "down") setDrag(Math.max(0, dy));
    // At the first or last photo it only gives a little, to show there's no more.
    else if (s.way === "side") setSide((dx < 0 ? hasNext : hasPrev) ? dx : dx * 0.25);
  };
  const onTouchEnd = (e) => {
    const s = swipe.current;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    swipe.current = null;
    setDrag(null);
    const vertical = Math.abs(dy) > Math.abs(dx) * 1.3;
    if (isPhone() && vertical && dy > 90) { setSide(null); if (sheetOpen) setSheetOpen(false); else onClose(); return; }
    if (isPhone() && vertical && dy < -50 && !immersive) { setSide(null); setSheetOpen(true); return; }
    const dir = dx < 0 ? "next" : "prev";
    const far = Math.abs(dx) >= 50 && Math.abs(dx) >= Math.abs(dy) * 1.5;
    if (!far || !(dir === "next" ? hasNext : hasPrev)) { setSide(null); return; } // springs back
    if (s.way === "side") fling(dir);
    else { setSide(null); (dir === "next" ? onNext : onPrev)(); }
  };

  // "Other…" brings up the full Animal list in the details.
  const openOtherTags = () => {
    setSheetOpen(true);
    setTimeout(() => {
      const select = panel.current && panel.current.querySelector(".lb__corrections select");
      if (!select) return;
      select.scrollIntoView({ block: "center", behavior: "smooth" });
      select.focus({ preventScroll: true });
      if (select.showPicker) { try { select.showPicker(); } catch (e) {} }
    }, 320);
  };

  const edgeOn = useState(edgeBackHere)[0];
  const edge = useRef(null);
  const onEdgeStart = (e) => {
    edge.current = null;
    if (!edgeOn || zoomed || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > EDGE_PX) return;
    edge.current = { x: t.clientX, y: t.clientY, at: e.timeStamp, dx: 0, live: false };
  };
  const onEdgeMove = (e) => {
    const g = edge.current;
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.live) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > dx) { edge.current = null; return; } // a scroll, not a back swipe
      if (dx < 8) return;
      g.live = true;
      root.current.classList.add("is-edge");
    }
    g.dx = Math.max(0, dx);
    g.at2 = e.timeStamp;
    root.current.style.setProperty("--edge", g.dx + "px");
  };
  const onEdgeEnd = (e) => {
    const g = edge.current;
    edge.current = null;
    if (!g || !g.live) return;
    const el = root.current;
    const speed = g.dx / Math.max(1, (g.at2 || e.timeStamp) - g.at); // px per ms
    const back = g.dx > window.innerWidth * 0.33 || (speed > 0.5 && g.dx > 40);
    el.classList.add("is-edge-settle");
    el.style.setProperty("--edge", back ? window.innerWidth + "px" : "0px");
    setTimeout(() => {
      if (back) { onClose(); return; }
      el.classList.remove("is-edge", "is-edge-settle");
      el.style.removeProperty("--edge");
    }, 220);
  };

  // The details sheet (phones): drag its handle up or down, or tap it.
  const sheetDrag = useRef(null);
  const onSheetStart = (e) => {
    if (e.touches.length !== 1 || isSidePanel()) return;
    sheetDrag.current = { y: e.touches[0].clientY, dy: 0, onGrip: !!e.target.closest("button") };
  };
  const onSheetMove = (e) => {
    const d = sheetDrag.current;
    if (!d || !panel.current) return;
    d.dy = e.touches[0].clientY - d.y;
    // Only the direction that makes sense moves: down when open, up when lowered.
    const dy = sheetOpen ? Math.max(0, d.dy) : Math.min(0, d.dy);
    panel.current.classList.add("is-dragging");
    panel.current.style.setProperty("--sheet-drag", dy + "px");
  };
  const onSheetEnd = () => {
    const d = sheetDrag.current;
    sheetDrag.current = null;
    if (!d || !panel.current) return;
    panel.current.classList.remove("is-dragging");
    panel.current.style.removeProperty("--sheet-drag");
    if (Math.abs(d.dy) < 8) { if (!d.onGrip) setSheetOpen((o) => !o); } // a tap (the grip handles its own)
    else if (d.dy < -40) setSheetOpen(true);
    else if (d.dy > 40) setSheetOpen(false);
  };

  if (!capture) return null;
  const c = capture;
  return html`<div ref=${root} className=${cx("lb", navIdle && "is-nav-idle", immersive && "is-immersive", sheetOpen && "is-sheet-open")} onClick=${onClose}
      onPointerMove=${(e) => { lastPointer.current = e.pointerType; if (e.pointerType === "mouse") wakeNavigation(); }}
      onPointerDown=${(e) => { lastPointer.current = e.pointerType; if (e.pointerType === "mouse") wakeNavigation(); }}
      onTouchStart=${onEdgeStart} onTouchMove=${onEdgeMove} onTouchEnd=${onEdgeEnd} onTouchCancel=${onEdgeEnd}>
    <div className=${cx("lb__stage", zoomed && "is-zoomed")} ref=${stage} onClick=${onStageClick}
      onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd}
      onTouchCancel=${() => { swipe.current = null; setDrag(null); setSide(null); }}>
      ${c.image && c.media === "video"
        ? html`<${Media} key=${c.id} className="lb__img" capture=${c} alt=${species} playable />`
        : c.image
        ? html`<${ZoomImage} key=${c.id} capture=${c} alt=${species}
            onZoomChange=${setZoomed} controls=${zoomControls} />`
        : html`<div className="shot__noimg" style=${{ width: "60vw", height: "60vh" }}>No image available</div>`}
      <div className="lb__close"><${IconBtn} icon="x" onClick=${onClose} aria-label="Close" /></div>
      ${c.image && c.media !== "video" && html`<div className="lb__zoomtoggle">
        <${IconBtn} icon=${zoomed ? "zoomOut" : "zoomIn"} onClick=${() => zoomControls.current && zoomControls.current.toggle()}
          aria-label=${zoomed ? "Zoom out" : "Zoom in"} aria-pressed=${zoomed}
          title=${zoomed ? "Zoom out (0)" : "Zoom in (+)"} />
      </div>`}
      ${c.image && (c.media !== "video" || immersive) && html`<div className="lb__fullscreen">
        <${IconBtn} icon=${immersive ? "shrink" : "expand"} onClick=${toggleFullscreen}
          aria-label=${immersive ? "Exit full screen" : "Full screen"}
          aria-pressed=${immersive}
          title=${immersive ? "Exit full screen (F)" : "Full screen (F)"} />
      </div>`}
      ${immersive && html`<div className="lb__caption">
        <${SpeciesDot} species=${species} size=${9} /><b>${species}</b>
        <span>${cameraLabel || c.camera}</span><span>${fmtDateTime(c.date)}</span>
      </div>`}
      ${/* Phones: what the photo is, and the things done most, without opening the details. */ ""}
      <div className="lb__cap">
        <${SpeciesDot} species=${species} size=${9} /><b>${species}</b>
        <span>${shortCamera(cameraLabel || c.camera)} · ${fmtDateTime(c.date)}</span>
        ${total > 1 && html`<span className="lb__count tnum">${position} of ${total}</span>`}
      </div>
      ${tagOpen && onTag && html`<div className="lb__tagpop" role="group" aria-label="What's in this photo">
        ${QUICK_TAGS.map((sp) => html`<button key=${sp} type="button"
          className=${cx("qtag", species === sp && "is-on")} aria-pressed=${species === sp}
          onClick=${() => { if (species !== sp) onTag(sp); setTagOpen(false); }}>
          <span className="sdot" style=${{ background: speciesColor(sp) }} />${sp}
        </button>`)}
        <button type="button" className=${cx("qtag", !QUICK_TAGS.includes(species) && "is-on")}
          onClick=${() => { setTagOpen(false); openOtherTags(); }}>
          ${QUICK_TAGS.includes(species) ? "Other…" : `${species} ▾`}
        </button>
      </div>`}
      <div className="lb__bar" role="toolbar" aria-label="Photo actions">
        ${onToggleFavorite && html`<button type="button" className=${meta && meta.favorite ? "is-on" : ""}
          onClick=${onToggleFavorite} aria-pressed=${!!(meta && meta.favorite)}>
          <${Icon} name="star" size=${22} /><span>${meta && meta.favorite ? "Favorited" : "Favorite"}</span>
        </button>`}
        ${onTag && html`<button type="button" className=${tagOpen ? "is-open" : ""}
          onClick=${() => setTagOpen((o) => !o)} aria-expanded=${tagOpen}>
          <${Icon} name="tag" size=${22} /><span>Tag</span>
        </button>`}
        ${c.image && html`<button type="button" onClick=${share}>
          <${Icon} name="share" size=${22} /><span>Share</span>
        </button>`}
        <button type="button" onClick=${() => { setTagOpen(false); setSheetOpen(true); }} aria-expanded=${sheetOpen}>
          <${Icon} name="info" size=${22} /><span>Details</span>
        </button>
      </div>
      ${hasPrev && html`<button className="lb__nav prev" onClick=${onPrev} aria-label="Previous"><${Icon} name="chevronLeft" size=${22} /></button>`}
      ${hasNext && html`<button className="lb__nav next" onClick=${onNext} aria-label="Next"><${Icon} name="chevronRight" size=${22} /></button>`}
      <div className="lb__panel" ref=${panel}>
        <div className="lb__sheethead" onTouchStart=${onSheetStart} onTouchMove=${onSheetMove}
          onTouchEnd=${onSheetEnd} onTouchCancel=${onSheetEnd}>
        <button type="button" className="lb__grip" onClick=${() => setSheetOpen((o) => !o)}
          aria-label=${sheetOpen ? "Hide details" : "Show details"} aria-expanded=${sheetOpen} />
        <button type="button" className="lb__sheetclose" onClick=${() => setSheetOpen(false)} aria-label="Hide details">
          <${Icon} name="x" size=${18} />
        </button>
        <div className="lb__info">
          <h3>
            <${SpeciesDot} species=${species} size=${12} />${species}
            ${meta && meta.favorite && html`<${Icon} name="star" size=${15} className="lb__fav" />`}
            ${c.image && html`<button type="button" className="lb__share" onClick=${share} aria-label="Share photo" title="Share">
              <${Icon} name="share" size=${17} /><span>Share</span>
            </button>`}
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
        ${onTag && html`<div className="lb__quicktags" role="group" aria-label="What's in this photo">
          ${QUICK_TAGS.map((sp) => html`<button key=${sp} type="button"
            className=${cx("qtag", species === sp && "is-on")} aria-pressed=${species === sp}
            onClick=${() => { if (species !== sp) onTag(sp); }}>
            <span className="sdot" style=${{ background: speciesColor(sp) }} />${sp}
          </button>`)}
          <button type="button" className=${cx("qtag", !QUICK_TAGS.includes(species) && "is-on")} onClick=${openOtherTags}>
            ${QUICK_TAGS.includes(species) ? "Other…" : `${species} ▾`}
          </button>
        </div>`}
        </div>
        ${/* Keys must differ from the comments' key (the photo id, main.js): two siblings
             with one key made React leave the last photo's details behind on Next. */ ""}
        ${onMeta && html`<${LightboxEdit} key=${"meta-" + c.id} capture=${c} species=${species} meta=${meta}
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
