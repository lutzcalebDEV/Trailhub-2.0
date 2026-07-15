// Vale Trails — app chrome: sidebar, topbar, mobile nav and the shared filter bar.
import { html, useState, Fragment, createPortal } from "./react.js";
import { Icon, BrandMark } from "./icons.js";
import { IconBtn, SearchInput, Select, Segmented, Switch, Chip } from "./ui.js";
import { speciesColor, LS } from "./core.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");

export const VIEWS = [
  { id: "overview", label: "Overview", icon: "dashboard", sub: "Your range at a glance" },
  { id: "gallery",  label: "Gallery",  icon: "images",    sub: "Every capture, filtered your way" },
  { id: "insights", label: "Insights", icon: "chart",     sub: "Movement patterns & timing" },
  { id: "map",      label: "Map",      icon: "map",       sub: "Activity by camera location" },
  { id: "review",   label: "Review",   icon: "scan",      sub: "Confirm species on flagged captures" },
];

/* ------------------------------- Sidebar -------------------------------- */
export function Sidebar({ view, setView, counts, status }) {
  return html`<aside className="sidebar">
    <div className="brand">
      <${BrandMark} size=${38} />
      <div className="brand__name">Vale Trails<small>Trail Camera Intel</small></div>
    </div>

    <nav className="nav">
      <div className="nav__label">Dashboard</div>
      ${VIEWS.map((v) => html`<a key=${v.id} role="button" tabindex="0"
        className=${cx("nav__item", view === v.id && "is-active")}
        onClick=${() => setView(v.id)}
        onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && setView(v.id)}>
        <${Icon} name=${v.icon} size=${18} />${v.label}
        ${v.id === "review" && counts.review > 0 && html`<span className="nav__badge">${counts.review}</span>`}
      </a>`)}
    </nav>

    <div className="sidebar__foot">
      <div className="datastat">
        <span className=${cx("datastat__dot", status.demo && "is-demo")} />
        <div>
          <b>${status.demo ? "Demo data" : "Live feed"}</b>
          <small>${status.updated ? "Updated " + status.updated : "Awaiting sync"}</small>
        </div>
      </div>
      <div className="datastat">
        <span className="datastat__dot" style=${{ background: "var(--info)", boxShadow: "0 0 0 4px rgba(108,199,230,.14)" }} />
        <div>
          <b>${counts.total.toLocaleString()} captures</b>
          <small>${counts.cameras} camera${counts.cameras === 1 ? "" : "s"}</small>
        </div>
      </div>
    </div>
  </aside>`;
}

/* -------------------------------- Topbar -------------------------------- */
export function Topbar({ title, sub, theme, toggleTheme, onRefresh, refreshing, children }) {
  return html`<header className="topbar">
    <div className="topbar__titles">
      <div className="h-page">${title}</div>
      ${sub && html`<div className="sub">${sub}</div>`}
    </div>
    <div className="topbar__spacer" />
    <div className="topbar__actions">
      ${children}
      <${IconBtn} icon="refresh" bare onClick=${onRefresh} title="Refresh data"
        className=${refreshing ? "is-spin" : ""} aria-label="Refresh" />
      <${IconBtn} icon=${theme === "light" ? "moon" : "sun"} bare onClick=${toggleTheme}
        title=${theme === "light" ? "Switch to dark" : "Switch to light"} aria-label="Toggle theme" />
    </div>
  </header>`;
}

/* ----------------------------- Mobile chrome ---------------------------- */
export function MobileTopbar({ theme, toggleTheme, onRefresh, refreshing }) {
  return html`<div className="mobile-top">
    <${BrandMark} size=${30} />
    <div className="brand__name">Vale Trails</div>
    <div className="topbar__spacer" />
    <${IconBtn} icon="refresh" bare onClick=${onRefresh} className=${refreshing ? "is-spin" : ""} aria-label="Refresh" />
    <${IconBtn} icon=${theme === "light" ? "moon" : "sun"} bare onClick=${toggleTheme} aria-label="Toggle theme" />
  </div>`;
}

export function MobileNav({ view, setView, counts }) {
  return html`<nav className="mobilenav">
    ${VIEWS.map((v) => html`<button key=${v.id}
      className=${view === v.id ? "is-active" : ""} onClick=${() => setView(v.id)}>
      <${Icon} name=${v.icon} size=${20} />${v.label}
      ${v.id === "review" && counts.review > 0 && html`<span className="nav__badge">${counts.review}</span>`}
    </button>`)}
  </nav>`;
}

/* ------------------------------ Filter bar ------------------------------ */
const EMPTY_FILTERS = { q: "", species: "All", camera: "All", tod: "all", bucksOnly: false };
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
    return out;
  } catch (e) {
    return defaultFilters();
  }
}

export function FilterBar({ filters, set, cameras, speciesList, count, camName }) {
  const [open, setOpen] = useState(false);
  const cn = camName || ((x) => x);
  const activeCount =
    (filters.species !== "All" ? 1 : 0) +
    (filters.camera !== "All" ? 1 : 0) +
    (filters.tod !== "all" ? 1 : 0) +
    (filters.bucksOnly ? 1 : 0) +
    (filters.q ? 1 : 0);

  const controls = html`<${Fragment}>
    <${SearchInput} value=${filters.q} onChange=${(v) => set({ q: v })} placeholder="Search camera or species" />
    <${Select} value=${filters.species} onChange=${(v) => set({ species: v })}
      options=${[{ value: "All", label: "All species" }, ...speciesList.map((s) => ({ value: s, label: s }))]} />
    <${Select} value=${filters.camera} onChange=${(v) => set({ camera: v })}
      options=${[{ value: "All", label: "All cameras" }, ...cameras.map((c) => ({ value: c.name, label: cn(c.name) }))]} />
    <${Segmented} value=${filters.tod} onChange=${(v) => set({ tod: v })}
      options=${[
        { value: "all", label: "All" },
        { value: "day", icon: "sun", title: "Daytime" },
        { value: "night", icon: "moon", title: "Night" },
      ]} />
    <${Switch} checked=${filters.bucksOnly} onChange=${(v) => set({ bucksOnly: v })}>Bucks only</${Switch}>
  </${Fragment}>`;

  const chips = [];
  if (filters.q) chips.push({ k: "q", label: `"${filters.q}"`, clear: () => set({ q: "" }) });
  if (filters.species !== "All") chips.push({ k: "sp", label: filters.species, dot: speciesColor(filters.species), clear: () => set({ species: "All" }) });
  if (filters.camera !== "All") chips.push({ k: "cam", label: cn(filters.camera), clear: () => set({ camera: "All" }) });
  if (filters.tod !== "all") chips.push({ k: "tod", label: filters.tod === "day" ? "Daytime" : "Night", clear: () => set({ tod: "all" }) });
  if (filters.bucksOnly) chips.push({ k: "buck", label: "Bucks only", clear: () => set({ bucksOnly: false }) });

  return html`<div>
    <div className="filterbar">
      <div className="filterbar__inline">${controls}</div>
      <button className="btn btn--sm filters-trigger" onClick=${() => setOpen(true)}>
        <${Icon} name="sliders" size=${15} /><span>Filters</span>
        ${activeCount > 0 && html`<span className="nav__badge">${activeCount}</span>`}
      </button>
      <span className="filterbar__count">${count.toLocaleString()} result${count === 1 ? "" : "s"}</span>
    </div>

    ${chips.length > 0 && html`<div className="filterchips">
      ${chips.map((c) => html`<${Chip} key=${c.k} dotColor=${c.dot} onClear=${c.clear}>${c.label}</${Chip}>`)}
      ${chips.length > 1 && html`<button className="btn btn--ghost btn--sm" onClick=${() => set(EMPTY_FILTERS)}>Clear all</button>`}
    </div>`}

    ${open && createPortal(html`<div className="scrim" onClick=${() => setOpen(false)}>
      <div className="drawer" onClick=${(e) => e.stopPropagation()}>
        <div className="drawer__grip" />
        <div className="filterbar__inline">${controls}</div>
        <button className="btn btn--primary mt" onClick=${() => setOpen(false)} style=${{ width: "100%" }}>
          Show ${count.toLocaleString()} result${count === 1 ? "" : "s"}
        </button>
      </div>
    </div>`, document.body)}
  </div>`;
}
