// Vale Trails — application root: state, routing, actions and mount.
import { html, useState, useEffect, useMemo, useRef, useCallback, Fragment, ReactDOM } from "./react.js";
import {
  LS, usePersistent, usePersistentSet, useData, loadOverrides,
  remoteLoadTags, remoteSaveTags, remoteSaveTagsBatch, hasSharedTags, effectiveSpecies, timeAgo,
  loadCameraNames, remoteLoadCameraNames, remoteSaveCameraName, displayCamera,
  loadMetadata, remoteLoadMetadata, remoteSaveMetadata, applyMeta, metaOf, cameraLabels,
  remoteLoadComments, saveComment, updateUpload, NotSignedIn, TooManyAttempts,
} from "./core.js";
import { filterCaptures, speciesList, reviewQueue } from "./analytics.js";
import { Sidebar, Topbar, MobileTopbar, MobileNav, VIEWS, loadFilters } from "./shell.js";
import { Lightbox, Toast } from "./ui.js";
import { UploadDialog, SignInDialog } from "./upload.js";
import { Comments } from "./comments.js";
import { Overview } from "./views/overview.js";
import { Gallery } from "./views/gallery.js";
import { MapView } from "./views/mapview.js";
import { Insights } from "./views/insights.js";
import { Review } from "./views/review.js";
import { Bucks } from "./views/bucks.js";
import { Uploads } from "./views/uploads.js";

// Past this, the pull has missed far more runs than GitHub's usual throttling explains.
const STALE_SYNC_MS = 12 * 3600000;
// An edit or deletion of an upload shows right away from this overlay; the next
// data.js carries it for real, so the overlay only needs to outlive a pull run.
const UPLOAD_EDIT_TTL_MS = 30 * 60000;

const VIEW_COMPONENTS = { overview: Overview, gallery: Gallery, uploads: Uploads, bucks: Bucks, insights: Insights, map: MapView, review: Review };

function loadUploadEdits() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(LS.uploadEdits) || "{}");
    const cutoff = Date.now() - UPLOAD_EDIT_TTL_MS;
    const out = {};
    for (const [id, e] of Object.entries(raw || {})) if (e && e.at > cutoff) out[id] = e;
    return out;
  } catch (e) { return {}; }
}

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

  const [lightbox, setLightbox] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  // The family login for this page load. The password stays in memory only.
  const [uploadAuth, setUploadAuth] = useState(null);
  const [signIn, setSignIn] = useState(null);
  const [uploadEdits, setUploadEdits] = useState(loadUploadEdits);
  const [comments, setComments] = useState({});
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(0);

  // Once a tag or name is saved for everyone, the shared copy is the truth. Dropping
  // the local copy means this device follows later edits made anywhere else.
  const settleTags = useCallback((map) => {
    setRemoteTags((r) => ({ ...r, ...map }));
    setLocalOverrides((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(map)) delete next[id];
      return next;
    });
    try { localStorage.removeItem(LS.legacyOverrides); } catch (e) {}
  }, []);
  const settleCameraNames = useCallback((map) => {
    setRemoteCamNames((r) => {
      const next = { ...r };
      for (const [id, name] of Object.entries(map)) {
        if (name) next[id] = name;
        else delete next[id];
      }
      return next;
    });
    setLocalCamNames((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(map)) delete next[id];
      return next;
    });
  }, []);

  const settleMeta = useCallback((id, patch) => {
    const key = String(id);
    setRemoteMeta((r) => {
      const entry = { ...(r[key] || {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") delete entry[k];
        else entry[k] = v;
      }
      return { ...r, [key]: entry };
    });
    setLocalMeta((prev) => {
      if (!prev[key]) return prev;
      const entry = { ...prev[key] };
      for (const k of Object.keys(patch)) delete entry[k];
      const next = { ...prev };
      if (Object.keys(entry).length) next[key] = entry;
      else delete next[key];
      return next;
    });
  }, []);

  /* ----------------------------- Toasts ---------------------------------- */
  const showToast = useCallback((kind, msg, action) => {
    setToast({ kind, msg, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 6000 : 2300);
  }, []);
  const openSignIn = useCallback((message) => { setToast(null); setSignIn({ message: message || "" }); }, []);
  // Edits made while signed out stay on this device; say so, with a way to fix it.
  const signInToast = useCallback(() => {
    showToast("warn", "Saved on this device only", { label: "Sign in", onClick: () => openSignIn("Sign in to save your changes for everyone.") });
  }, [showToast, openSignIn]);
  const syncFailed = useCallback((e) => {
    if (e instanceof NotSignedIn) { setUploadAuth(null); signInToast(); }
    else if (e instanceof TooManyAttempts) showToast("err", "Too many attempts. Wait a minute and try again.");
    else showToast("err", "Couldn’t sync — saved on this device");
  }, [signInToast, showToast]);

  // Edits only this device has: anything made before signing in, or a save that
  // failed. They go up for everyone the moment someone signs in.
  const pushLocalEdits = useCallback(async (auth) => {
    if (!hasSharedTags || !auth) return;
    const [sharedTags, sharedNames] = await Promise.all([remoteLoadTags(), remoteLoadCameraNames()]).catch(() => [null, null]);
    const tags = loadOverrides();
    const newTags = {};
    for (const [id, t] of Object.entries(tags)) {
      if (JSON.stringify((sharedTags || {})[id]) !== JSON.stringify(t)) newTags[id] = t;
    }
    const names = loadCameraNames();
    const metas = loadMetadata();
    let pushed = 0;
    try {
      if (Object.keys(newTags).length) {
        await remoteSaveTagsBatch(newTags, auth);
        pushed += Object.keys(newTags).length;
      }
      settleTags(tags);
      for (const [id, name] of Object.entries(names)) {
        if ((sharedNames || {})[id] !== name) { await remoteSaveCameraName(id, name, auth); pushed++; }
      }
      settleCameraNames(names);
      for (const [id, entry] of Object.entries(metas)) {
        await remoteSaveMetadata(id, entry, auth);
        settleMeta(id, entry);
        pushed++;
      }
      if (pushed) showToast("ok", `Shared ${pushed} saved edit${pushed === 1 ? "" : "s"} with everyone`);
    } catch (e) { syncFailed(e); }
  }, [settleTags, settleCameraNames, settleMeta, showToast, syncFailed]);

  const signedIn = useCallback((auth) => {
    setUploadAuth(auth);
    setSignIn(null);
    if (auth) { showToast("ok", `Signed in as ${auth.user}`); pushLocalEdits(auth); }
  }, [showToast, pushLocalEdits]);
  const signOut = useCallback(() => { setUploadAuth(null); showToast("ok", "Signed out"); }, [showToast]);

  // Reload shared data with every refresh, so edits from other devices show up
  // on the same schedule as new photos.
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  useEffect(() => {
    let alive = true;
    Promise.all([remoteLoadTags(), remoteLoadCameraNames()]).then(([tags, names]) => {
      if (!alive) return;
      if (tags) setRemoteTags(tags);
      if (names) setRemoteCamNames(names);
    }).catch(() => {});
    remoteLoadMetadata().then((map) => { if (alive && map) setRemoteMeta(map); }).catch(() => {});
    remoteLoadComments().then((map) => { if (alive && map) setComments(map); }).catch(() => {});
    return () => { alive = false; };
  }, [data]);
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
  useEffect(() => {
    try { sessionStorage.setItem(LS.uploadEdits, JSON.stringify(uploadEdits)); } catch (e) {}
  }, [uploadEdits]);

  // Local edits win over the shared baseline.
  const ov = useMemo(() => ({ ...remoteTags, ...localOverrides }), [remoteTags, localOverrides]);
  const camNames = useMemo(
    () => ({ ...cameraLabels(data.cameras), ...remoteCamNames, ...localCamNames }),
    [data.cameras, remoteCamNames, localCamNames]
  );
  const camName = useCallback((raw) => displayCamera(raw, camNames), [camNames]);
  // Per-photo metadata: shared baseline overlaid by this device's edits (per key).
  const metaMap = useMemo(() => {
    const out = { ...remoteMeta };
    for (const [id, entry] of Object.entries(localMeta)) {
      out[id] = { ...(out[id] || {}), ...entry };
    }
    return out;
  }, [remoteMeta, localMeta]);
  // Apply the metadata overlay so every view sees notes / favorites / corrections,
  // and the upload-edit overlay so a fixed date or a deletion shows immediately.
  const allCaptures = useMemo(() => {
    const out = [];
    let resort = false;
    for (const raw of data.captures) {
      let c = applyMeta(raw, metaMap);
      const edit = raw.uploadedBySite ? uploadEdits[String(raw.id)] : null;
      if (edit) {
        if (edit.removed) continue;
        c = { ...c };
        if (edit.camera) c.camera = edit.camera;
        if (edit.date) {
          const d = new Date(edit.date);
          if (!isNaN(d.getTime())) { c.date = d; resort = true; }
        }
      }
      out.push(c);
    }
    if (resort) out.sort((a, b) => b.date - a.date);
    return out;
  }, [data.captures, metaMap, uploadEdits]);
  // Uploads get their own tab. Those filed under a real camera (an SD-card pull)
  // are camera data and count everywhere; phone snapshots stay out of the charts,
  // the best-bet card and the Identify queue.
  const cameraSet = useMemo(() => new Set(data.cameras.map((c) => c.name)), [data.cameras]);
  const captures = useMemo(
    () => allCaptures.filter((c) => !c.uploadedBySite || cameraSet.has(c.camera)),
    [allCaptures, cameraSet]
  );
  const uploads = useMemo(() => allCaptures.filter((c) => c.uploadedBySite), [allCaptures]);
  const buckNames = useMemo(
    () => [...new Set(allCaptures.map((c) => c.buck).filter(Boolean))].sort(),
    [allCaptures]
  );
  const spList = useMemo(() => speciesList(captures, ov), [captures, ov]);
  const filtered = useMemo(() => filterCaptures(captures, filters, ov), [captures, filters, ov]);
  const reviewQ = useMemo(() => reviewQueue(captures, ov, archived, reviewed), [captures, ov, archived, reviewed]);

  const counts = { total: captures.length, cameras: data.cameras.length, review: reviewQ.length };
  const status = {
    demo: data.demo,
    checked: data.generatedAt ? timeAgo(data.generatedAt) : null,
    stale: !data.generatedAt || Date.now() - data.generatedAt.getTime() > STALE_SYNC_MS,
    newest: captures.length ? timeAgo(captures[0].date) : null,
  };

  /* --------------------------- Actions ---------------------------------- */
  const setFilter = useCallback((patch) => setFilters((f) => ({ ...f, ...patch })), []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), [setTheme]);

  const changeComment = useCallback(async (body) => {
    try {
      const list = await saveComment(body, uploadAuth);
      setComments((all) => ({ ...all, [body.photo]: list }));
      return true;
    } catch (e) {
      if (e instanceof NotSignedIn) { setUploadAuth(null); openSignIn("Sign in again to post comments."); }
      else if (e instanceof TooManyAttempts) showToast("err", "Too many attempts. Wait a minute and try again.");
      else showToast("err", "Couldn’t save that — try again");
      return false;
    }
  }, [uploadAuth, showToast, openSignIn]);

  // Manual refresh says what it found, so a tap never looks like it did nothing.
  const manualRefresh = useCallback(async () => {
    const before = new Set(data.captures.map((c) => c.id));
    const fresh = await refresh();
    if (!fresh) { showToast("err", "Couldn’t reach the site — try again"); return; }
    const added = fresh.captures.filter((c) => !before.has(c.id)).length;
    showToast("ok", added ? `${added} new photo${added === 1 ? "" : "s"}` : "No new photos yet");
  }, [data.captures, refresh, showToast]);

  const setOverrideTags = useCallback((id, tags) => {
    setLocalOverrides((prev) => {
      const next = { ...prev };
      if (tags && tags.length) next[String(id)] = tags;
      else delete next[String(id)];
      return next;
    });
  }, []);

  // Every shared save follows the same shape: apply locally first, then sync when
  // signed in, or explain why it stayed on this device.
  const assignSpecies = useCallback((id, species) => {
    setOverrideTags(id, [species]);
    reviewed$.add(id);
    if (!hasSharedTags) { showToast("ok", `Tagged ${species}`); return; }
    if (!uploadAuth) { signInToast(); return; }
    remoteSaveTags(id, [species], uploadAuth)
      .then(() => { settleTags({ [String(id)]: [species] }); showToast("ok", `Saved “${species}” for everyone`); })
      .catch(syncFailed);
  }, [setOverrideTags, settleTags, reviewed$, showToast, uploadAuth, signInToast, syncFailed]);

  const keep = useCallback((id) => { reviewed$.add(id); showToast("ok", "Marked reviewed"); }, [reviewed$, showToast]);
  const archiveCap = useCallback((id) => { archive$.add(id); showToast("ok", "Archived"); }, [archive$, showToast]);
  const openLightbox = useCallback((list, index) => setLightbox({ list, index }), []);

  // Tag many captures at once (Gallery selection). One local update, one request.
  const bulkAssign = useCallback((ids, species) => {
    const list = [...ids];
    if (!list.length || !species) return;
    setLocalOverrides((prev) => {
      const next = { ...prev };
      for (const id of list) next[String(id)] = [species];
      return next;
    });
    reviewed$.setSet((s) => { const n = new Set(s); for (const id of list) n.add(String(id)); return n; });
    if (!hasSharedTags) { showToast("ok", `Tagged ${list.length} photo${list.length === 1 ? "" : "s"} as ${species}`); return; }
    if (!uploadAuth) { signInToast(); return; }
    const items = Object.fromEntries(list.map((id) => [String(id), [species]]));
    remoteSaveTagsBatch(items, uploadAuth)
      .then(() => { settleTags(items); showToast("ok", `Tagged ${list.length} as ${species} for everyone`); })
      .catch(syncFailed);
  }, [reviewed$, settleTags, showToast, uploadAuth, signInToast, syncFailed]);

  // Rename a camera for everyone (raw label is the stable key; "" resets it).
  const renameCamera = useCallback((rawName, name) => {
    const friendly = String(name || "").trim().slice(0, 60);
    setLocalCamNames((prev) => {
      const next = { ...prev };
      if (friendly && friendly !== rawName) next[String(rawName)] = friendly;
      else delete next[String(rawName)];
      return next;
    });
    if (!hasSharedTags) { showToast("ok", friendly ? `Renamed to “${friendly}”` : "Name reset"); return; }
    if (!uploadAuth) { signInToast(); return; }
    remoteSaveCameraName(rawName, friendly, uploadAuth)
      .then(() => {
        settleCameraNames({ [String(rawName)]: friendly });
        showToast("ok", friendly ? `Renamed to “${friendly}” for everyone` : "Name reset for everyone");
      })
      .catch(syncFailed);
  }, [settleCameraNames, showToast, uploadAuth, signInToast, syncFailed]);

  // Update per-photo metadata (note, favorite, temp/moon corrections, ...). `patch`
  // is merged into the photo's entry; a key set to null removes it. Local-first,
  // shared with everyone when signed in.
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
    if (!hasSharedTags) { if (!opts.silent) showToast("ok", opts.okMsg || "Saved"); return; }
    if (!uploadAuth) { signInToast(); return; }
    remoteSaveMetadata(id, patch, uploadAuth)
      .then(() => {
        settleMeta(id, patch);
        if (!opts.silent) showToast("ok", opts.okMsg || "Saved for everyone");
      })
      .catch(syncFailed);
  }, [settleMeta, showToast, uploadAuth, signInToast, syncFailed]);

  // Convenience: flip the favorite flag on a photo.
  const toggleFavorite = useCallback((id) => {
    const on = !metaOf({ id }, metaMap).favorite;
    updateMeta(id, { favorite: on ? true : null }, { okMsg: on ? "Added to favorites" : "Removed from favorites" });
  }, [updateMeta, metaMap]);

  // Uploads can be corrected or removed by anyone signed in. The overlay shows the
  // result at once; the next pull writes it into data.js for everyone.
  const editUpload = useCallback(async (id, patch) => {
    if (!uploadAuth) { openSignIn("Sign in to edit uploads."); return false; }
    try {
      const r = await updateUpload({ id: String(id), ...patch }, uploadAuth);
      const up = r.upload || {};
      setUploadEdits((m) => ({
        ...m,
        [String(id)]: { ...(m[String(id)] || {}), camera: up.camera || patch.camera, date: up.date || patch.date, at: Date.now() },
      }));
      showToast("ok", "Upload updated for everyone");
      return true;
    } catch (e) { syncFailed(e); return false; }
  }, [uploadAuth, openSignIn, showToast, syncFailed]);

  const deleteUpload = useCallback(async (id) => {
    if (!uploadAuth) { openSignIn("Sign in to delete uploads."); return false; }
    try {
      await updateUpload({ id: String(id), remove: true }, uploadAuth);
      setUploadEdits((m) => ({ ...m, [String(id)]: { removed: true, at: Date.now() } }));
      setLightbox(null);
      showToast("ok", "Upload deleted for everyone");
      return true;
    } catch (e) { syncFailed(e); return false; }
  }, [uploadAuth, openSignIn, showToast, syncFailed]);

  /* ----------------------------- Render --------------------------------- */
  const meta = VIEWS.find((v) => v.id === view) || VIEWS[0];
  const View = VIEW_COMPONENTS[view] || Overview;
  const app = {
    data, captures, ov, theme,
    filters, setFilter, filtered, spList,
    gridSize, setGridSize,
    archived, reviewed, assignSpecies, keep, archive: archiveCap,
    openLightbox, reviewQ, counts, setView,
    uploads, comments, openUpload: () => setUploadOpen(true),
    camName, camNames, bulkAssign, renameCamera,
    metaMap, updateMeta, toggleFavorite,
    auth: uploadAuth, openSignIn,
  };

  // The open photo is looked up fresh so an edit (date, camera, note) shows at once.
  const lbStale = lightbox ? lightbox.list[lightbox.index] : null;
  const lbItem = lbStale ? allCaptures.find((c) => c.id === lbStale.id) || lbStale : null;
  const chrome = {
    theme, toggleTheme, onRefresh: manualRefresh, refreshing, status,
    onUpload: () => setUploadOpen(true),
    auth: uploadAuth, onSignIn: () => openSignIn(), onSignOut: signOut,
  };

  return html`<${Fragment}>
    <div className="app">
      <${Sidebar} view=${view} setView=${setView} counts=${counts} status=${status} />
      <main className="main">
        <${MobileTopbar} ...${chrome} />
        <${Topbar} title=${meta.label} ...${chrome} />
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
      onTag=${(sp) => assignSpecies(lbItem.id, sp)}
      buckNames=${buckNames}
      signedIn=${!hasSharedTags || !!uploadAuth}
      onSignIn=${() => openSignIn("Sign in to save tags, names and notes for everyone.")}
      upload=${lbItem.uploadedBySite ? {
        cameras: data.cameras, camName, auth: uploadAuth,
        onSignIn: () => openSignIn("Sign in to edit or delete this upload."),
        onEdit: (patch) => editUpload(lbItem.id, patch),
        onDelete: () => deleteUpload(lbItem.id),
      } : null}
      comments=${html`<${Comments} key=${lbItem.id} photo=${String(lbItem.id)} list=${comments[lbItem.id] || []}
        auth=${uploadAuth} setAuth=${signedIn} onChange=${changeComment} />`}
      hasPrev=${lightbox.index > 0}
      hasNext=${lightbox.index < lightbox.list.length - 1}
      onPrev=${() => setLightbox((s) => ({ ...s, index: Math.max(0, s.index - 1) }))}
      onNext=${() => setLightbox((s) => ({ ...s, index: Math.min(s.list.length - 1, s.index + 1) }))}
      onClose=${() => setLightbox(null)} />`}

    ${uploadOpen && html`<${UploadDialog} cameras=${data.cameras} camNames=${camNames} buckNames=${buckNames}
      auth=${uploadAuth} setAuth=${signedIn} onClose=${() => setUploadOpen(false)}
      onUploaded=${(sent, failed) => {
        if (!failed) setUploadOpen(false);
        showToast("ok", `${sent} file${sent === 1 ? "" : "s"} uploaded. They'll appear in a few minutes.`);
      }} />`}

    ${signIn && html`<${SignInDialog} message=${signIn.message} onDone=${signedIn} onClose=${() => setSignIn(null)} />`}

    ${toast && html`<${Toast} kind=${toast.kind} action=${toast.action}>${toast.msg}</${Toast}>`}
  </${Fragment}>`;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(html`<${App} />`);
