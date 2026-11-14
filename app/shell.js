// Vale Trails — app chrome: sidebar, topbar, mobile nav and the shared filter bar.
import { html, useState, Fragment, createPortal } from "./react.js";
import { Icon, BrandMark } from "./icons.js";
import { IconBtn, Select, Segmented, Switch, Chip } from "./ui.js";
import { speciesColor, LS, labelHour } from "./core.js";
import { RANGE_OPTIONS, rangeLabel, WEEKDAY_PLURAL } from "./analytics.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");

export const VIEWS = [
  { id: "overview", label: "Home",     icon: "dashboard" },
  { id: "gallery",  label: "Photos",   icon: "images" },
  { id: "uploads",  label: "Uploads",  icon: "upload" },
  { id: "bucks",    label: "Bucks",    icon: "target" },
  { id: "insights", label: "Patterns", icon: "chart" },
  { id: "map",      label: "Map",      icon: "map" },
  { id: "review",   label: "Identify", icon: "scan" },
];

const badgeCount = (n) => (n > 99 ? "99+" : n);
const feedTitle = (s) => (s.demo ? "Demo data" : s.stale ? "Sync delayed" : "Auto-sync on");

/* ------------------------------- Sidebar -------------------------------- */
export function Sidebar({ view, setView, counts, status }) {
  return html`<aside className="sidebar">
    <div className="brand">
      <${BrandMark} size=${38} />
      <div className="brand__name">Vale Trails</div>
    </div>

    <nav className="nav">
      ${VIEWS.map((v) => html`<a key=${v.id} role="button" tabindex="0"
        className=${cx("nav__item", view === v.id && "is-active")}
        onClick=${() => setView(v.id)}
        onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && setView(v.id)}>
        <${Icon} name=${v.icon} size=${18} />${v.label}
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
// `auth` is the family login for this page; saving anything for everyone needs it.
export function Topbar({ title, sub, theme, toggleTheme, onRefresh, refreshing, onUpload, auth, onSignIn, onSignOut, children }) {
  return html`<header className="topbar">
    <div className="topbar__titles">
      <div className="h-page">${title}</div>
      ${sub && html`<div className="sub">${sub}</div>`}
    </div>
    <div className="topbar__spacer" />
    <div className="topbar__actions">
      ${children}
      ${auth
        ? html`<button className="btn btn--sm btn--ghost authbtn is-on" onClick=${onSignOut} title="Signed in as ${auth.user}. Click to sign out.">
            <${Icon} name="user" size=${15} /><span>${auth.user}</span>
          </button>`
        : html`<button className="btn btn--sm btn--ghost authbtn" onClick=${onSignIn} title="Sign in to save tags, names and notes for everyone">
            <${Icon} name="user" size=${15} /><span>Sign in</span>
          </button>`}
      <button className="btn btn--sm" onClick=${onUpload}><${Icon} name="upload" size=${15} /><span>Upload</span></button>
      <${IconBtn} icon="refresh" bare onClick=${onRefresh} title="Refresh data"
        className=${refreshing ? "is-spin" : ""} aria-label="Refresh" />
      <${IconBtn} icon=${theme === "light" ? "moon" : "sun"} bare onClick=${toggleTheme}
        title=${theme === "light" ? "Switch to dark" : "Switch to light"} aria-label="Toggle theme" />
    </div>
  </header>`;
}

/* ----------------------------- Mobile chrome ---------------------------- */
export function MobileTopbar({ theme, toggleTheme, onRefresh, refreshing, status, onUpload, auth, onSignIn, onSignOut }) {
  return html`<div className="mobile-top">
    <${BrandMark} size=${30} />
    <div className="brand__name">Vale Trails
      <small className=${status.stale ? "is-stale" : ""}>
        ${status.checked ? "Checked " + status.checked : "Awaiting sync"}
      </small>
    </div>
    <div className="topbar__spacer" />
    <${IconBtn} icon="user" bare className=${auth ? "is-on" : ""} onClick=${auth ? onSignOut : onSignIn}
      aria-label=${auth ? "Signed in. Tap to sign out" : "Sign in"} />
    <${IconBtn} icon="upload" bare onClick=${onUpload} aria-label="Upload photos" />
    <${IconBtn} icon="refresh" bare onClick=${onRefresh} className=${refreshing ? "is-spin" : ""} aria-label="Refresh" />
    <${IconBtn} icon=${theme === "light" ? "moon" : "sun"} bare onClick=${toggleTheme} aria-label="Toggle theme" />
  </div>`;
}

export function MobileNav({ view, setView, counts }) {
  return html`<nav className="mobilenav">
    ${VIEWS.map((v) => html`<button key=${v.id}
      className=${view === v.id ? "is-active" : ""} onClick=${() => setView(v.id)}>
      <${Icon} name=${v.icon} size=${20} />${v.label}
      ${v.id === "review" && counts.review > 0 && html`<span className="nav__badge">${badgeCount(counts.review)}</span>`}
    </button>`)}
  </nav>`;
}

/* ------------------------------ Filter bar ------------------------------ */
// `hour` and `wday` have no control of their own: they're set by tapping a bar on
// the Patterns or Home charts, and cleared from their chips.
const EMPTY_FILTERS = {
  species: "All", camera: "All", tod: "all", bucksOnly: false,
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

export function FilterBar({ filters, set, cameras, speciesList, count, camName, children }) {
  const [open, setOpen] = useState(false);
  const cn = camName || ((x) => x);
  const activeCount =
    (filters.species !== "All" ? 1 : 0) +
    (filters.camera !== "All" ? 1 : 0) +
    (filters.tod !== "all" ? 1 : 0) +
    (filters.bucksOnly ? 1 : 0) +
    (filters.range !== "all" ? 1 : 0) +
    (filters.hour >= 0 ? 1 : 0) +
    (filters.wday >= 0 ? 1 : 0);

  const controls = html`<${Fragment}>
    <${Select} value=${filters.species} onChange=${(v) => set({ species: v })}
      options=${[{ value: "All", label: "All species" }, ...speciesList.map((s) => ({ value: s, label: s }))]} />
    <${Select} value=${filters.camera} onChange=${(v) => set({ camera: v })}
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
    <${Segmented} value=${filters.tod} onChange=${(v) => set({ tod: v })}
      options=${[
        { value: "all", label: "All" },
        { value: "day", label: "Day", title: "Daytime" },
        { value: "night", label: "Night", title: "Night" },
      ]} />
    <${Switch} checked=${filters.bucksOnly} onChange=${(v) => set({ bucksOnly: v })}>Bucks only</${Switch}>
  </${Fragment}>`;

  const chips = [];
  if (filters.species !== "All") chips.push({ k: "sp", label: filters.species, dot: speciesColor(filters.species), clear: () => set({ species: "All" }) });
  if (filters.camera !== "All") chips.push({ k: "cam", label: cn(filters.camera), clear: () => set({ camera: "All" }) });
  if (filters.range !== "all") chips.push({ k: "range", label: rangeLabel(filters), clear: () => set({ range: "all", from: "", to: "" }) });
  if (filters.tod !== "all") chips.push({ k: "tod", label: filters.tod === "day" ? "Daytime" : "Night", clear: () => set({ tod: "all" }) });
  if (filters.hour >= 0) chips.push({ k: "hour", label: `${labelHour(filters.hour)} hour`, clear: () => set({ hour: -1 }) });
  if (filters.wday >= 0) chips.push({ k: "wday", label: WEEKDAY_PLURAL[filters.wday], clear: () => set({ wday: -1 }) });
  if (filters.bucksOnly) chips.push({ k: "buck", label: "Bucks only", clear: () => set({ bucksOnly: false }) });

  return html`<div>
    <div className="filterbar">
      <div className="filterbar__inline">${controls}</div>
      <button className="btn btn--sm filters-trigger" onClick=${() => setOpen(true)}>
        <${Icon} name="sliders" size=${15} /><span>Filters</span>
        ${activeCount > 0 && html`<span className="nav__badge">${activeCount}</span>`}
      </button>
      <span className="filterbar__count">${count.toLocaleString()} photo${count === 1 ? "" : "s"}</span>
      ${children && html`<div className="filterbar__tools">${children}</div>`}
    </div>

    ${chips.length > 0 && html`<div className="filterchips">
      ${chips.map((c) => html`<${Chip} key=${c.k} dotColor=${c.dot} onClear=${c.clear}>${c.label}</${Chip}>`)}
      ${chips.length > 1 && html`<button className="btn btn--ghost btn--sm" onClick=${() => set(defaultFilters())}>Clear all</button>`}
    </div>`}

    ${open && createPortal(html`<div className="scrim" onClick=${() => setOpen(false)}>
      <div className="drawer" onClick=${(e) => e.stopPropagation()}>
        <div className="drawer__grip" />
        <div className="filterbar__inline">${controls}</div>
        <button className="btn btn--primary mt" onClick=${() => setOpen(false)} style=${{ width: "100%" }}>
          Show ${count.toLocaleString()} photo${count === 1 ? "" : "s"}
        </button>
      </div>
    </div>`, document.body)}
  </div>`;
}
