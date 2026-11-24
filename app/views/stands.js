// Vale Trails — Stands: every stand, how the wind suits it now, and adding, changing or
// deleting them. The map itself is Live wind (livewind.js).
import { html, useState, useEffect } from "../react.js";
import { Btn, Panel } from "../ui.js";
import { Icon } from "../icons.js";
import { parseHours, windOver, standWind, siteOf } from "../deercast.js";
import { calmAir, scentText } from "../terrain.js";
import { allStands } from "./livewind.js";
import { WindNow } from "./windnow.js";

export function Stands(app) {
  const { data, loadStands, removeStand, auth, openWind, setView } = app;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState("");
  useEffect(() => { loadStands(); }, [loadStands]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5 * 60000); return () => clearInterval(id); }, []);
  const site = siteOf(data);
  const row = parseHours(data.forecast).get(Math.floor(now / 3600000) * 3600000);
  const wind = row ? windOver([row]) : null;
  const list = allStands(app).map((s) => ({ ...s, air: calmAir(data.terrain, s, wind, now, site, row && row.rain >= 0.1) }));
  const scent = list.some((s) => s.air) ? "Calm air can differ at each stand" : `${scentText(wind, null)}, the same at every stand`;
  const mine = (s) => !s.camera && auth && (auth.admin || String(s.by).toLowerCase() === String(auth.user).toLowerCase());
  const remove = async (s) => {
    if (!window.confirm(`Delete ${s.label} for everyone?`)) return;
    setBusy(s.id);
    await removeStand(s.id);
    setBusy("");
  };
  return html`<div className="col" style=${{ gap: 16 }}>
    <div className="castacts">
      <${Btn} variant="primary" icon="pin" disabled=${!site} onClick=${() => openWind({ start: "new" })}>Add a stand</${Btn}>
      <${Btn} icon="expand" disabled=${!site} onClick=${() => openWind()}>Live wind</${Btn}>
    </div>
    ${wind && html`<div className="windnow"><svg className="castarrow" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"
        style=${{ transform: `rotate(${wind.deg + 180}deg)` }}><path d="M12 3v18M6 9l6-6 6 6" /></svg>
      <span><b>Forecast this hour: ${wind.unsure ? "" : wind.dir + " "}${Math.round(wind.speed)} mph, gusts ${Math.round(wind.gust)}</b><small>${scent}</small></span></div>`}
    ${site && html`<${WindNow} site=${site} forecast=${data.forecast} now=${now} />`}
    <${Panel} title=${`${list.length} stand${list.length === 1 ? "" : "s"}`}>
      ${list.length === 0 ? html`<p className="faint">No stands yet. Add one to see where your scent goes.</p>` : html`<ul className="harvests">
        ${list.map((s) => {
          const r = s.camera ? standWind((data.stands || {})[s.camera], wind) : null;
          return html`<li key=${s.id} className="standrow">
            <button type="button" className="standrow__main" onClick=${() => openWind({ show: s.id })}>
              <span className=${"standrow__icon" + (s.camera ? " is-cam" : "")}><${Icon} name=${s.camera ? "camera" : "stand"} size=${19} /></span>
              <span className="harvest__body"><b>${s.label}</b><span>${s.camera ? (s.pinned ? "Camera stand" : "Camera stand, pin is approximate") : `Added by ${s.by || "someone"}`}</span>${s.air && html`<span>${s.air.text}${s.air.toward != null ? " (estimate)" : ""}</span>`}</span>
              ${r && html`<span className=${"windpill is-" + r.level}>${r.text}</span>`}
              <${Icon} name="chevronRight" size=${17} className="standrow__chev" />
            </button>
            ${s.camera ? html`<div className="standrow__acts"><${Btn} sm onClick=${() => setView("map")}>Move on the Map page</${Btn}></div>`
              : mine(s) && html`<div className="standrow__acts">
                <${Btn} sm icon="pencil" onClick=${() => openWind({ start: s.id })}>Rename or move</${Btn}>
                <${Btn} sm icon="trash" disabled=${busy === s.id} onClick=${() => remove(s)}>${busy === s.id ? "Deleting" : "Delete"}</${Btn}></div>`}
          </li>`;
        })}
      </ul>`}
    </${Panel}>
  </div>`;
}
