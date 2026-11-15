// Vale Trails — push alerts: each phone picks the species it wants to hear about.
// Standard Web Push: once turned on, alerts arrive on the lock screen with the app
// closed. On iPhone that works from the Home Screen app (iOS 16.4+), not Safari.
import { html, useState, useEffect } from "./react.js";
import { Btn, IconBtn } from "./ui.js";
import { Icon } from "./icons.js";
import {
  SPECIES_ORDER, speciesColor, LS, loadPushKey, savePushSubscription, removePushSubscription, NotSignedIn,
} from "./core.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");
const ALERT_SPECIES = SPECIES_ORDER.filter((s) => s !== "Empty");
const DEFAULT_SPECIES = ["Buck"];

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// The VAPID public key arrives as base64url; subscribe() wants the raw bytes.
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function loadChosen() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS.alertSpecies) || "null");
    if (Array.isArray(saved)) return saved.filter((s) => ALERT_SPECIES.includes(s));
  } catch (e) {}
  return DEFAULT_SPECIES;
}

export function AlertsDialog({ auth, onClose, onSignIn, onSignedOut, showToast }) {
  const [chosen, setChosen] = useState(loadChosen);
  const [server, setServer] = useState(null); // { enabled, publicKey }
  const [sub, setSub] = useState(undefined); // undefined = checking, null = off
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(() => ("Notification" in window ? Notification.permission : "default"));
  const supported = pushSupported();

  useEffect(() => {
    loadPushKey().then(setServer);
    if (!supported) { setSub(null); return; }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => setSub(s || null), () => setSub(null));
  }, []);
  useEffect(() => { try { localStorage.setItem(LS.alertSpecies, JSON.stringify(chosen)); } catch (e) {} }, [chosen]);

  const toggle = (sp) => setChosen((cur) => (cur.includes(sp) ? cur.filter((x) => x !== sp) : [...cur, sp]));
  const failed = (e) => {
    if (e instanceof NotSignedIn) { onSignedOut(); return; }
    showToast("err", "That didn't work. Try again in a moment.");
  };

  // requestPermission runs first, straight from the tap: iPhones only ask then.
  const turnOn = async () => {
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      const reg = await navigator.serviceWorker.ready;
      const s = (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(server.publicKey) }));
      await savePushSubscription(auth, s.toJSON(), chosen);
      setSub(s);
      showToast("ok", "Alerts are on for this phone");
    } catch (e) { failed(e); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      await savePushSubscription(auth, sub.toJSON(), chosen);
      showToast("ok", chosen.length ? "Alert choices saved" : "No species chosen: alerts paused");
    } catch (e) { failed(e); } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      await removePushSubscription(auth, sub.toJSON()).catch(() => {});
      await sub.unsubscribe();
      setSub(null);
      showToast("ok", "Alerts are off for this phone");
    } catch (e) { failed(e); } finally { setBusy(false); }
  };

  let body;
  if (!supported && isIOS() && !isStandalone()) {
    body = html`<div className="alerts__note">
      <${Icon} name="info" size=${18} />
      <p>On iPhone, alerts work from the Home Screen app. In Safari tap <b>Share</b>, then
        <b> Add to Home Screen</b>, then open Vale Trails from your Home Screen and come back here.</p>
    </div>`;
  } else if (!supported) {
    body = html`<p className="form-note">This browser can't receive alerts. On iPhone, use the Home Screen app (iOS 16.4 or newer).</p>`;
  } else if (!auth) {
    body = html`<div className="col" style=${{ gap: 12 }}>
      <p className="form-note">Sign in to turn on alerts for this phone.</p>
      <${Btn} variant="primary" icon="user" onClick=${onSignIn}>Sign in</${Btn}>
    </div>`;
  } else if (server && !server.enabled) {
    body = html`<p className="form-note">${server.offline ? "Can't reach the server. Try again when you have signal."
      : "Alerts aren't set up on the server yet. The site owner needs to finish the push setup in the README."}</p>`;
  } else if (permission === "denied") {
    body = html`<div className="alerts__note">
      <${Icon} name="info" size=${18} />
      <p>Notifications are turned off for Vale Trails. Turn them on in your phone's
        <b> Settings → Notifications → Vale Trails</b>, then come back here.</p>
    </div>`;
  } else {
    const on = !!sub;
    body = html`<div className="col" style=${{ gap: 14 }}>
      <p className="form-note">${on
        ? "This phone gets an alert when a new photo shows one of these:"
        : "Pick what you want to hear about. You'll get an alert when a new photo shows one, even with the app closed."}</p>
      <div className="alerts__grid" role="group" aria-label="Species">
        ${ALERT_SPECIES.map((sp) => html`<button key=${sp} type="button" role="checkbox" aria-checked=${chosen.includes(sp)}
          className=${cx("alerts__opt", chosen.includes(sp) && "is-on")} onClick=${() => toggle(sp)}>
          <span className="sdot" style=${{ background: speciesColor(sp) }} />${sp}
          <span className="alerts__check">${chosen.includes(sp) && html`<${Icon} name="check" size=${14} />`}</span>
        </button>`)}
      </div>
      ${on
        ? html`<div className="row" style=${{ gap: 8 }}>
            <${Btn} variant="primary" disabled=${busy} onClick=${save}>${busy ? "Saving…" : "Save"}</${Btn}>
            <div className="spacer" />
            <${Btn} variant="ghost" disabled=${busy} onClick=${turnOff}>Turn off alerts</${Btn}>
          </div>`
        : html`<${Btn} variant="primary" icon="bell" disabled=${busy || !chosen.length || sub === undefined || !server}
            onClick=${turnOn}>${busy ? "Turning on…" : "Turn on alerts"}</${Btn}>`}
      <p className="form-note faint">Alerts are per phone. Photos from the last two days count, and a burst of shots is one alert.</p>
    </div>`;
  }

  return html`<div className="modal" onClick=${onClose}>
    <div className="modal__box" role="dialog" aria-modal="true" aria-label="Alerts" onClick=${(e) => e.stopPropagation()}>
      <div className="modal__head">
        <h2 className="h-sec"><${Icon} name="bell" size=${17} /> Alerts</h2>
        <${IconBtn} icon="x" bare onClick=${onClose} aria-label="Close" />
      </div>
      ${body}
    </div>
  </div>`;
}
