// Vale Trails — comments on a photo or video, shown in the full view.
import { html, useState } from "./react.js";
import { Btn } from "./ui.js";
import { SignIn } from "./upload.js";
import { hasUploads, LS, usePersistent, timeAgo } from "./core.js";

export function Comments({ photo, list, auth, setAuth, onChange }) {
  const [text, setText] = useState("");
  const [author, setAuthor] = usePersistent(LS.commentName, "");
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const post = async () => {
    setSaving(true);
    const saved = await onChange({ photo, text: text.trim(), author: author.trim() });
    setSaving(false);
    if (saved) setText("");
  };

  return html`<div className="lb__comments">
    <div className="lb__comments-title">Comments${list.length ? ` (${list.length})` : ""}</div>
    ${list.length > 0 && html`<ul>
      ${list.map((c) => html`<li key=${c.id}>
        <div className="lb__comment-meta">
          <b>${c.author || "Vale crew"}</b>
          <span>${timeAgo(new Date(c.at))}</span>
          ${auth && html`<button className="lb__comment-remove"
            onClick=${() => onChange({ photo, remove: c.id })}>Remove</button>`}
        </div>
        <div className="lb__comment-text">${c.text}</div>
      </li>`)}
    </ul>`}

    ${!hasUploads ? null : auth
      ? html`<textarea rows=${2} maxLength=${500} placeholder="Add a comment" aria-label="Add a comment"
            value=${text} onInput=${(e) => setText(e.target.value)} />
          <input maxLength=${40} placeholder="Your name (optional)" aria-label="Your name"
            value=${author} onInput=${(e) => setAuthor(e.target.value)} />
          <${Btn} sm variant="primary" disabled=${!text.trim() || saving} onClick=${post}>
            ${saving ? "Saving…" : "Post"}
          </${Btn}>`
      : signingIn
        ? html`<${SignIn} onDone=${setAuth} />`
        : html`<${Btn} sm onClick=${() => setSigningIn(true)}>Sign in to comment</${Btn}>`}
  </div>`;
}
