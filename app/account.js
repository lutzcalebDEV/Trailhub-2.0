// Vale Trails — the account menu in the top bar and the admin's account approvals.
import { html, useState, useEffect, useRef, useCallback } from "./react.js";
import { Icon } from "./icons.js";
import { Btn, IconBtn } from "./ui.js";
import { loadAccounts, accountAction, timeAgo, NotSignedIn } from "./core.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");

/* ------------------------------ Account menu ----------------------------- */
// Signed out it's a plain "Sign in" button. Signed in it opens a small menu, so a
// stray tap on your name never signs you out.
export function UserMenu({ auth, pending = 0, onSignIn, onSignOut, onAccounts, onAlerts, compact }) {
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
      <button role="menuitem" className="usermenu__item" onClick=${pick(onSignOut)}>
        <${Icon} name="logout" size=${16} /><span>Sign out</span>
      </button>
    </div>`}
  </div>`;
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
export function AccountsDialog({ auth, onClose, onChanged, onSignedOut, showToast }) {
  const [state, setState] = useState({ loading: true, accounts: [], enabled: true, error: "" });
  const [busy, setBusy] = useState("");

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

  const act = async (name, action, done) => {
    if (action === "remove" && !window.confirm(`Remove ${name}? They won't be able to sign in any more.`)) return;
    setBusy(name);
    try {
      const r = await accountAction(auth, name, action);
      setState((s) => ({ ...s, accounts: r.accounts || s.accounts }));
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

  return html`<div className="modal" onClick=${onClose}>
    <div className="modal__box modal__box--wide" role="dialog" aria-modal="true" aria-label="Accounts" onClick=${(e) => e.stopPropagation()}>
      <div className="modal__head">
        <h2 className="h-sec">Accounts</h2>
        <${IconBtn} icon="x" bare onClick=${onClose} aria-label="Close" />
      </div>
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
              ${approved.filter((a) => a.name.toLowerCase() !== auth.user.toLowerCase()).map((a) => html`<div key=${a.name} className="acctrow">
                <div className="acctrow__body">
                  <b>${a.name}</b>
                  <small>${a.admin ? "Admin" : "Member"}${a.approvedBy ? ` · approved by ${a.approvedBy}` : ""}</small>
                </div>
                <${Btn} sm variant="ghost" disabled=${busy === a.name}
                  onClick=${() => act(a.name, a.admin ? "unadmin" : "admin", a.admin ? `${a.name} is a member now` : `${a.name} is an admin now`)}>
                  ${a.admin ? "Make member" : "Make admin"}
                </${Btn}>
                <${Btn} sm className="lb__danger" icon="trash" disabled=${busy === a.name} aria-label=${`Remove ${a.name}`}
                  onClick=${() => act(a.name, "remove", `Removed ${a.name}`)} />
              </div>`)}
            </section>
            <p className="form-note">Admins can approve sign-ups and manage accounts. The shared login is always an admin.</p>
          </div>`}
    </div>
  </div>`;
}
