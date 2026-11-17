// Vale Trails — application root: state, routing, actions and mount.
import { html, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, Fragment, ReactDOM } from "./react.js";
import {
  LS, usePersistent, usePersistentSet, useData, loadOverrides, newerDeploy, reloadForDeploy, safeToReload,
  remoteLoadTags, remoteSaveTags, remoteSaveTagsBatch, hasSharedTags, effectiveSpecies, timeAgo,
  loadCameraNames, remoteLoadCameraNames, remoteSaveCameraName, displayCamera,
  loadMetadata, remoteLoadMetadata, remoteSaveMetadata, applyMeta, metaOf, cameraLabels,
  remoteLoadComments, saveComment, updateUpload, NotSignedIn, TooManyAttempts,
  loadSession, saveSession, faceIdOn, faceIdName, setApiAuth, forgetPrivateData, getScrollY, scrollToY,
} from "./core.js";
import { filterCaptures, speciesList, reviewQueue } from "./analytics.js";
import {
  Sidebar, Topbar, MobileTopbar, LargeTitle, MobileNav, MoreScreen, PullToRefresh, useEdgeBack,
  VIEWS, MOBILE_MAIN, MOBILE_MORE, loadFilters, defaultFilters,
} from "./shell.js";
import { Lightbox, Toast } from "./ui.js";
import { UploadDialog, SignInDialog } from "./upload.js";
import { LoginScreen } from "./login.js";
import { Comments } from "./comments.js";
import { AccountsDialog, PasswordDialog, usePendingAccounts } from "./account.js";
import { AlertsDialog } from "./alerts.js";
import { FaceIdDialog, usePasskeySupport } from "./faceid.js";
import { InstallHint } from "./install.js";
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

// Every screen and photo has its own address, like screens in an app. The phone's
// back gesture (or the browser's Back) steps back through the screens you visited,
// closes a photo before leaving the site, and a reload or link lands on the same spot:
//   #/gallery              a screen (any id in VIEWS)
//   #/gallery/photo/<id>   a photo opened from that screen
// Older buck alerts link "#photo=<id>", which still opens the photo. Hash addresses
// need nothing from the server, so they work on GitHub Pages.
function readRoute() {
  const h = window.location.hash;
  const old = /^#photo=(.+)$/.exec(h);
  if (old) return { view: null, photo: decodeURIComponent(old[1]), old: true };
  const m = /^#\/([a-z]+)(?:\/photo\/(.+))?$/.exec(h);
  if (!m) return { view: null, photo: null };
  return { view: knownView(m[1]) ? m[1] : null, photo: m[2] ? decodeURIComponent(m[2]) : null };
}
// "more" is the phone's More tab (a list of the other pages); desktop has the sidebar.
const knownView = (v) => VIEWS.some((x) => x.id === v) || v === "more";
const MORE_META = { id: "more", label: "More" };
const routeUrl = (view, photo) => "#/" + view + (photo != null ? "/photo/" + encodeURIComponent(photo) : "");
const historyState = () => window.history.state || {};
const inPhotoStep = () => !!historyState().photo;
// Each screen is drawn fresh, so the app puts the scroll back itself (saved per entry).
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
const markScroll = () => {
  try { window.history.replaceState({ ...historyState(), scrollY: getScrollY() }, ""); } catch (e) {}
};

// Phones work like an iPhone app: the four tab bar screens are tabs (switching adds no
// Back step and each tab keeps its own scroll), and the screens under "More" open on
// top of the tab as a pushed screen with a back button. Desktop: every screen is a step.
const isPhone = () => window.matchMedia("(max-width: 900px)").matches;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Screen changes animate with View Transitions where supported (Safari 18+): tabs
// crossfade, pushed screens slide in from the right and back out (styles.css).
const HAS_VT = typeof document.startViewTransition === "function";
function transition(kind, update) {
  if (!HAS_VT || reduceMotion() || document.hidden) { update(); return; }
  const root = document.documentElement;
  root.dataset.nav = kind;
  try {
    const t = document.startViewTransition(() => ReactDOM.flushSync(update));
    t.finished.finally(() => { if (root.dataset.nav === kind) delete root.dataset.nav; });
  } catch (e) { delete root.dataset.nav; update(); }
}

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
  // The signed-in account. Its session token is kept on this device (30 days) so a
  // refresh doesn't sign you out; the password itself is never stored. Nothing is
  // shown, or even fetched, without one: the app is the sign-in screen until then.
  const [uploadAuth, setUploadAuth] = useState(loadSession);
  setApiAuth(uploadAuth);
  const { data, refresh, refreshing } = useData(uploadAuth, () => setUploadAuth(null));
  const [theme, setTheme] = usePersistent(LS.theme, "dark");
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistent(LS.sidebarCollapsed, "false");
  // Active tab + filters are remembered across refreshes so the page comes back
  // exactly where you left it (validated against the known views / filter keys).
  const [view, setViewState] = useState(() => {
    const routed = readRoute().view;
    if (routed && (routed !== "more" || isPhone())) return routed;
    try {
      const v = localStorage.getItem(LS.view);
      return v && knownView(v) && (v !== "more" || isPhone()) ? v : "overview";
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
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [faceIdOpen, setFaceIdOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const faceIdSupported = usePasskeySupport();
  const [signIn, setSignIn] = useState(null);
  const [uploadEdits, setUploadEdits] = useState(loadUploadEdits);
  const [comments, setComments] = useState({});
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(0);

  /* ------------------------------ Addresses ------------------------------ */
  const viewRef = useRef(view);
  viewRef.current = view;
  const pendingScroll = useRef(historyState().scrollY || 0);
  // A photo in the address when the app opens (or from an alert) waits for its data.
  const pendingPhoto = useRef(readRoute().photo);
  // Start from a clean entry for this screen; a photo then opens on top of it as its
  // own step, so the first Back closes the photo instead of leaving the site.
  useEffect(() => {
    window.history.replaceState({ scrollY: pendingScroll.current }, "", routeUrl(viewRef.current));
  }, []);
  // Phone tabs: where each tab was scrolled to, a tab to show once a pushed screen's
  // step is gone, and the animation for a Back the app started itself.
  const tabScroll = useRef({});
  const pendingTab = useRef(null);
  const navAnim = useRef(null);

  // A tab from the tab bar comes back where you left it; `fresh` (a link inside a page,
  // usually with new filters) opens it at the top. Tapping the tab you're on scrolls up.
  const switchTab = useCallback((v, fresh) => {
    // A Back is already on its way (a quick second tap): just change where it lands.
    if (pendingTab.current) { pendingTab.current = v; if (fresh) tabScroll.current[v] = 0; return; }
    // A photo or a pushed screen on top: the tab closes it, like iPhone apps.
    const covered = inPhotoStep() || historyState().pushed;
    if (v === viewRef.current && !covered) { scrollToY(0, true); return; }
    tabScroll.current[viewRef.current] = getScrollY();
    if (fresh) tabScroll.current[v] = 0;
    // Drop those steps first, then put the tab in place (popstate).
    if (covered) { pendingTab.current = v; window.history.back(); return; }
    const y = tabScroll.current[v] || 0;
    window.history.replaceState({ scrollY: y }, "", routeUrl(v));
    pendingScroll.current = y;
    transition("tab", () => setViewState(v));
  }, []);
  const pushScreen = useCallback((v) => {
    if (v === viewRef.current) return;
    tabScroll.current[viewRef.current] = getScrollY();
    markScroll();
    // One pushed screen at a time: going from one "More" page to another swaps it.
    if (historyState().pushed) window.history.replaceState({ scrollY: 0, pushed: true }, "", routeUrl(v));
    else window.history.pushState({ scrollY: 0, pushed: true }, "", routeUrl(v));
    pendingScroll.current = 0;
    transition("push", () => setViewState(v));
  }, []);
  // The back button on a pushed screen, or a swipe from the left edge ({ swiped }:
  // the page already slid away under the finger, so no second animation). Opened
  // straight from a link there's no step to go back to, so it returns to the More
  // tab on a phone (where these pages live) or Home on a computer.
  const goBack = useCallback((opts) => {
    const swiped = !!(opts && opts.swiped === true);
    if (historyState().pushed) { navAnim.current = swiped ? null : "pop"; window.history.back(); return; }
    const home = isPhone() ? "more" : "overview";
    tabScroll.current[viewRef.current] = getScrollY();
    window.history.replaceState({ scrollY: 0 }, "", routeUrl(home));
    pendingScroll.current = tabScroll.current[home] || 0;
    if (swiped) setViewState(home); else transition("pop", () => setViewState(home));
  }, []);
  const swipeBack = useCallback(() => goBack({ swiped: true }), [goBack]);
  // Links inside pages (and the desktop sidebar).
  const setView = useCallback((v) => {
    if (v === viewRef.current) return;
    if (isPhone()) {
      if (MOBILE_MAIN.includes(v)) switchTab(v, true); else pushScreen(v);
      return;
    }
    markScroll();
    window.history.pushState({ scrollY: 0 }, "", routeUrl(v));
    pendingScroll.current = 0;
    transition("tab", () => setViewState(v));
  }, [switchTab, pushScreen]);
  // A new screen opens at the top; one you come back to opens where you left it.
  useLayoutEffect(() => {
    // After a swipe back the page was slid off to the right; the new screen sits in place.
    const frame = document.querySelector(".main");
    if (frame && frame.style.transform) {
      frame.style.transition = "none";
      frame.style.transform = "";
      frame.style.boxShadow = "";
    }
    const y = pendingScroll.current;
    if (y == null) return;
    pendingScroll.current = null;
    scrollToY(y);
    requestAnimationFrame(() => scrollToY(y)); // for content drawn a frame later
  }, [view]);

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
    if (auth) {
      // After a password sign-in on a phone that could use Face ID, offer it once.
      const offer = faceIdSupported && auth.token && !faceIdOn(auth.user);
      showToast("ok", `Signed in as ${auth.user}`,
        offer ? { label: `Use ${faceIdName()}`, onClick: () => setFaceIdOpen(true) } : undefined);
      pushLocalEdits(auth);
    }
  }, [showToast, pushLocalEdits, faceIdSupported]);
  const signOut = useCallback(() => { setUploadAuth(null); setAccountsOpen(false); showToast("ok", "Signed out"); }, [showToast]);
  const [pendingAccounts, refreshPending] = usePendingAccounts(uploadAuth, data);
  // Signing out (or a session that ended) also deletes the photo list and the
  // photos kept on this device for offline use.
  useEffect(() => { saveSession(uploadAuth); if (!uploadAuth) forgetPrivateData(); }, [uploadAuth]);

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

  // Opening the app clears the number on its Home Screen icon (alerts since last open).
  useEffect(() => {
    const clear = () => {
      if (document.visibilityState !== "visible") return;
      if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "clear-badge" });
      }
    };
    clear();
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);

  // Ask the service worker to keep the last two days' small photo copies on the
  // phone, so recent photos show without signal (see sw.js).
  useEffect(() => {
    if (!navigator.serviceWorker || !data.captures.length) return;
    const since = Date.now() - 2 * 86400000;
    const urls = data.captures.filter((c) => c.date.getTime() >= since && (c.thumb || c.image) && c.media !== "video")
      .slice(0, 150).map((c) => c.thumb || c.image).filter((u) => /^https?:/.test(u));
    if (!urls.length) return;
    navigator.serviceWorker.ready.then((reg) => reg.active && reg.active.postMessage({ type: "keep-photos", urls })).catch(() => {});
  }, [data]);

  // Photos are found by id among the filtered photos (so prev/next follow the screen's
  // filters) or, failing that, among all of them.
  const capsRef = useRef(null);
  capsRef.current = { captures, allCaptures };
  const findPhoto = useCallback((id) => {
    const { captures: shown, allCaptures: all } = capsRef.current;
    const c = all.find((x) => String(x.id) === String(id));
    if (!c) return null;
    const list = shown.includes(c) ? shown : all;
    return { list, index: list.indexOf(c) };
  }, []);

  // A linked photo (reload, shared link, buck alert) opens once it's in the data; if
  // it's newer than what's loaded, this runs again when data refreshes.
  useEffect(() => {
    const id = pendingPhoto.current;
    if (id == null) return;
    const found = findPhoto(id);
    if (!found) return;
    pendingPhoto.current = null;
    setLightbox(found);
    window.history.pushState({ photo: true }, "", routeUrl(viewRef.current, id));
  }, [allCaptures, captures, findPhoto]);

  // Back / Forward (and alert taps while the app is open) follow the address.
  useEffect(() => {
    const onPop = () => {
      const r = readRoute();
      const anim = navAnim.current;
      navAnim.current = null;
      if (pendingTab.current) {
        // A photo over a pushed screen is two steps: keep going back until neither is left.
        if (historyState().pushed || historyState().photo) { window.history.back(); return; }
        // The pushed screen's (or photo's) step is gone; the chosen tab takes this entry.
        const t = pendingTab.current;
        pendingTab.current = null;
        const y = tabScroll.current[t] || 0;
        window.history.replaceState({ scrollY: y }, "", routeUrl(t));
        pendingScroll.current = y;
        setLightbox(null);
        transition("tab", () => setViewState(t));
        return;
      }
      if (r.old) {
        // "#photo=<id>" from an alert: this entry becomes that photo's own address.
        const found = findPhoto(r.photo);
        const url = routeUrl(viewRef.current, found ? r.photo : null);
        window.history.replaceState(found ? { photo: true } : {}, "", url);
        if (found) setLightbox(found); else pendingPhoto.current = r.photo;
        return;
      }
      if (r.view && r.view !== viewRef.current) {
        pendingScroll.current = historyState().scrollY || 0;
        // Only the app's own back button animates: a browser swipe-back already does.
        if (anim) transition(anim, () => setViewState(r.view));
        else setViewState(r.view);
      }
      const found = r.photo != null ? findPhoto(r.photo) : null;
      setLightbox(found);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [findPhoto]);

  /* ---------------------------- App updates ----------------------------- */
  // Coming back to the app loads a newer version straight away; one found while
  // the app is open waits for the next tab tap or return, never mid-scroll or
  // over a half-typed comment.
  const pendingDeploy = useRef(null);
  useEffect(() => {
    let checking = false;
    const check = async (resumed) => {
      if (checking) return;
      checking = true;
      const deployed = await newerDeploy();
      checking = false;
      if (!deployed) return;
      if (resumed && safeToReload()) reloadForDeploy(deployed);
      else pendingDeploy.current = deployed;
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(true); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    const t = setInterval(() => check(false), 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      clearInterval(t);
    };
  }, []);

  /* --------------------------- Actions ---------------------------------- */
  const setFilter = useCallback((patch) => setFilters((f) => ({ ...f, ...patch })), []);
  // Back to every photo. Returns whether anything was filtered.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const clearFilters = useCallback(() => {
    const blank = defaultFilters();
    const f = filtersRef.current;
    if (Object.keys(blank).every((k) => f[k] === blank[k])) return false;
    setFilters(blank);
    return true;
  }, []);
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

  // Manual refresh starts over from every photo, and says what it found, so a tap
  // never looks like it did nothing.
  const manualRefresh = useCallback(async () => {
    clearFilters();
    // A newer version of the app loads now (refreshing starts unfiltered anyway).
    const deployed = await newerDeploy();
    if (deployed) {
      try { localStorage.removeItem(LS.filters); } catch (e) {}
      reloadForDeploy(deployed);
      return;
    }
    const before = new Set(data.captures.map((c) => c.id));
    const fresh = await refresh();
    if (!fresh) { showToast("err", "Couldn’t reach the site — try again"); return; }
    const added = fresh.captures.filter((c) => !before.has(c.id)).length;
    showToast("ok", added ? `${added} new photo${added === 1 ? "" : "s"}` : "No new photos yet");
  }, [data.captures, refresh, showToast, clearFilters]);

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
  const openLightbox = useCallback((list, index) => {
    const c = list[index];
    if (!c) return;
    setLightbox({ list, index });
    markScroll();
    window.history.pushState({ photo: true }, "", routeUrl(viewRef.current, c.id));
  }, []);
  // Every way of closing a photo goes back through history, so the two never disagree.
  const closeLightbox = useCallback(() => {
    if (inPhotoStep()) window.history.back();
    else { setLightbox(null); window.history.replaceState(historyState(), "", routeUrl(viewRef.current)); }
  }, []);
  // Next / previous swap the photo in the address without adding steps, so one Back
  // always returns to the screen rather than through every photo seen.
  const lbId = lightbox && lightbox.list[lightbox.index] ? lightbox.list[lightbox.index].id : null;
  useEffect(() => {
    if (lbId == null || !inPhotoStep()) return;
    window.history.replaceState(historyState(), "", routeUrl(viewRef.current, lbId));
  }, [lbId]);

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
      closeLightbox();
      showToast("ok", "Upload deleted for everyone");
      return true;
    } catch (e) { syncFailed(e); return false; }
  }, [uploadAuth, openSignIn, showToast, syncFailed, closeLightbox]);

  /* ----------------------------- Render --------------------------------- */
  const meta = VIEWS.find((v) => v.id === view) || (view === "more" ? MORE_META : VIEWS[0]);
  const View = view === "more" ? MoreScreen : VIEW_COMPONENTS[view] || Overview;
  const pageTitle = view === "overview" ? "Vale Trails" : meta.label;
  // Anything open on top (a photo, a pop-up): the tab bar stays visible over it, and
  // tapping a tab closes it and goes to that tab. An upload in progress stays open.
  const overlayOpen = !!(lightbox || alertsOpen || accountsOpen || faceIdOpen || passwordOpen || signIn || uploadOpen);
  // Going to another tab from the tab bar (or sidebar) starts it unfiltered. Links in
  // pages that set a filter on purpose (a camera card, a chart bar) use setView instead.
  // Saved scroll spots were for the filtered lists, so those tabs open at the top.
  const tabFromBar = (v) => {
    // A newer version found while the app was open loads with the tab tap.
    if (pendingDeploy.current) {
      if (v !== view) { try { localStorage.removeItem(LS.filters); } catch (e) {} }
      window.history.replaceState({ scrollY: 0 }, "", routeUrl(v));
      reloadForDeploy(pendingDeploy.current);
      return;
    }
    setAlertsOpen(false); setAccountsOpen(false); setFaceIdOpen(false); setPasswordOpen(false); setSignIn(null);
    const cleared = v !== view && clearFilters();
    switchTab(v, cleared);
    if (cleared) tabScroll.current = { [v]: 0 };
  };
  const viewFromSidebar = (v) => {
    if (v !== view) clearFilters();
    setView(v);
  };
  // Swipe from the left edge goes back from the pages on More (Map, Identify).
  useEdgeBack(MOBILE_MORE.includes(view) && !overlayOpen, swipeBack);
  const app = {
    more: {
      onPush: pushScreen, onAlerts: () => setAlertsOpen(true),
      onFaceId: faceIdSupported ? () => setFaceIdOpen(true) : null,
      onPassword: () => setPasswordOpen(true),
      onAccounts: () => setAccountsOpen(true), pending: pendingAccounts,
      onSignIn: () => openSignIn(), onSignOut: signOut, status, theme, toggleTheme,
    },
    data, captures, ov, theme,
    filters, setFilter, filtered, spList,
    gridSize, setGridSize,
    archived, reviewed, assignSpecies, keep, archive: archiveCap,
    openLightbox, reviewQ, counts, setView,
    uploads, allCaptures, comments, openUpload: () => setUploadOpen(true),
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
    pending: pendingAccounts, onAccounts: () => setAccountsOpen(true),
    onAlerts: () => setAlertsOpen(true),
    onFaceId: faceIdSupported ? () => setFaceIdOpen(true) : null,
    onPassword: () => setPasswordOpen(true),
  };

  // Nothing without signing in: until then the app is the sign-in screen.
  if (!uploadAuth) return html`<${LoginScreen} onDone=${signedIn} message=${signIn ? signIn.message : ""} />`;

  return html`<${Fragment}>
    <div className=${sidebarCollapsed === "true" ? "app app--sidebar-collapsed" : "app"}>
      <${Sidebar} view=${view} setView=${viewFromSidebar} counts=${counts} status=${status}
        onCollapse=${() => setSidebarCollapsed("true")} />
      <main className="main">
        <${MobileTopbar} ...${chrome} title=${pageTitle} onBack=${MOBILE_MORE.includes(view) ? goBack : null} />
        <${LargeTitle} title=${pageTitle} status=${status} />
        <${Topbar} title=${meta.label} ...${chrome}
          sidebarHidden=${sidebarCollapsed === "true"} onShowSidebar=${() => setSidebarCollapsed("false")} />
        <div className=${HAS_VT && !reduceMotion() ? "view" : "view view__enter"} key=${view}>
          <${View} ...${app} />
        </div>
      </main>
    </div>

    <${MobileNav} view=${view} onTab=${tabFromBar} counts=${counts} />
    <${PullToRefresh} onRefresh=${manualRefresh} />
    <${InstallHint} />

    ${lbItem && html`<${Lightbox}
      capture=${lbItem}
      species=${effectiveSpecies(lbItem, ov)}
      cameraLabel=${camName(lbItem.camera)}
      meta=${metaOf(lbItem, metaMap)}
      onMeta=${(patch, opts) => updateMeta(lbItem.id, patch, opts)}
      onToggleFavorite=${() => toggleFavorite(lbItem.id)}
      onTag=${(sp) => assignSpecies(lbItem.id, sp)}
      onToast=${showToast}
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
      onClose=${closeLightbox} />`}

    ${uploadOpen && html`<${UploadDialog} cameras=${data.cameras} camNames=${camNames} buckNames=${buckNames}
      auth=${uploadAuth} setAuth=${signedIn} onClose=${() => setUploadOpen(false)}
      onUploaded=${(sent, failed) => {
        if (!failed) setUploadOpen(false);
        showToast("ok", `${sent} file${sent === 1 ? "" : "s"} uploaded. They'll appear in a few minutes.`);
      }} />`}

    ${faceIdOpen && uploadAuth && html`<${FaceIdDialog} auth=${uploadAuth} showToast=${showToast}
      onClose=${() => setFaceIdOpen(false)}
      onSignedOut=${() => { setFaceIdOpen(false); setUploadAuth(null); openSignIn("Your session ended. Sign in again."); }} />`}

    ${passwordOpen && uploadAuth && html`<${PasswordDialog} auth=${uploadAuth} showToast=${showToast}
      onClose=${() => setPasswordOpen(false)}
      onChanged=${(auth) => setUploadAuth(auth)}
      onSignedOut=${() => { setPasswordOpen(false); setUploadAuth(null); openSignIn("Your session ended. Sign in again."); }} />`}

    ${alertsOpen && html`<${AlertsDialog} auth=${uploadAuth} showToast=${showToast}
      cameras=${data.cameras || []} camName=${camName}
      onClose=${() => setAlertsOpen(false)}
      onSignIn=${() => { setAlertsOpen(false); openSignIn("Sign in to turn on alerts."); }}
      onSignedOut=${() => { setAlertsOpen(false); setUploadAuth(null); openSignIn("Your session ended. Sign in again."); }} />`}

    ${accountsOpen && uploadAuth && html`<${AccountsDialog} auth=${uploadAuth} showToast=${showToast} uploads=${uploads}
      onClose=${() => setAccountsOpen(false)} onChanged=${refreshPending}
      onUploadsRemoved=${(ids) => setUploadEdits((m) => {
        const next = { ...m };
        for (const id of ids) next[String(id)] = { removed: true, at: Date.now() };
        return next;
      })}
      onSignedOut=${() => { setAccountsOpen(false); setUploadAuth(null); openSignIn("Your session ended. Sign in again."); }} />`}

    ${signIn && html`<${SignInDialog} message=${signIn.message} onDone=${signedIn} onClose=${() => setSignIn(null)} />`}

    ${toast && html`<${Toast} kind=${toast.kind} action=${toast.action}>${toast.msg}</${Toast}>`}
  </${Fragment}>`;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(html`<${App} />`);
