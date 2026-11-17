// Vale Trails — the sign-in screen. Nothing in the app shows without signing in:
// the photos, the map and the camera spots are all private (tag-worker.js,
// "Private storage"), so this is the whole app until then.
//
// Face ID comes first when the phone has it (Face ID needs a tap on iPhones, so
// it's the big button rather than a prompt that opens by itself). The username
// last used on this device is filled in, and iCloud Keychain offers the saved
// password; the app itself never stores a password.
import { html, useState } from "./react.js";
import { BrandMark } from "./icons.js";
import { SignIn } from "./upload.js";
import { lastUser } from "./core.js";

export function LoginScreen({ onDone, message }) {
  const [remembered] = useState(lastUser);
  return html`<main className="login">
    <div className="login__card">
      <div className="login__brand">
        <${BrandMark} size=${76} />
        <h1>Vale Trails</h1>
        <p>${remembered ? `Welcome back, ${remembered}.` : "The family's trail cameras."}</p>
      </div>
      <div className="login__panel">
        <${SignIn} onDone=${onDone} initialUser=${remembered} message=${message} />
      </div>
      <p className="login__foot">Photos and camera spots are private to signed-in members.</p>
    </div>
  </main>`;
}
