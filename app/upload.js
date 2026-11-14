// Vale Trails — sign in and add photos or videos from a phone or an SD card.
import { html, useState, useRef, useEffect } from "./react.js";
import { Btn, IconBtn, Select } from "./ui.js";
import { Icon } from "./icons.js";
import {
  hasUploads, uploadLogin, uploadPhoto, uploadThumb, newUploadId, displayCamera, TAG_OPTIONS,
  StorageFull, NotSignedIn, TooManyAttempts, MAX_VIDEO_BYTES, LS, usePersistent, toLocalInput,
} from "./core.js";
import { captureDate } from "./exif.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");
const MAX_EDGE = 1600;
const THUMB_EDGE = 400;
const OTHER_CAMERA = "Other camera";
const isVideo = (file) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

function drawJpeg(source, width, height, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality);
  });
}

// Re-encoding shrinks the file and also drops EXIF data, including any GPS position.
// Returns the photo for the site plus a small copy for the grids.
async function prepare(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("This file couldn't be read");
  });
  try {
    const full = await drawJpeg(bitmap, bitmap.width, bitmap.height, MAX_EDGE, 0.82);
    const thumb = await drawJpeg(bitmap, bitmap.width, bitmap.height, THUMB_EDGE, 0.78);
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}

// A still from early in the video for its tile. Best effort: null if the browser
// won't decode it here, and the tile then shows the video's own first frame.
function videoPoster(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(blob || null);
    };
    const timer = setTimeout(() => finish(null), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      try { video.currentTime = Math.min(0.5, (video.duration || 2) / 4); } catch (e) { finish(null); }
    };
    video.onseeked = () => {
      if (!video.videoWidth) return finish(null);
      drawJpeg(video, video.videoWidth, video.videoHeight, THUMB_EDGE, 0.78).then(finish, () => finish(null));
    };
    video.src = url;
  });
}

export function SignIn({ onDone, message }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState("idle");

  const submit = async (e) => {
    e.preventDefault();
    setState("checking");
    const result = await uploadLogin(user.trim(), password);
    if (result === "ok") onDone({ user: user.trim(), password });
    else setState(result);
  };

  return html`<form className="col" style=${{ gap: 12 }} onSubmit=${submit}>
    ${message && html`<p className="form-note">${message}</p>`}
    <label className="field-row"><span>Username</span>
      <input className="input" autoComplete="username" autoCapitalize="none" value=${user}
        onInput=${(e) => setUser(e.target.value)} required />
    </label>
    <label className="field-row"><span>Password</span>
      <input className="input" type="password" autoComplete="current-password" value=${password}
        onInput=${(e) => setPassword(e.target.value)} required />
    </label>
    ${state === "denied" && html`<p className="form-error" role="alert">That username or password isn't right.</p>`}
    ${state === "limited" && html`<p className="form-error" role="alert">Too many tries. Wait a minute, then try again.</p>`}
    ${state === "error" && html`<p className="form-error" role="alert">Couldn't reach the server. Try again.</p>`}
    <${Btn} variant="primary" disabled=${state === "checking"}>${state === "checking" ? "Checking…" : "Sign in"}</${Btn}>
  </form>`;
}

// Sign in on its own, from the top bar or a "sign in to save" prompt.
export function SignInDialog({ message, onDone, onClose }) {
  return html`<div className="modal" onClick=${onClose}>
    <div className="modal__box" role="dialog" aria-modal="true" aria-label="Sign in" onClick=${(e) => e.stopPropagation()}>
      <div className="modal__head">
        <h2 className="h-sec">Sign in</h2>
        <${IconBtn} icon="x" bare onClick=${onClose} aria-label="Close" />
      </div>
      <${SignIn} onDone=${onDone} message=${message || "Tags, names, notes and uploads are saved for everyone once you're signed in."} />
    </div>
  </div>`;
}

function Picker({ auth, cameras, camName, buckNames, onUploaded, onSignedOut }) {
  const [items, setItems] = useState([]);
  const [camera, setCamera] = useState(cameras[0] ? cameras[0].name : OTHER_CAMERA);
  const [species, setSpecies] = useState("Animal");
  const [buck, setBuck] = useState("");
  const [comment, setComment] = useState("");
  const [author, setAuthor] = usePersistent(LS.commentName, "");
  const [sending, setSending] = useState(false);
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const urls = useRef(new Set());
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);

  const patch = (key, p) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  // Each file gets a row right away with its file time; the real capture time is
  // read from inside the file a moment later (EXIF for photos, header for videos).
  const addFiles = async (list) => {
    const files = [...list].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || /\.(jpe?g|png|heic|heif|mp4|mov|m4v|webm)$/i.test(f.name));
    const fresh = files.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return {
        key: newUploadId(), file, url, video: isVideo(file),
        date: toLocalInput(new Date(file.lastModified || Date.now())), source: "file",
        status: "ready", progress: 0, error: "",
      };
    });
    setItems((xs) => [...xs, ...fresh]);
    for (const it of fresh) {
      const found = await captureDate(it.file);
      patch(it.key, { date: toLocalInput(found.date), source: found.source });
    }
  };
  const removeItem = (key) => setItems((xs) => xs.filter((x) => x.key !== key));

  const send = async () => {
    setSending(true);
    let sent = 0;
    let failed = 0;
    for (const it of items) {
      if (it.status === "done") continue;
      patch(it.key, { status: "sending", progress: 0, error: "" });
      try {
        if (it.video && it.file.size > MAX_VIDEO_BYTES) throw new Error("over 80 MB");
        let blob;
        let thumb = null;
        if (it.video) {
          blob = it.file;
          thumb = await videoPoster(it.file);
        } else {
          ({ full: blob, thumb } = await prepare(it.file));
        }
        // The small copy goes first under the same id, so the upload can list it.
        let hasThumb = false;
        if (thumb) {
          try { await uploadThumb(thumb, it.key, auth); hasThumb = true; } catch (e) {
            if (e instanceof NotSignedIn || e instanceof TooManyAttempts || e instanceof StorageFull) throw e;
          }
        }
        const when = new Date(it.date);
        await uploadPhoto(blob, {
          id: it.key,
          date: (isNaN(when.getTime()) ? new Date() : when).toISOString(),
          camera, species: buck.trim() ? "Buck" : species,
          comment: comment.trim(), author: author.trim(), buck: buck.trim(), thumb: hasThumb,
        }, auth, (p) => patch(it.key, { progress: p }));
        patch(it.key, { status: "done", progress: 1 });
        sent++;
      } catch (e) {
        failed++;
        if (e instanceof StorageFull) { setFull(true); patch(it.key, { status: "failed", error: "Storage is full" }); break; }
        if (e instanceof NotSignedIn) { patch(it.key, { status: "failed", error: "Signed out" }); onSignedOut(); break; }
        if (e instanceof TooManyAttempts) { patch(it.key, { status: "failed", error: "Too many attempts. Wait a minute." }); break; }
        patch(it.key, { status: "failed", error: e.message });
      }
    }
    setSending(false);
    if (sent) {
      setComment("");
      onUploaded(sent, failed);
    }
  };

  const pending = items.filter((x) => x.status !== "done");
  const hasVideo = items.some((x) => x.video);
  const dateNote = (it) => (it.source === "exif" ? "Time from the photo" : it.source === "video" ? "Time from the video" : "Time from the file. Check it.");

  return html`<div className="col" style=${{ gap: 12 }}>
    <div className=${cx("dropzone", drag && "is-drag")} role="button" tabIndex=${0}
      onClick=${() => inputRef.current && inputRef.current.click()}
      onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && inputRef.current.click()}
      onDragOver=${(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave=${() => setDrag(false)}
      onDrop=${(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
      <${Icon} name="upload" size=${22} />
      <b>${items.length ? "Add more photos or videos" : "Choose photos or videos"}</b>
      <span className="faint" style=${{ fontSize: 12.5 }}>or drop them here</span>
      <input ref=${inputRef} type="file" accept="image/*,video/*" multiple hidden disabled=${sending}
        onChange=${(e) => { addFiles(e.target.files); e.target.value = ""; }} />
    </div>

    ${items.length > 0 && html`<div className="uplist">
      ${items.map((it) => html`<div key=${it.key} className=${cx("uprow", "is-" + it.status)}>
        <div className="uprow__thumb">
          ${it.video
            ? html`<video src=${it.url + "#t=0.1"} muted playsInline preload="metadata" />`
            : html`<img src=${it.url} alt="" onError=${(e) => { e.target.style.visibility = "hidden"; }} />`}
          ${it.video && html`<span className="shot__play"><${Icon} name="play" size=${14} /></span>`}
        </div>
        <div className="uprow__body">
          <div className="uprow__name" title=${it.file.name}>${it.file.name}<span className="faint"> · ${fmtSize(it.file.size)}</span></div>
          <label className="uprow__date">
            <input className="input" type="datetime-local" value=${it.date} aria-label="Taken"
              disabled=${sending || it.status === "done"} onInput=${(e) => patch(it.key, { date: e.target.value })} />
            <span className="faint">${dateNote(it)}</span>
          </label>
          ${it.status === "sending" && html`<div className="uprow__bar"><i style=${{ width: Math.round(it.progress * 100) + "%" }} /></div>`}
          ${it.status === "done" && html`<span className="uprow__state">Uploaded</span>`}
          ${it.status === "failed" && html`<span className="uprow__state">${it.error}</span>`}
        </div>
        <${IconBtn} icon="x" bare onClick=${() => removeItem(it.key)} disabled=${sending} aria-label="Remove" />
      </div>`)}
    </div>`}

    <div className="field-row"><span>Camera</span>
      <${Select} value=${camera} onChange=${setCamera} aria-label="Camera" options=${[
        ...cameras.map((c) => ({ value: c.name, label: camName(c.name) })),
        { value: OTHER_CAMERA, label: "Phone or other camera" },
      ]} />
    </div>
    <div className="grid grid--2" style=${{ gap: 12 }}>
      <div className="field-row"><span>Animal</span>
        <${Select} value=${buck.trim() ? "Buck" : species} onChange=${setSpecies} aria-label="Animal" disabled=${!!buck.trim()}
          options=${TAG_OPTIONS.map((s) => ({ value: s, label: s === "Animal" ? "Not sure" : s }))} />
      </div>
      <label className="field-row"><span>Buck name (optional)</span>
        <input className="input" list="upload-buck-names" maxLength=${40} value=${buck} placeholder="e.g. Big 8"
          onInput=${(e) => setBuck(e.target.value)} />
        <datalist id="upload-buck-names">
          ${(buckNames || []).map((n) => html`<option key=${n} value=${n} />`)}
        </datalist>
      </label>
    </div>
    <label className="field-row"><span>Comment (optional)</span>
      <textarea className="input" rows=${2} maxLength=${500} value=${comment}
        onInput=${(e) => setComment(e.target.value)} />
    </label>
    <label className="field-row"><span>Your name (optional)</span>
      <input className="input" maxLength=${40} value=${author} onInput=${(e) => setAuthor(e.target.value)} />
    </label>
    <p className="form-note">
      Photos from a trail camera count in Patterns and the camera's stats. "Phone or other camera" photos stay in Uploads.
      ${hasVideo && " Videos can be up to 80 MB and keep any location data your phone recorded. Everyone with the site link can see them."}
    </p>
    ${full && html`<p className="form-error" role="alert">Photo storage has reached its limit, so uploads are paused.</p>`}
    <${Btn} variant="primary" disabled=${!pending.length || sending} onClick=${send}>
      ${sending
        ? `Uploading ${items.filter((x) => x.status === "done").length + 1} of ${items.length}…`
        : pending.length ? `Upload ${pending.length} file${pending.length === 1 ? "" : "s"}` : "Upload"}
    </${Btn}>
  </div>`;
}

// Signed in for as long as the page stays open; the password is never stored.
export function UploadDialog({ cameras, camNames, buckNames, auth, setAuth, onClose, onUploaded }) {
  const camName = (raw) => displayCamera(raw, camNames);
  return html`<div className="modal" onClick=${onClose}>
    <div className="modal__box modal__box--wide" role="dialog" aria-modal="true" aria-label="Upload" onClick=${(e) => e.stopPropagation()}>
      <div className="modal__head">
        <h2 className="h-sec">Upload</h2>
        <${IconBtn} icon="x" bare onClick=${onClose} aria-label="Close" />
      </div>
      ${!hasUploads
        ? html`<p className="muted">Uploads turn on once the site's Worker is connected.</p>`
        : auth
          ? html`<${Picker} auth=${auth} cameras=${cameras} camName=${camName} buckNames=${buckNames}
              onUploaded=${onUploaded} onSignedOut=${() => setAuth(null)} />`
          : html`<${SignIn} onDone=${setAuth} message="Sign in with the family login to upload." />`}
    </div>
  </div>`;
}
