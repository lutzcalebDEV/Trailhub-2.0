// Vale Trails — application root: state, routing, actions and mount.
import { html, useState, useEffect, useMemo, useRef, useCallback, Fragment, ReactDOM } from "./react.js";
import {
  LS, usePersistent, usePersistentSet, useData, loadOverrides,
  remoteLoadTags, remoteSaveTags, hasSharedTags, effectiveSpecies, timeAgo,
  loadCameraNames, remoteLoadCameraNames, remoteSaveCameraName, displayCamera,
  loadMetadata, remoteLoadMetadata, remoteSaveMetadata, applyMeta, metaOf,
} from "./core.js";
import { filterCaptures, speciesList, reviewQueue } from "./analytics.js";
import { Sidebar, Topbar, MobileTopbar, MobileNav, VIEWS, loadFilters } from "./shell.js";
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
  // Active tab + filters are remembered across refreshes so the page comes back
  // exactly where you left it (validated against the known views / filter keys).
  const [view, setView] = useState(() => {
    try {
      const v = localStorage.getItem(LS.view);
      return v && VIEWS.some((x) => x.id === v) ? v : "overview";
    } catch (e) { return "overview"; }
  });
  const [filters, setFilters] = useState(loadFilters);

  const [localOverrides, setLocalOverrides] = useState(loadOverrides);
  const [remoteTags, setRemoteTags] = useState({});
  const [localCamNames, setLocalCamNames] = useState(loadCameraNames);
  const [remoteCamNames, setRemoteCamNames] = useState({});
  const [localMeta, setLocalMeta] = useState(loadMetadata);
  const [remoteMeta, setRemoteMeta] = useState({});
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
    remoteLoadCameraNames().then((map) => { if (alive && map) setRemoteCamNames(map); }).catch(() => {});
    remoteLoadMetadata().then((map) => { if (alive && map) setRemoteMeta(map); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS.overrides, JSON.stringify(localOverrides)); } catch (e) {}
  }, [localOverrides]);
  useEffect(() => {
    try { localStorage.setItem(LS.camNames, JSON.stringify(localCamNames)); } catch (e) {}
  }, [localCamNames]);
  useEffect(() => {
    try { localStorage.setItem(LS.meta, JSON.stringify(localMeta)); } catch (e) {}
  }, [localMeta]);
  useEffect(() => {
    try { localStorage.setItem(LS.view, view); } catch (e) {}
  }, [view]);
  useEffect(() => {
    try { localStorage.setItem(LS.filters, JSON.stringify(filters)); } catch (e) {}
  }, [filters]);

  // Local edits win over the shared baseline.
  const ov = useMemo(() => ({ ...remoteTags, ...localOverrides }), [remoteTags, localOverrides]);
  const camNames = useMemo(() => ({ ...remoteCamNames, ...localCamNames }), [remoteCamNames, localCamNames]);
  const camName = useCallback((raw) => displayCamera(raw, camNames), [camNames]);
  // Per-photo metadata: shared baseline overlaid by this device's edits (per key).
  const metaMap = useMemo(() => {
    const out = { ...remoteMeta };
    for (const [id, entry] of Object.entries(localMeta)) {
      out[id] = { ...(out[id] || {}), ...entry };
    }
    return out;
  }, [remoteMeta, localMeta]);
  // Apply the metadata overlay so every view sees notes / favorites / corrections.
  const captures = useMemo(
    () => data.captures.map((c) => applyMeta(c, metaMap)),
    [data.captures, metaMap]
  );
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

  // Tag many captures at once (Gallery selection). One local update, fan-out sync.
  const bulkAssign = useCallback((ids, species) => {
    const list = [...ids];
    if (!list.length || !species) return;
    setLocalOverrides((prev) => {
      const next = { ...prev };
      for (const id of list) next[String(id)] = [species];
      return next;
    });
    reviewed$.setSet((s) => { const n = new Set(s); for (const id of list) n.add(String(id)); return n; });
    if (hasSharedTags) {
      Promise.allSettled(list.map((id) => remoteSaveTags(id, [species]))).then((rs) => {
        const failed = rs.filter((r) => r.status === "rejected").length;
        if (failed) showToast("err", `Tagged ${list.length} \u00b7 ${failed} didn\u2019t sync`);
        else showToast("ok", `Tagged ${list.length} as ${species} for everyone`);
      });
    } else {
      showToast("ok", `Tagged ${list.length} photo${list.length === 1 ? "" : "s"} as ${species}`);
    }
  }, [reviewed$, showToast]);

  // Rename a camera for everyone (raw label is the stable key; "" resets it).
  const renameCamera = useCallback((rawName, name) => {
    const friendly = String(name || "").trim().slice(0, 60);
    setLocalCamNames((prev) => {
      const next = { ...prev };
      if (friendly && friendly !== rawName) next[String(rawName)] = friendly;
      else delete next[String(rawName)];
      return next;
    });
    if (hasSharedTags) {
      remoteSaveCameraName(rawName, friendly)
        .then(() => showToast("ok", friendly ? `Renamed to \u201c${friendly}\u201d for everyone` : "Name reset for everyone"))
        .catch(() => showToast("err", "Couldn\u2019t sync \u2014 saved on this device"));
    } else {
      showToast("ok", friendly ? `Renamed to \u201c${friendly}\u201d` : "Name reset");
    }
  }, [showToast]);

  // Update per-photo metadata (note, favorite, temp/moon corrections, ...). `patch`
  // is merged into the photo's entry; a key set to null removes it. Local-first,
  // fanned out to everyone when the shared Worker is configured.
  const updateMeta = useCallback((id, patch, opts = {}) => {
    if (!id || !patch || typeof patch !== "object") return;
    setLocalMeta((prev) => {
      const entry = { ...(prev[String(id)] || {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") delete entry[k];
        else entry[k] = v;
      }
      const next = { ...prev };
      if (Object.keys(entry).length) next[String(id)] = entry;
      else delete next[String(id)];
      return next;
    });
    if (hasSharedTags) {
      remoteSaveMetadata(id, patch)
        .then(() => { if (!opts.silent) showToast("ok", opts.okMsg || "Saved for everyone"); })
        .catch(() => showToast("err", "Couldn\u2019t sync \u2014 saved on this device"));
    } else if (!opts.silent) {
      showToast("ok", opts.okMsg || "Saved");
    }
  }, [showToast]);

  // Convenience: flip the favorite flag on a photo.
  const toggleFavorite = useCallback((id) => {
    const on = !metaOf({ id }, metaMap).favorite;
    updateMeta(id, { favorite: on ? true : null }, { okMsg: on ? "Added to favorites" : "Removed from favorites" });
  }, [updateMeta, metaMap]);

  /* ----------------------------- Render --------------------------------- */
  const meta = VIEWS.find((v) => v.id === view) || VIEWS[0];
  const View = VIEW_COMPONENTS[view] || Overview;
  const app = {
    data, captures, ov, theme,
    filters, setFilter, filtered, spList,
    gridSize, setGridSize, gridLayout, setGridLayout,
    archived, reviewed, assignSpecies, keep, archive: archiveCap,
    openLightbox, reviewQ, counts, setView,
    camName, camNames, bulkAssign, renameCamera,
    metaMap, updateMeta, toggleFavorite,
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
      cameraLabel=${camName(lbItem.camera)}
      meta=${metaOf(lbItem, metaMap)}
      onMeta=${(patch, opts) => updateMeta(lbItem.id, patch, opts)}
      onToggleFavorite=${() => toggleFavorite(lbItem.id)}
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
