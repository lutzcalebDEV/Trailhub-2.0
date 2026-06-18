// Vale Trails — application root: state, routing, actions and mount.
import { html, useState, useEffect, useMemo, useRef, useCallback, Fragment, ReactDOM } from "./react.js";
import {
  LS, usePersistent, usePersistentSet, useData, loadOverrides,
  remoteLoadTags, remoteSaveTags, hasSharedTags, effectiveSpecies, timeAgo,
} from "./core.js";
import { filterCaptures, speciesList, reviewQueue } from "./analytics.js";
import { Sidebar, Topbar, MobileTopbar, MobileNav, VIEWS, defaultFilters } from "./shell.js";
import { Lightbox, Toast } from "./ui.js";
import { Overview } from "./views/overview.js";
import { Gallery } from "./views/gallery.js";
import { MapView } from "./views/mapview.js";
import { Insights } from "./views/insights.js";
import { Review } from "./views/review.js";

const VIEW_COMPONENTS = { overview: Overview, gallery: Gallery, insights: Insights, map: MapView, review: Review };

function App() {
  const { data, refresh, refreshing } = useData();
  const [theme, setTheme] = usePersistent(LS.theme, "dark");
  const [view, setView] = useState("overview");
  const [filters, setFilters] = useState(defaultFilters);

  const [localOverrides, setLocalOverrides] = useState(loadOverrides);
  const [remoteTags, setRemoteTags] = useState({});
  const [archived, archive$] = usePersistentSet(LS.archived);
  const [reviewed, reviewed$] = usePersistentSet(LS.reviewed);
  const [gridSize, setGridSize] = usePersistent(LS.gridSize, "M");
  const [gridLayout, setGridLayout] = usePersistent(LS.gridLayout, "grid");

  const [lightbox, setLightbox] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(0);

  // Apply + load shared baseline tags once.
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  useEffect(() => {
    let alive = true;
    remoteLoadTags().then((map) => { if (alive && map) setRemoteTags(map); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS.overrides, JSON.stringify(localOverrides)); } catch (e) {}
  }, [localOverrides]);

  // Local edits win over the shared baseline.
  const ov = useMemo(() => ({ ...remoteTags, ...localOverrides }), [remoteTags, localOverrides]);
  const captures = data.captures;
  const spList = useMemo(() => speciesList(captures, ov), [captures, ov]);
  const filtered = useMemo(() => filterCaptures(captures, filters, ov), [captures, filters, ov]);
  const reviewQ = useMemo(() => reviewQueue(captures, ov, archived, reviewed), [captures, ov, archived, reviewed]);

  const counts = { total: captures.length, cameras: data.cameras.length, review: reviewQ.length };
  const status = { demo: data.demo, updated: data.generatedAt ? timeAgo(data.generatedAt) : null };

  /* --------------------------- Actions ---------------------------------- */
  const setFilter = useCallback((patch) => setFilters((f) => ({ ...f, ...patch })), []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), [setTheme]);

  const showToast = useCallback((kind, msg) => {
    setToast({ kind, msg });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2300);
  }, []);

  const setOverrideTags = useCallback((id, tags) => {
    setLocalOverrides((prev) => {
      const next = { ...prev };
      if (tags && tags.length) next[String(id)] = tags;
      else delete next[String(id)];
      return next;
    });
  }, []);

  const assignSpecies = useCallback((id, species) => {
    setOverrideTags(id, [species]);
    reviewed$.add(id);
    if (hasSharedTags) {
      remoteSaveTags(id, [species])
        .then(() => showToast("ok", `Saved “${species}” for everyone`))
        .catch(() => showToast("err", "Couldn’t sync — saved on this device"));
    } else {
      showToast("ok", `Tagged ${species}`);
    }
  }, [setOverrideTags, reviewed$, showToast]);

  const keep = useCallback((id) => { reviewed$.add(id); showToast("ok", "Marked reviewed"); }, [reviewed$, showToast]);
  const archiveCap = useCallback((id) => { archive$.add(id); showToast("ok", "Archived"); }, [archive$, showToast]);
  const openLightbox = useCallback((list, index) => setLightbox({ list, index }), []);

  /* ----------------------------- Render --------------------------------- */
  const meta = VIEWS.find((v) => v.id === view) || VIEWS[0];
  const View = VIEW_COMPONENTS[view] || Overview;
  const app = {
    data, captures, ov, theme,
    filters, setFilter, filtered, spList,
    gridSize, setGridSize, gridLayout, setGridLayout,
    archived, reviewed, assignSpecies, keep, archive: archiveCap,
    openLightbox, reviewQ, counts, setView,
  };

  const lbItem = lightbox ? lightbox.list[lightbox.index] : null;

  return html`<${Fragment}>
    <div className="app">
      <${Sidebar} view=${view} setView=${setView} counts=${counts} status=${status} />
      <main className="main">
        <${MobileTopbar} theme=${theme} toggleTheme=${toggleTheme} onRefresh=${refresh} refreshing=${refreshing} />
        <${Topbar} title=${meta.label} sub=${meta.sub} theme=${theme} toggleTheme=${toggleTheme}
          onRefresh=${refresh} refreshing=${refreshing} />
        <div className="view view__enter" key=${view}>
          <${View} ...${app} />
        </div>
      </main>
    </div>

    <${MobileNav} view=${view} setView=${setView} counts=${counts} />

    ${lbItem && html`<${Lightbox}
      capture=${lbItem}
      species=${effectiveSpecies(lbItem, ov)}
      hasPrev=${lightbox.index > 0}
      hasNext=${lightbox.index < lightbox.list.length - 1}
      onPrev=${() => setLightbox((s) => ({ ...s, index: Math.max(0, s.index - 1) }))}
      onNext=${() => setLightbox((s) => ({ ...s, index: Math.min(s.list.length - 1, s.index + 1) }))}
      onClose=${() => setLightbox(null)} />`}

    ${toast && html`<${Toast} kind=${toast.kind}>${toast.msg}</${Toast}>`}
  </${Fragment}>`;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(html`<${App} />`);
