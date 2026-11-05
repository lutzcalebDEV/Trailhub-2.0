// Vale Trails — sign in and add photos from a phone or an SD card.
import { html, useState } from "./react.js";
import { Btn, IconBtn, Select } from "./ui.js";
import { hasUploads, uploadLogin, uploadPhoto, displayCamera, TAG_OPTIONS, StorageFull } from "./core.js";

const MAX_EDGE = 1600;
const OTHER_CAMERA = "Other camera";

// Re-encoding shrinks the file and also drops EXIF data, including any GPS position.
async function prepare(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.82);
  });
}

function SignIn({ onDone }) {
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
    <label className="field-row"><span>Username</span>
      <input className="input" autoComplete="username" autoCapitalize="none" value=${user}
        onInput=${(e) => setUser(e.target.value)} required />
    </label>
    <label className="field-row"><span>Password</span>
      <input className="input" type="password" autoComplete="current-password" value=${password}
        onInput=${(e) => setPassword(e.target.value)} required />
    </label>
    ${state === "denied" && html`<p className="form-error" role="alert">That username or password isn't right.</p>`}
    ${state === "error" && html`<p className="form-error" role="alert">Couldn't reach the server. Try again.</p>`}
    <${Btn} variant="primary" disabled=${state === "checking"}>${state === "checking" ? "Checking…" : "Sign in"}</${Btn}>
  </form>`;
}

function Picker({ auth, cameras, camName, onUploaded }) {
  const [files, setFiles] = useState([]);
  const [camera, setCamera] = useState(cameras[0] ? cameras[0].name : OTHER_CAMERA);
  const [species, setSpecies] = useState("Animal");
  const [progress, setProgress] = useState(null);
  const [failed, setFailed] = useState([]);
  const [full, setFull] = useState(false);

  const send = async () => {
    const bad = [];
    let sent = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress(i + 1);
      try {
        const blob = await prepare(files[i]);
        await uploadPhoto(blob, { camera, species, date: new Date(files[i].lastModified).toISOString() }, auth);
        sent++;
      } catch (e) {
        if (e instanceof StorageFull) { setFull(true); break; }
        bad.push(files[i].name);
      }
    }
    setProgress(null);
    setFailed(bad);
    setFiles([]);
    if (sent) onUploaded(sent, bad.length);
  };

  return html`<div className="col" style=${{ gap: 12 }}>
    <label className="field-row"><span>Photos</span>
      <input className="input" type="file" accept="image/*" multiple disabled=${progress != null}
        onChange=${(e) => setFiles([...e.target.files])} />
    </label>
    <div className="field-row"><span>Camera</span>
      <${Select} value=${camera} onChange=${setCamera} aria-label="Camera" options=${[
        ...cameras.map((c) => ({ value: c.name, label: camName(c.name) })),
        { value: OTHER_CAMERA, label: "Phone or other camera" },
      ]} />
    </div>
    <div className="field-row"><span>Animal</span>
      <${Select} value=${species} onChange=${setSpecies} aria-label="Animal"
        options=${TAG_OPTIONS.map((s) => ({ value: s, label: s === "Animal" ? "Not sure" : s }))} />
    </div>
    ${full && html`<p className="form-error" role="alert">
      Photo storage has reached its limit, so uploads are paused.
    </p>`}
    ${failed.length > 0 && html`<p className="form-error" role="alert">
      Couldn't upload: ${failed.join(", ")}
    </p>`}
    <${Btn} variant="primary" disabled=${!files.length || progress != null} onClick=${send}>
      ${progress != null
        ? `Uploading ${progress} of ${files.length}…`
        : files.length ? `Upload ${files.length} photo${files.length === 1 ? "" : "s"}` : "Upload"}
    </${Btn}>
  </div>`;
}

// Signed in for as long as the page stays open; the password is never stored.
export function UploadDialog({ cameras, camNames, auth, setAuth, onClose, onUploaded }) {
  const camName = (raw) => displayCamera(raw, camNames);
  return html`<div className="modal" onClick=${onClose}>
    <div className="modal__box" role="dialog" aria-modal="true" aria-label="Upload photos" onClick=${(e) => e.stopPropagation()}>
      <div className="modal__head">
        <h2 className="h-sec">Upload photos</h2>
        <${IconBtn} icon="x" bare onClick=${onClose} aria-label="Close" />
      </div>
      ${!hasUploads
        ? html`<p className="muted">Uploads turn on once the site's Worker is connected.</p>`
        : auth
          ? html`<${Picker} auth=${auth} cameras=${cameras} camName=${camName} onUploaded=${onUploaded} />`
          : html`<${SignIn} onDone=${setAuth} />`}
    </div>
  </div>`;
}
