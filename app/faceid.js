// Vale Trails — Face ID sign-in (passkeys): the hooks the sign-in box uses, and the
// "Face ID" screen from the name menu where a device turns it on.
import { html, useState, useEffect, useCallback } from "./react.js";
import { Btn, IconBtn, Dialog } from "./ui.js";
import { Icon } from "./icons.js";
import {
  passkeyAvailable, getPasskeyTicket, passkeyTicketFresh, passkeyCreate, loadPasskeys, removePasskey,
  faceIdName, setFaceIdOn, timeAgo, NotSignedIn,
} from "./core.js";

// Whether this device can sign in with Face ID (Touch ID, or a passkey elsewhere).
export function usePasskeySupport() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    passkeyAvailable().then((v) => { if (alive) setOk(v); });
    return () => { alive = false; };
  }, []);
  return ok;
}

// Keeps a fresh one-time challenge ready, so a tap goes straight to Face ID (iPhones
// only show it directly from a tap). Fetched again before it expires and after each
// use. For a sign-up it's tied to the username, so it's fetched as that's typed.
export function usePasskeyTicket(purpose, { enabled, auth, user } = {}) {
  const [ticket, setTicket] = useState(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (purpose === "signup" || !enabled) setTicket(null);
    if (!enabled) return undefined;
    let alive = true;
    let renewTimer;
    const start = setTimeout(async () => {
      let t;
      try { t = await getPasskeyTicket(purpose, { auth, user }); } catch (e) { t = { error: "signedout" }; }
      if (!alive) return;
      setTicket(t);
      if (t && t.expires) renewTimer = setTimeout(() => setRound((x) => x + 1), Math.max(5000, t.expires - Date.now()));
    }, purpose === "signup" ? 450 : 0);
    return () => { alive = false; clearTimeout(start); clearTimeout(renewTimer); };
  }, [enabled, purpose, auth, user, round]);
  const renew = useCallback(() => { setTicket(null); setRound((x) => x + 1); }, []);
  return [ticket, renew];
}

export function FaceIdDialog({ auth, onClose, onSignedOut, showToast }) {
  const name = faceIdName();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState("");
  const [ticket, renew] = usePasskeyTicket("add", { enabled: true, auth });
  const ready = passkeyTicketFresh(ticket);

  useEffect(() => {
    let alive = true;
    loadPasskeys(auth)
      .then((l) => { if (alive) setList(l); })
      .catch((e) => { if (!alive) return; if (e instanceof NotSignedIn) onSignedOut(); else setList([]); });
    return () => { alive = false; };
  }, [auth]);
  useEffect(() => { if (ticket && ticket.error === "signedout") onSignedOut(); }, [ticket]);

  // No await before passkeyCreate: Face ID has to start straight from the tap.
  const add = async () => {
    if (!ready) { renew(); return; }
    setBusy("add");
    const r = await passkeyCreate(ticket, "add", auth);
    setBusy("");
    renew();
    if (r.status === "ok") { setList(r.passkeys); showToast("ok", `${name} is on for ${auth.user}`); }
    else if (r.status === "exists") { setFaceIdOn(auth.user); showToast("ok", `This device already has ${name} for ${auth.user}`); }
    else if (r.status === "signedout") onSignedOut();
    else if (r.status === "limited") showToast("err", "Too many tries. Wait a minute, then try again.");
    else if (r.status !== "cancelled") showToast("err", r.error || "That didn't work. Try again.");
  };

  const remove = async (id) => {
    if (!window.confirm(`Remove this ${name} sign-in? That device will need the password again.`)) return;
    setBusy(id);
    try {
      setList(await removePasskey(auth, id));
      showToast("ok", `${name} sign-in removed`);
    } catch (e) {
      if (e instanceof NotSignedIn) onSignedOut();
      else showToast("err", "That didn't save. Try again.");
    } finally { setBusy(""); }
  };

  return html`<${Dialog} title=${name} icon="faceid" onClose=${onClose}>
      <div className="col" style=${{ gap: 14 }}>
        <p className="form-note">Sign in as <b>${auth.user}</b> with ${name} instead of typing the password.
          Your face never leaves the phone; Vale Trails only keeps a key that proves it's you.</p>
        <${Btn} variant="primary" icon="faceid" disabled=${!!busy || !ready} onClick=${add}>
          ${busy === "add" ? "Waiting for " + name + "…" : !ticket ? "Getting ready…" : ticket.error ? "Can't reach the server" : `Turn on ${name} on this device`}
        </${Btn}>
        ${ticket && ticket.error && ticket.error !== "signedout" && html`<button className="linkbtn" onClick=${renew}>Try again</button>`}
        <section className="col" style=${{ gap: 8 }}>
          <div className="eyebrow">Devices that can sign in as ${auth.user}</div>
          ${list === null ? html`<p className="form-note">Loading…</p>`
            : list.length === 0 ? html`<p className="form-note">None yet.</p>`
            : list.map((p) => html`<div key=${p.id} className="acctrow">
                <div className="acctrow__body"><b>${p.label || "Device"}</b><small>Added ${p.created ? timeAgo(new Date(p.created)) : ""}</small></div>
                <${Btn} sm className="lb__danger" icon="trash" disabled=${busy === p.id} aria-label="Remove" onClick=${() => remove(p.id)} />
              </div>`)}
        </section>
        <p className="form-note faint">${name} sign-ins sync to your other Apple devices through iCloud Keychain.
          Removing one here stops it working; you can also delete it from the phone in Settings → Passwords.</p>
      </div>
  </${Dialog}>`;
}
