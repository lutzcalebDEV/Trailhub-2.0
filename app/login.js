// Vale Trails — the sign-in screen. Nothing in the app shows without signing in:
// the photos, the map and the camera spots are all private (tag-worker.js,
// "Private storage"), so this is the whole app until then.
//
// Face ID is the big button when the phone has it (iPhones only show Face ID from
// a tap, so it waits for one rather than opening by itself). On a device that has
// signed in with Face ID before, the password form folds away under "Use password
// instead"; otherwise it shows, and tapping the username box offers Face ID above
// the keyboard too. The username last used here is filled in, and iCloud Keychain
// offers the saved password; the app itself never stores a password.
import { html, useState } from "./react.js";
import { BrandMark } from "./icons.js";
import { SignIn } from "./upload.js";
import { lastUser } from "./core.js";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Out late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

// A ridge line at first light, drawn behind the sign-in card.
const Ridge = () => html`<svg className="login__ridge" viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true">
  <path className="login__ridge-far" d="M0 120 L40 96 L78 108 L120 74 L160 92 L206 60 L248 86 L290 70 L336 94 L372 80 L400 90 V160 H0 Z" />
  <path className="login__ridge-near" d="M0 140 L52 118 L96 130 L146 104 L192 124 L236 100 L284 122 L332 108 L400 128 V160 H0 Z" />
</svg>`;

export function LoginScreen({ onDone, message }) {
  const [remembered] = useState(lastUser);
  return html`<main className="login">
    <div className="login__sky" aria-hidden="true"><div className="login__sun"></div><${Ridge} /></div>
    <div className="login__card">
      <header className="login__brand">
        <${BrandMark} size=${72} />
        <h1>${remembered ? `${greeting()}, ${remembered}` : "Vale Trails"}</h1>
        <p>${remembered ? "Sign in to see what walked by." : "The family's trail cameras."}</p>
      </header>
      <section className="login__panel" aria-label="Sign in">
        <${SignIn} page onDone=${onDone} initialUser=${remembered} message=${message} />
      </section>
      <p className="login__foot">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        Private to family members. Photos and camera spots only load after you sign in.
      </p>
    </div>
  </main>`;
}
