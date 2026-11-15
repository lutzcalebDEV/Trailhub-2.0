// Vale Trails — "Add to Home Screen" hint for people still using the site in a
// phone browser. The Home Screen app opens full screen and is what push alerts need.
// iPhones have no install button for websites, so it shows the two taps; Android
// Chrome offers its own install prompt, which the Install button opens.
import { html, useState, useEffect } from "./react.js";
import { Icon } from "./icons.js";

const DISMISS_KEY = "trailhub-install-dismissed";
const QUIET_DAYS = 30;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isPhone = () => window.matchMedia("(max-width: 900px)").matches;

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY)) || 0;
    return Date.now() - at < QUIET_DAYS * 86400000;
  } catch (e) { return false; }
}

export function InstallHint() {
  const [androidPrompt, setAndroidPrompt] = useState(null);
  const [hidden, setHidden] = useState(() => isStandalone() || dismissedRecently());

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setAndroidPrompt(e); };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const ios = isIOS();
  if (hidden || !isPhone() || (!ios && !androidPrompt)) return null;
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {}
    setHidden(true);
  };
  const install = async () => {
    androidPrompt.prompt();
    const choice = await androidPrompt.userChoice.catch(() => null);
    if (choice && choice.outcome === "accepted") setHidden(true);
    setAndroidPrompt(null);
  };

  return html`<div className="installhint" role="dialog" aria-label="Install Vale Trails">
    <img className="installhint__icon" src="icons/icon-192.png" alt="" />
    <div className="installhint__text">
      <b>Get the Vale Trails app</b>
      ${ios
        ? html`<span>Tap <span className="installhint__share" aria-label="Share"><${Icon} name="share" size=${14} /></span>
            then <b>Add to Home Screen</b> for full screen and alerts.</span>`
        : html`<span>Full screen, on your Home Screen, with alerts.</span>`}
    </div>
    ${!ios && html`<button type="button" className="btn btn--sm btn--primary" onClick=${install}>Install</button>`}
    <button type="button" className="installhint__close" onClick=${dismiss} aria-label="Not now">
      <${Icon} name="x" size=${16} />
    </button>
  </div>`;
}
