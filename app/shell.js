// Vale Trails — app chrome: sidebar, topbar, mobile nav and the shared filter bar.
import { html, useState, useEffect, useRef, Fragment, createPortal } from "./react.js";
import { Icon, BrandMark } from "./icons.js";
import { IconBtn, Select, Segmented, Switch, Chip, edgeBackHere, useSheetDrag } from "./ui.js";
import { speciesColor, LS, labelHour, getScrollY, faceIdName, isoDay } from "./core.js";
import { RANGE_OPTIONS, rangeLabel, WEEKDAY_PLURAL, NOT_GAME, ALL_DEER, ALL_DEER_HINT, DEER_KINDS, pickColor } from "./analytics.js";
import { UserMenu } from "./account.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");

export const VIEWS = [
  { id: "overview", label: "Home",     icon: "dashboard" },
  { id: "deercast", label: "DeerCast", icon: "gauge" },
  { id: "gallery",  label: "Photos",   icon: "images" },
  { id: "uploads",  label: "Uploads",  icon: "album" },
  { id: "bucks",    label: "Bucks",    icon: "target" },
  { id: "insights", label: "Patterns", icon: "chart" },
  { id: "map",      label: "Map",      icon: "map" },
  { id: "harvest",  label: "Harvests", icon: "tag" },
  { id: "review",   label: "Identify", icon: "scan" },
];

const badgeCount = (n) => (n > 99 ? "99+" : n);
const feedTitle = (s) => (s.demo ? "Demo data" : s.stale ? "Sync delayed" : "Auto-sync on");

/* ------------------------------- Sidebar -------------------------------- */
// Desktop only. The button beside the logo hides it; the menu button in the top
// bar brings it back. Hidden, the page gets the full width.
export function Sidebar({ view, setView, counts, status, onCollapse }) {
  return html`<aside className="sidebar" id="sidebar">
    <div className="brand">
      <${BrandMark} size=${32} />
      <div className="brand__name">Vale Trails</div>
      <button className="sidebar__collapse" type="button" onClick=${onCollapse}
        aria-label="Hide sidebar" aria-controls="sidebar" title="Hide sidebar">
        <${Icon} name="panelLeft" size=${18} />
      </button>
    </div>

    <nav className="nav">
      ${VIEWS.map((v) => html`<a key=${v.id} role="button" tabindex="0"
        className=${cx("nav__item", view === v.id && "is-active")}
        aria-label=${v.label}
        onClick=${() => setView(v.id)}
        onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && setView(v.id)}>
        <${Icon} name=${v.icon} size=${18} /><span className="sidebar__label">${v.label}</span>
        ${v.id === "review" && counts.review > 0 && html`<span className="nav__badge">${badgeCount(counts.review)}</span>`}
      </a>`)}
    </nav>

    <div className="sidebar__foot">
      <div className="datastat">
        <span className=${cx("datastat__dot", (status.demo || status.stale) && "is-demo")} />
        <div>
          <b>${feedTitle(status)}</b>
          <small>${status.checked ? "Checked " + status.checked : "Awaiting sync"}</small>
          ${status.newest && html`<small>Newest photo ${status.newest}</small>`}
        </div>
      </div>
    </div>
  </aside>`;
}

/* -------------------------------- Topbar -------------------------------- */
// `auth` is the signed-in account; saving anything for everyone needs it.
export function Topbar({ title, sub, theme, toggleTheme, onRefresh, refreshing, onUpload, auth, pending, onSignIn, onSignOut, onAccounts, onAlerts, onFaceId, onPassword, sidebarHidden, onShowSidebar, children }) {
  return html`<header className="topbar">
    ${sidebarHidden && html`<${IconBtn} icon="menu" bare className="topbar__menu" onClick=${onShowSidebar}
      aria-label="Show sidebar" aria-controls="sidebar" aria-expanded=${false} title="Show sidebar" />`}
    <div className="topbar__titles">
      <div className="h-page">${title}</div>
      ${sub && html`<div className="sub">${sub}</div>`}
    </div>
    <div className="topbar__spacer" />
    <div className="topbar__actions">
      ${children}
      <${UserMenu} auth=${auth} pending=${pending} onSignIn=${onSignIn} onSignOut=${onSignOut} onAccounts=${onAccounts} onAlerts=${onAlerts} onFaceId=${onFaceId} onPassword=${onPassword} />
      <button className="btn btn--sm" onClick=${onUpload}><${Icon} name="upload" size=${15} /><span>Upload</span></button>
      <${IconBtn} icon="refresh" bare onClick=${onRefresh} title="Refresh data"
        className=${refreshing ? "is-spin" : ""} aria-label="Refresh" />
      <${IconBtn} icon=${theme === "light" ? "moon" : "sun"} bare onClick=${toggleTheme}
        title=${theme === "light" ? "Switch to dark" : "Switch to light"} aria-label="Toggle theme" />
    </div>
  </header>`;
}

/* ----------------------------- Mobile chrome ---------------------------- */
// Past this much scroll the large title has gone under the top bar, so the bar shows
// the page name itself, as iPhone apps do.
const LARGE_TITLE_PX = 40;
function useScrolledPast(px) {
  const [past, setPast] = useState(() => getScrollY() > px);
  useEffect(() => {
    let frame = 0;
    const check = () => { frame = 0; setPast(getScrollY() > px); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    // Capture catches the phone frame's own scrolling (.main) as well as the page's.
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    check();
    return () => { document.removeEventListener("scroll", onScroll, { capture: true }); cancelAnimationFrame(frame); };
  }, [px]);
  return past;
}

// The phone's header: the logo (or a back button on a screen opened from "More"), the
// page name once the large title has scrolled away, and Upload. Everything else that
// used to sit here is on the More tab (account, alerts, appearance) or is a gesture
// (pull down to check for new photos).
export function MobileTopbar({ title, onBack, onUpload }) {
  const collapsed = useScrolledPast(LARGE_TITLE_PX);
  // Its height is shared as --mobile-top-h, so the Photos filter bar can stay pinned
  // just under it.
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => { if (el.offsetHeight) document.documentElement.style.setProperty("--mobile-top-h", el.offsetHeight + "px"); };
    set();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(set) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, []);
  return html`<div ref=${ref} className=${cx("mobile-top", collapsed && "is-collapsed")}>
    ${onBack
      ? html`<button type="button" className="mobile-top__back" onClick=${onBack} aria-label="Back">
          <${Icon} name="chevronLeft" size=${26} /></button>`
      : html`<${BrandMark} size=${30} />`}
    <div className="mobile-top__title" aria-hidden=${!collapsed}>${title}</div>
    <div className="topbar__spacer" />
    <button type="button" className="mobile-top__add" onClick=${onUpload} aria-label="Upload photos">
      <${Icon} name="upload" size=${17} /><span>Upload</span>
    </button>
  </div>`;
}

// The big page name at the top of each phone screen. Home and Photos add a line
// saying whether the photos are current (main.js, titleSub).
export function LargeTitle({ title, sub, warn }) {
  return html`<div className="largetitle">
    <h1>${title}</h1>
    ${sub && html`<small className=${warn ? "is-stale" : ""}>${sub}</small>`}
  </div>`;
}

// Phones get five tabs: four main screens and "More", a list of everything else.
// Seven tabs at phone width made every label tiny and easy to mis-tap.
// Phone tab bar, in this order, then More; everything else is listed on More, also in order.
export const MOBILE_MAIN = ["overview", "gallery", "deercast", "insights", "more"];
export const MOBILE_MORE = ["uploads", "map", "harvest", "review"];
const viewsIn = (ids) => ids.map((id) => VIEWS.find((v) => v.id === id)).filter(Boolean);
const TABS = [...viewsIn(MOBILE_MAIN), { id: "more", label: "More", icon: "grid" }];

// The tab bar. `onTab` switches tabs, scrolls the current one to the top, or closes
// whatever is open on top of it. Its height is shared as --tab-bar-h so pages, photos
// and pop-ups end just above it (styles.css, "Phone app frame").
export function MobileNav({ view, onTab, counts }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => document.documentElement.style.setProperty("--tab-bar-h", el.offsetHeight + "px");
    set();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(set) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", set);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", set); };
  }, []);
  useKeyboardFlag();
  // Bucks opens from Photos, so that tab stays lit under it.
  const activeTab = view === "bucks" ? "gallery" : MOBILE_MORE.includes(view) ? "more" : view;
  return html`<nav className="mobilenav" ref=${ref} aria-label="Tabs">
    ${TABS.map((v) => html`<button key=${v.id} type="button"
      className=${activeTab === v.id ? "is-active" : ""} onClick=${() => onTab(v.id)}
      aria-current=${activeTab === v.id ? "page" : undefined}>
      <${Icon} name=${v.icon} size=${22} />${v.label}
      ${v.id === "more" && counts.review + (counts.pending || 0) > 0
        && html`<span className="nav__badge">${badgeCount(counts.review + (counts.pending || 0))}</span>`}
    </button>`)}
  </nav>`;
}

// While the keyboard is up it covers the tab bar, as in iPhone apps; the bar is
// hidden then, so it never floats over the page as the screen shifts for the field.
// When typing ends, the page is nudged by a pixel and back: iPhone Home Screen apps
// can otherwise keep the shorter keyboard-up screen height, leaving the tab bar
// floating above the bottom of the screen until the page next scrolls.
const TEXT_FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea';
function useKeyboardFlag() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return undefined;
    const root = document.documentElement;
    let timer = 0;
    const onIn = (e) => {
      if (!e.target.matches || !e.target.matches(TEXT_FIELD)) return;
      clearTimeout(timer);
      root.dataset.keyboard = "1";
    };
    const onOut = () => {
      clearTimeout(timer);
      // Moving from one field to the next keeps the keyboard up.
      timer = setTimeout(() => {
        const a = document.activeElement;
        if (a && a.matches && a.matches(TEXT_FIELD)) return;
        delete root.dataset.keyboard;
        const y = window.scrollY;
        window.scrollTo(0, y + 1);
        requestAnimationFrame(() => window.scrollTo(0, y));
      }, 120);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      delete root.dataset.keyboard;
    };
  }, []);
}

/* -------------------------------- More tab ------------------------------- */
// A Settings-style list: the other pages (a chevron: they open on top with a Back
// button), then alerts, Face ID, accounts (no chevron: each is a sheet that slides
// up) and appearance, then the account itself.
function MoreRow({ icon, tint, label, value, badge, chevron = true, tone, onClick, children }) {
  return html`<button type="button" className=${cx("ios-row", tone && "is-" + tone)} onClick=${onClick}>
    ${icon && html`<span className="ios-row__icon" style=${{ background: tint }}><${Icon} name=${icon} size=${17} /></span>`}
    <span className="ios-row__label">${label}</span>
    ${value && html`<span className="ios-row__value">${value}</span>`}
    ${badge > 0 && html`<span className="nav__badge">${badgeCount(badge)}</span>`}
    ${children}
    ${chevron && html`<${Icon} name="chevronRight" size=${17} className="ios-row__chev" />`}
  </button>`;
}

const MORE_TINT = { uploads: "#c2820a", map: "#2a9d6f", harvest: "#b4532a", review: "#8e5bd8" };
export function MoreScreen({ more, counts, auth }) {
  const m = more || {};
  const status = m.status || {};
  return html`<div className="morepage">
    <section className="ios-group" aria-label="Pages">
      ${viewsIn(MOBILE_MORE).map((v) => html`<${MoreRow} key=${v.id}
        icon=${v.icon} tint=${MORE_TINT[v.id]} label=${v.label}
        badge=${v.id === "review" ? counts.review : 0} onClick=${() => m.onPush(v.id)} />`)}
    </section>

    <section className="ios-group" aria-label="Settings">
      <${MoreRow} icon="bell" tint="#e5484d" label="Alerts" chevron=${false} onClick=${m.onAlerts} />
      ${m.onFaceId && auth && auth.token && html`<${MoreRow} icon="faceid" tint="#30a46c" label=${faceIdName()} chevron=${false} onClick=${m.onFaceId} />`}
      ${auth && auth.token && m.onPassword && html`<${MoreRow} icon="key" tint="#8a6d3b" label="Change password" chevron=${false} onClick=${m.onPassword} />`}
      ${auth && auth.admin && auth.token && html`<${MoreRow} icon="users" tint="#6e7781" label="Manage accounts"
        badge=${m.pending} chevron=${false} onClick=${m.onAccounts} />`}
      <div className="ios-row is-static">
        <span className="ios-row__icon" style=${{ background: "#5b5bd6" }}><${Icon} name=${m.theme === "light" ? "sun" : "moon"} size=${17} /></span>
        <span className="ios-row__label">Appearance</span>
        <${Segmented} value=${m.themePref === "auto" || m.themePref === "light" ? m.themePref : "dark"} onChange=${m.setThemePref}
          label="Appearance" options=${[
            { value: "auto", label: "Auto", title: "Match this phone's light or dark setting" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]} />
      </div>
    </section>

    <section className="ios-group" aria-label="Account">
      ${auth
        ? html`<div className="ios-row is-static">
            <span className="ios-row__icon" style=${{ background: "#3a8f63" }}><${Icon} name="user" size=${17} /></span>
            <span className="ios-row__label">${auth.user}</span>
            <span className="ios-row__value">${auth.admin ? "Admin" : "Member"}</span>
          </div>
          <${MoreRow} label="Sign out" tone="danger" chevron=${false} onClick=${m.onSignOut} />`
        : html`<${MoreRow} icon="user" tint="#3a8f63" label="Sign in" tone="accent" onClick=${m.onSignIn} />`}
    </section>

    ${status.newest && html`<p className="ios-foot">Newest photo ${status.newest}</p>`}
  </div>`;
}

/* ---------------------------- Swipe to go back ---------------------------- */
// The installed iPhone app has no browser around it, so no system swipe-back. On a
// page opened from More, a drag from the left edge slides the page away with the
// finger and goes back, as in iPhone apps. Off in Safari, which has its own.
export function useEdgeBack(enabled, onBack) {
  useEffect(() => {
    if (!enabled || !edgeBackHere()) return undefined;
    const EDGE = 24;
    const frame = () => document.querySelector(".main");
    const blocked = (t) => t.closest && t.closest(".lb, .modal, .drawer, .scrim, .mobilenav, .leaflet-container");
    let g = null;
    const onStart = (e) => {
      g = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE || blocked(e.target)) return;
      g = { x: t.clientX, y: t.clientY, at: e.timeStamp, dx: 0, live: false };
    };
    const onMove = (e) => {
      if (!g || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x, dy = t.clientY - g.y;
      const el = frame();
      if (!g.live) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > dx) { g = null; return; } // a scroll
        if (dx < 8 || !el) return;
        g.live = true;
        el.style.transition = "none";
        el.style.boxShadow = "-14px 0 34px rgba(0,0,0,.35)";
      }
      if (e.cancelable) e.preventDefault();
      g.dx = Math.max(0, dx);
      g.t2 = e.timeStamp;
      el.style.transform = `translateX(${g.dx}px)`;
    };
    const onEnd = (e) => {
      const s = g;
      g = null;
      if (!s || !s.live) return;
      const el = frame();
      if (!el) return;
      const speed = s.dx / Math.max(1, (s.t2 || e.timeStamp) - s.at); // px per ms
      const back = s.dx > window.innerWidth * 0.33 || (speed > 0.5 && s.dx > 40);
      el.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)";
      el.style.transform = back ? `translateX(${window.innerWidth}px)` : "translateX(0px)";
      setTimeout(() => {
        if (back) { onBack(); return; }
        el.style.transition = ""; el.style.transform = ""; el.style.boxShadow = "";
      }, 230);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, onBack]);
}

/* ---------------------------- Pull to refresh --------------------------- */
// On phones, pulling down at the top of a page checks for new photos. The browser's
// own pull (a full reload) is turned off in CSS so the two don't fight.
const PULL_TRIGGER = 64;
export function PullToRefresh({ onRefresh }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 900px)");
    const blocked = (t) => t.closest && t.closest(".lb, .modal, .drawer, .leaflet-container, .scrim, input, textarea, select");
    const onStart = (e) => {
      start.current = null;
      if (!phone.matches || busyRef.current || e.touches.length !== 1 || getScrollY() > 0) return;
      if (document.body.style.overflow === "hidden" || blocked(e.target)) return;
      start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
    };
    const onMove = (e) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = e.touches[0].clientX - start.current.x;
      if (dy <= 0 || getScrollY() > 0 || Math.abs(dx) > dy) { if (pullRef.current) { pullRef.current = 0; setPull(0); } if (dy < -4 || Math.abs(dx) > 12) start.current = null; return; }
      if (e.cancelable) e.preventDefault();
      // Resistance: the indicator moves slower than the finger and stops at 96px.
      pullRef.current = Math.min(96, dy * 0.5);
      setPull(pullRef.current);
    };
    const onEnd = async () => {
      if (!start.current) return;
      start.current = null;
      const reached = pullRef.current >= PULL_TRIGGER;
      pullRef.current = 0;
      setPull(0);
      if (!reached) return;
      busyRef.current = true; setBusy(true);
      try { await onRefresh(); } finally { busyRef.current = false; setBusy(false); }
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [onRefresh]);
  if (!pull && !busy) return null;
  const y = busy ? PULL_TRIGGER * 0.75 : pull;
  const ready = pull >= PULL_TRIGGER;
  return html`<div className=${cx("ptr", (busy || ready) && "is-ready", busy && "is-spin")} aria-hidden=${!busy}
      role="status" style=${{ transform: `translate(-50%, ${y}px)`, opacity: busy ? 1 : Math.min(1, pull / 40) }}>
    <span style=${{ transform: busy ? undefined : `rotate(${pull * 3.5}deg)` }}><${Icon} name="refresh" size=${18} /></span>
    ${busy && html`<span className="sr-only">Checking for new photos</span>`}
  </div>`;
}

/* ------------------------------ Filter bar ------------------------------ */
// `hour`, `wday` and `gameOnly` have no control of their own: they're set by tapping
// a bar on the Patterns or Home charts, and cleared from their chips. `gameOnly`
// leaves out people, vehicles and empty photos, as those charts do, so the photos
// a bar opens are the ones it counted.
const EMPTY_FILTERS = {
  species: "All", camera: "All", tod: "all", bucksOnly: false, gameOnly: false,
  range: "all", from: "", to: "", hour: -1, wday: -1,
};
export const defaultFilters = () => ({ ...EMPTY_FILTERS });

// Restore filters saved from a previous session, keeping only known keys so a
// stale or malformed value can never break the filter bar. Falls back to the
// defaults for anything missing.
export function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS.filters) || "null");
    if (!saved || typeof saved !== "object") return defaultFilters();
    const out = defaultFilters();
    for (const k of Object.keys(out)) {
      if (saved[k] !== undefined && typeof saved[k] === typeof out[k]) out[k] = saved[k];
    }
    if (!RANGE_OPTIONS.some((o) => o.value === out.range)) out.range = "all";
    if (!Number.isInteger(out.hour) || out.hour < 0 || out.hour > 23) out.hour = -1;
    if (!Number.isInteger(out.wday) || out.wday < 0 || out.wday > 6) out.wday = -1;
    return out;
  } catch (e) {
    return defaultFilters();
  }
}

// `quick` adds the row of one-tap chips (Photos). `sheetExtras` are controls the
// phone shows inside the Filters sheet instead of on the bar (sort order, photo size).
// `below` is drawn under the bar and stays pinned with it (the bulk-tag bar).
// `noun` names what's counted ("animal photo" on Patterns, which leaves the rest out).
export function FilterBar({ filters, set, cameras, speciesList, count, camName, children, quick, sheetExtras, below, noun = "photo" }) {
  const [open, setOpen] = useState(false);
  const sheet = useSheetDrag(open, () => setOpen(false));
  const cn = camName || ((x) => x);
  const gameOnly = filters.gameOnly && !NOT_GAME.has(filters.species);
  const activeCount =
    (filters.species !== "All" ? 1 : 0) +
    (filters.camera !== "All" ? 1 : 0) +
    (filters.tod !== "all" ? 1 : 0) +
    (filters.bucksOnly ? 1 : 0) +
    (gameOnly ? 1 : 0) +
    (filters.range !== "all" ? 1 : 0) +
    (filters.hour >= 0 ? 1 : 0) +
    (filters.wday >= 0 ? 1 : 0);
  const counted = `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

  // "All deer" sits under "All species" once there's more than one kind of deer.
  const deerKinds = speciesList.filter((s) => DEER_KINDS.includes(s));
  const offerAllDeer = deerKinds.length > 1 || filters.species === ALL_DEER;
  const controls = html`<${Fragment}>
    <${Select} value=${filters.species} onChange=${(v) => set({ species: v })} aria-label="Species"
      options=${[
        { value: "All", label: "All species" },
        ...(offerAllDeer ? [{ value: ALL_DEER, label: `All deer (${ALL_DEER_HINT})` }] : []),
        ...speciesList.map((s) => ({ value: s, label: s })),
      ]} />
    <${Select} value=${filters.camera} onChange=${(v) => set({ camera: v })} aria-label="Camera"
      options=${[{ value: "All", label: "All cameras" }, ...cameras.map((c) => ({ value: c.name, label: cn(c.name) }))]} />
    <${Select} value=${filters.range} onChange=${(v) => set({ range: v })} aria-label="Date range"
      options=${RANGE_OPTIONS} />
    ${filters.range === "custom" && html`<div className="daterange">
      <input className="input" type="date" value=${filters.from} max=${filters.to || undefined}
        aria-label="From date" onInput=${(e) => set({ from: e.target.value })} />
      <span className="faint">to</span>
      <input className="input" type="date" value=${filters.to} min=${filters.from || undefined}
        aria-label="To date" onInput=${(e) => set({ to: e.target.value })} />
    </div>`}
    <${Segmented} value=${filters.tod} onChange=${(v) => set({ tod: v })} label="Time of day"
      options=${[
        { value: "all", label: "All" },
        { value: "day", label: "Day", title: "Daytime" },
        { value: "night", label: "Night", title: "Night" },
      ]} />
    <${Switch} checked=${filters.bucksOnly} onChange=${(v) => set({ bucksOnly: v })}>Bucks only</${Switch}>
  </${Fragment}>`;

  // One-tap chips (phones): each is a shortcut to a filter in the sheet, lit while
  // that filter is on, and a second tap takes it off again.
  const today = isoDay(new Date());
  const isToday = filters.range === "custom" && filters.from === today && filters.to === today;
  const quickSpecies = [
    ...(offerAllDeer ? [ALL_DEER] : []),
    ...speciesList.filter((sp) => !NOT_GAME.has(sp) && sp !== "Buck" && sp !== "Animal"),
  ].slice(0, 5);
  const quickChips = !quick ? [] : [
    { k: "game", label: "Animals", on: !!gameOnly, tap: () => set({ gameOnly: !gameOnly }) },
    { k: "buck", label: "Bucks", dot: speciesColor("Buck"), on: filters.bucksOnly, tap: () => set({ bucksOnly: !filters.bucksOnly }) },
    ...quickSpecies.map((sp) => ({ k: "sp-" + sp, label: sp, dot: pickColor(sp), on: filters.species === sp,
      tap: () => set({ species: filters.species === sp ? "All" : sp }) })),
    { k: "today", label: "Today", on: isToday,
      tap: () => set(isToday ? { range: "all", from: "", to: "" } : { range: "custom", from: today, to: today }) },
    ...(cameras.length > 1 ? cameras.map((c) => ({ k: "cam-" + c.name, label: shortName(cn(c.name)), on: filters.camera === c.name,
      tap: () => set({ camera: filters.camera === c.name ? "All" : c.name }) })) : []),
  ];

  // The chips that say which filters are on. `dup` marks the ones a lit quick chip
  // already shows, which a phone leaves out.
  const chips = [];
  if (filters.species !== "All") chips.push({ k: "sp", label: filters.species, dot: pickColor(filters.species), dup: quickSpecies.includes(filters.species), clear: () => set({ species: "All" }) });
  if (filters.camera !== "All") chips.push({ k: "cam", label: cn(filters.camera), dup: cameras.length > 1, clear: () => set({ camera: "All" }) });
  if (filters.range !== "all") chips.push({ k: "range", label: isToday ? "Today" : rangeLabel(filters), dup: isToday, clear: () => set({ range: "all", from: "", to: "" }) });
  if (filters.tod !== "all") chips.push({ k: "tod", label: filters.tod === "day" ? "Daytime" : "Night", clear: () => set({ tod: "all" }) });
  if (filters.hour >= 0) chips.push({ k: "hour", label: `${labelHour(filters.hour)} hour`, clear: () => set({ hour: -1 }) });
  if (filters.wday >= 0) chips.push({ k: "wday", label: WEEKDAY_PLURAL[filters.wday], clear: () => set({ wday: -1 }) });
  if (filters.bucksOnly) chips.push({ k: "buck", label: "Bucks only", dup: true, clear: () => set({ bucksOnly: false }) });
  if (gameOnly) chips.push({ k: "game", label: "Animals only", dup: true, clear: () => set({ gameOnly: false }) });
  const dupOnly = !!quick && chips.every((c) => c.dup);

  return html`<div className=${cx("filterwrap", quick && "has-quick")}>
    <div className="filterbar">
      <div className="filterbar__inline">${controls}</div>
      <button className="btn btn--sm filters-trigger" onClick=${() => setOpen(true)}>
        <${Icon} name="sliders" size=${15} /><span>Filters</span>
        ${activeCount > 0 && html`<span className="nav__badge">${activeCount}</span>`}
      </button>
      <span className="filterbar__count">${counted}</span>
      ${children && html`<div className="filterbar__tools">${children}</div>`}
    </div>

    ${quickChips.length > 0 && html`<div className="quickchips" role="group" aria-label="Quick filters">
      ${activeCount > 0 && html`<button type="button" className="chip quickchips__clear" onClick=${() => set(defaultFilters())}>
        <${Icon} name="x" size=${13} />Clear</button>`}
      ${quickChips.map((c) => html`<${Chip} key=${c.k} active=${c.on} dotColor=${c.dot} aria-pressed=${!!c.on} onClick=${c.tap}>${c.label}</${Chip}>`)}
    </div>`}

    ${chips.length > 0 && html`<div className=${cx("filterchips", dupOnly && "is-dup")}>
      ${chips.map((c) => html`<${Chip} key=${c.k} dotColor=${c.dot} className=${quick && c.dup ? "is-dup" : ""} onClear=${c.clear}>${c.label}</${Chip}>`)}
      ${chips.length > 1 && html`<button className=${cx("btn btn--ghost btn--sm", quick && "is-dup")} onClick=${() => set(defaultFilters())}>Clear all</button>`}
    </div>`}

    ${below}

    ${open && createPortal(html`<div className="scrim" onClick=${() => setOpen(false)}>
      <div className="drawer" ref=${sheet} onClick=${(e) => e.stopPropagation()}>
        <div className="drawer__grip" />
        <div className="filterbar__inline">${controls}${sheetExtras}</div>
        <div className="row mt" style=${{ gap: 10 }}>
          ${activeCount > 0 && html`<button className="btn" onClick=${() => set(defaultFilters())}>Clear</button>`}
          <button className="btn btn--primary" onClick=${() => setOpen(false)} style=${{ flex: 1 }}>Show ${counted}</button>
        </div>
      </div>
    </div>`, document.body)}
  </div>`;
}

// "Food Plot (Tall Stand)" -> "Food Plot": chips have no room for the part in brackets.
const shortName = (name) => String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || name;
