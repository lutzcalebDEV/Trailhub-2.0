// Vale Trails — the account menu in the top bar and the admin's account approvals.
import { html, useState, useEffect, useRef, useCallback } from "./react.js";
import { Icon } from "./icons.js";
import { confirmSheet } from "./ask.js";
import { Btn, IconBtn, Dialog } from "./ui.js";
import { loadAccounts, accountAction, timeAgo, NotSignedIn, faceIdName, loadPasswordInfo, changePassword, passwordProblem } from "./core.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");

/* ------------------------------ Account menu ----------------------------- */
// Signed out it's a plain "Sign in" button. Signed in it opens a small menu, so a
// stray tap on your name never signs you out.
export function UserMenu({ auth, pending = 0, onSignIn, onSignOut, onAccounts, onAlerts, onFaceId, onPassword, compact }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!auth) {
    return compact
      ? html`<${IconBtn} icon="user" bare onClick=${onSignIn} aria-label="Sign in" />`
      : html`<button className="btn btn--sm btn--ghost authbtn" onClick=${onSignIn} title="Sign in to save tags, names and notes for everyone">
          <${Icon} name="user" size=${15} /><span>Sign in</span>
        </button>`;
  }

  const pick = (fn) => () => { setOpen(false); fn(); };
  const badge = auth.admin && pending > 0 && html`<span className="usermenu__dot" aria-label=${`${pending} waiting`}>${pending}</span>`;
  return html`<div className="usermenu" ref=${wrap}>
    ${compact
      ? html`<button className="iconbtn iconbtn--bare is-on usermenu__trigger" onClick=${() => setOpen((o) => !o)}
          aria-haspopup="menu" aria-expanded=${open} aria-label=${`Account: ${auth.user}`}>
          <${Icon} name="user" size=${18} />${badge}
        </button>`
      : html`<button className="btn btn--sm btn--ghost authbtn is-on usermenu__trigger" onClick=${() => setOpen((o) => !o)}
          aria-haspopup="menu" aria-expanded=${open}>
          <${Icon} name="user" size=${15} /><span>${auth.user}</span>${badge}
          <${Icon} name="chevronDown" size=${14} className="usermenu__chev" />
        </button>`}
    ${open && html`<div className="usermenu__pop" role="menu">
      <div className="usermenu__head">
        <span className="usermenu__label">Signed in as</span>
        <b>${auth.user}</b>
        ${auth.admin && html`<span className="usermenu__role">Admin</span>`}
      </div>
      ${auth.admin && auth.token && html`<button role="menuitem" className="usermenu__item" onClick=${pick(onAccounts)}>
        <${Icon} name="users" size=${16} /><span>Manage accounts</span>
        ${pending > 0 && html`<span className="nav__badge">${pending}</span>`}
      </button>`}
      ${onAlerts && html`<button role="menuitem" className="usermenu__item" onClick=${pick(onAlerts)}>
        <${Icon} name="bell" size=${16} /><span>Alerts</span>
      </button>`}
      ${onFaceId && auth.token && html`<button role="menuitem" className="usermenu__item" onClick=${pick(onFaceId)}>
        <${Icon} name="faceid" size=${16} /><span>${faceIdName()}</span>
      </button>`}
      ${onPassword && auth.token && html`<button role="menuitem" className="usermenu__item" onClick=${pick(onPassword)}>
        <${Icon} name="key" size=${16} /><span>Change password</span>
      </button>`}
      <button role="menuitem" className="usermenu__item" onClick=${pick(onSignOut)}>
        <${Icon} name="logout" size=${16} /><span>Sign out</span>
      </button>
    </div>`}
  </div>`;
}

/* ---------------------------- Change password ---------------------------- */
// From the name menu (or the More tab on a phone). The boxes aren't tied to state
// and the form checks itself, so iOS's password autofill works and every problem
// gets a visible message (see SignIn in upload.js). On success the other devices
// signed in to this account are signed out; this one gets a fresh session.
export function PasswordDialog({ auth, onClose, onChanged, onSignedOut, showToast }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadPasswordInfo(auth)
      .then((i) => { if (alive) setInfo(i); })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof NotSignedIn) onSignedOut();
        else setInfo({ hasPassword: true, failed: true });
      });
    return () => { alive = false; };
  }, [auth]);
  useEffect(() => {
    if (error && errRef.current && errRef.current.scrollIntoView) errRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);

  const needsCurrent = !info || info.hasPassword;
  const submit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const current = String(form.get("current") || "");
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    setError("");
    if (needsCurrent && !current) { setError("Enter your current password."); return; }
    const weak = passwordProblem(password, "new password");
    if (weak) { setError(weak); return; }
    if (password !== confirm) { setError("The new passwords don't match."); return; }
    if (needsCurrent && password === current) { setError("That's the same as your current password."); return; }
    setBusy(true);
    const r = await changePassword(auth, current, password);
    setBusy(false);
    if (r.status === "ok") {
      onChanged(r.auth);
      showToast("ok", needsCurrent ? "Password changed. Other devices are signed out." : "Password set");
      onClose();
      return;
    }
    if (r.status === "signedout") { onSignedOut(); return; }
    setError(r.status === "wrong" ? "Your current password isn't right."
      : r.status === "limited" ? "Too many tries. Wait a minute, then try again."
      : r.status === "error" && !r.error ? "Couldn't reach the server. Try again."
      : r.error || "That didn't work. Try again.");
  };

  const title = info && !info.hasPassword ? "Set a password" : "Change password";
  return html`<${Dialog} title=${title} icon="key" onClose=${onClose}>
      ${!info ? html`<p className="form-note">Loading…</p>`
        : info.shared ? html`<div className="col" style=${{ gap: 12 }}>
            <p className="form-note"><b>${auth.user}</b> is the shared family login. Its password is
              <code>UPLOAD_PASSWORD</code> in the Worker's settings, so it's changed there, not here.
              Changing it signs everyone using the shared login out.</p>
            <${Btn} onClick=${onClose}>OK</${Btn}>
          </div>`
        : html`<form className="col" style=${{ gap: 12 }} onSubmit=${submit} noValidate>
            <p className="form-note">${info.hasPassword
              ? html`For <b>${auth.user}</b>. Other devices signed in to this account will need the new password.`
              : html`<b>${auth.user}</b> signs in with ${faceIdName()} only. Add a password to sign in on other devices too.`}</p>
            <input type="text" name="username" autoComplete="username" value=${auth.user} readOnly hidden />
            ${info.hasPassword && html`<label className="field-row"><span>Current password</span>
              <input className="input" type="password" name="current" autoComplete="current-password" />
            </label>`}
            <label className="field-row"><span>New password</span>
              <input className="input" type="password" name="password" autoComplete="new-password" />
              <small className="form-note faint">At least 8 characters. Spaces, symbols and emoji are fine.</small>
            </label>
            <label className="field-row"><span>Confirm new password</span>
              <input className="input" type="password" name="confirm" autoComplete="new-password" />
            </label>
            ${error && html`<p className="form-error" role="alert" ref=${errRef}>${error}</p>`}
            <${Btn} variant="primary" disabled=${busy}>${busy ? "Saving…" : info.hasPassword ? "Change password" : "Set password"}</${Btn}>
          </form>`}
  </${Dialog}>`;
}

/* -------------------------- Pending-account count ------------------------ */
// Admins see how many sign-ups are waiting. Re-checked whenever `tick` changes
// (the app passes its data refresh), so it stays current without its own timer.
export function usePendingAccounts(auth, tick) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!auth || !auth.admin || !auth.token) { setCount(0); return; }
    try {
      const r = await loadAccounts(auth);
      setCount((r.accounts || []).filter((a) => a.status === "pending").length);
    } catch (e) { /* leave the last count */ }
  }, [auth]);
  useEffect(() => { refresh(); }, [refresh, tick]);
  return [count, refresh];
}

/* ---------------------------- Accounts dialog ---------------------------- */
export function AccountsDialog({ auth, uploads = [], onClose, onChanged, onUploadsRemoved, onSignedOut, showToast }) {
  const [state, setState] = useState({ loading: true, accounts: [], enabled: true, error: "" });
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState("");
  // How many photos and videos each person has added, by lowercased name.
  const added = {};
  for (const u of uploads) {
    if (u.uploadedBy) added[u.uploadedBy.toLowerCase()] = (added[u.uploadedBy.toLowerCase()] || 0) + 1;
  }
  const addedBy = (name) => added[name.toLowerCase()] || 0;
  const plural = (n) => `${n} upload${n === 1 ? "" : "s"}`;

  useEffect(() => {
    let alive = true;
    loadAccounts(auth)
      .then((r) => alive && setState({ loading: false, accounts: r.accounts || [], enabled: r.enabled !== false, error: "" }))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof NotSignedIn) { onSignedOut(); return; }
        setState({ loading: false, accounts: [], enabled: true, error: "Couldn't load accounts. Try again in a moment." });
      });
    return () => { alive = false; };
  }, [auth]);

  const act = async (name, action, done, extra) => {
    if (action === "remove" && !extra && !(await confirmSheet({ title: `Remove ${name}?`, message: "They won't be able to sign in any more.", action: "Remove" }))) return;
    setBusy(name);
    try {
      const r = await accountAction(auth, name, action, extra);
      setState((s) => ({ ...s, accounts: r.accounts || s.accounts }));
      setConfirming("");
      if (r.removedUploads && r.removedUploads.length && onUploadsRemoved) onUploadsRemoved(r.removedUploads);
      showToast("ok", done);
      onChanged();
    } catch (e) {
      if (e instanceof NotSignedIn) onSignedOut();
      else showToast("err", "That didn't save. Try again.");
    } finally { setBusy(""); }
  };

  const pending = state.accounts.filter((a) => a.status === "pending");
  const approved = state.accounts.filter((a) => a.status !== "pending");
  const when = (iso) => (iso ? timeAgo(new Date(iso)) : "");

  return html`<${Dialog} title="Accounts" wide onClose=${onClose}>
      ${state.loading ? html`<p className="form-note">Loading…</p>`
        : state.error ? html`<p className="form-error">${state.error}</p>`
        : !state.enabled ? html`<p className="form-note">Personal accounts aren't turned on. Add the ACCOUNTS
            KV namespace to the Worker (see wrangler.toml) and redeploy. Until then everyone uses the shared login.</p>`
        : html`<div className="col" style=${{ gap: 18 }}>
            <section className="col" style=${{ gap: 8 }}>
              <div className="eyebrow">Waiting for approval${pending.length ? ` · ${pending.length}` : ""}</div>
              ${pending.length === 0
                ? html`<p className="form-note">Nobody is waiting. New sign-ups show up here.</p>`
                : pending.map((a) => html`<div key=${a.name} className="acctrow is-pending">
                    <div className="acctrow__body"><b>${a.name}</b><small>Asked ${when(a.created)}</small></div>
                    <${Btn} sm variant="primary" icon="check" disabled=${busy === a.name}
                      onClick=${() => act(a.name, "approve", `Approved ${a.name}`)}>Approve</${Btn}>
                    <${Btn} sm variant="ghost" disabled=${busy === a.name}
                      onClick=${() => act(a.name, "remove", `Declined ${a.name}`)}>Decline</${Btn}>
                  </div>`)}
            </section>
            <section className="col" style=${{ gap: 8 }}>
              <div className="eyebrow">Members</div>
              <div className="acctrow">
                <div className="acctrow__body"><b>${auth.user}</b><small>You${auth.admin ? " · admin" : ""}</small></div>
              </div>
              ${approved.filter((a) => a.name.toLowerCase() !== auth.user.toLowerCase()).map((a) => {
                const n = addedBy(a.name);
                if (confirming === a.name) {
                  return html`<div key=${a.name} className="acctrow is-pending" style=${{ flexWrap: "wrap" }}>
                    <div className="acctrow__body">
                      <b>Remove ${a.name}?</b>
                      <small>They won't be able to sign in any more${n ? `. They've added ${plural(n)}.` : "."}</small>
                    </div>
                    <div className="row" style=${{ gap: 6, flexWrap: "wrap" }}>
                      ${n > 0 && html`<${Btn} sm className="lb__danger" icon="trash" disabled=${busy === a.name}
                        onClick=${() => act(a.name, "remove", `Removed ${a.name} and ${plural(n)}`, { uploads: true })}>
                        Remove and delete ${plural(n)}</${Btn}>`}
                      <${Btn} sm variant=${n ? "ghost" : undefined} className=${n ? "" : "lb__danger"} disabled=${busy === a.name}
                        onClick=${() => act(a.name, "remove", `Removed ${a.name}`, { uploads: false })}>
                        ${n ? "Remove, keep uploads" : "Remove"}</${Btn}>
                      <${Btn} sm variant="ghost" disabled=${busy === a.name} onClick=${() => setConfirming("")}>Cancel</${Btn}>
                    </div>
                  </div>`;
                }
                return html`<div key=${a.name} className="acctrow">
                  <div className="acctrow__body">
                    <b>${a.name}</b>
                    <small>${a.admin ? "Admin" : "Member"}${n ? ` · ${plural(n)}` : ""}${a.approvedBy ? ` · approved by ${a.approvedBy}` : ""}</small>
                  </div>
                  <${Btn} sm variant="ghost" disabled=${busy === a.name}
                    onClick=${() => act(a.name, a.admin ? "unadmin" : "admin", a.admin ? `${a.name} is a member now` : `${a.name} is an admin now`)}>
                    ${a.admin ? "Make member" : "Make admin"}
                  </${Btn}>
                  <${Btn} sm className="lb__danger" icon="trash" disabled=${busy === a.name} aria-label=${`Remove ${a.name}`}
                    onClick=${() => setConfirming(a.name)} />
                </div>`;
              })}
            </section>
            <p className="form-note">Admins can approve sign-ups and manage accounts. The shared login is always an admin.</p>
          </div>`}
  </${Dialog}>`;
}
