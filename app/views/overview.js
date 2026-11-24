// Vale Trails — Home: the next hunt, how the cameras are doing, the newest deer. The
// charts live on Patterns.
import { html } from "../react.js";
import { Panel, Shot, Empty, Btn, CameraCard, Segmented } from "../ui.js";
import { effectiveSpecies, LS, usePersistent } from "../core.js";
import { cameraStatus, collapseBursts, withoutEmpty } from "../analytics.js";
import { AlertsNudge } from "../alerts.js";
import { CastCard } from "./castcard.js";

// "Deer" on Home means any deer: bucks, does, and deer nobody has told apart yet.
const DEER = new Set(["Buck", "Doe", "Deer"]);
const LATEST = 6;

export function Overview(app) {
  const { captures, data, ov, reviewQ, openLightbox, setView, setFilter, camName, openAlerts } = app;
  // Squirrels and raccoons trip the cameras far more often than deer do, so the
  // newest photos would be mostly them. Home shows the newest deer unless asked for
  // everything (remembered on this device).
  const [latestOf, setLatestOf] = usePersistent(LS.homeLatest, "deer");

  if (!captures.length) {
    return html`<${Empty} icon="camera" title="No photos yet"
      message="Once your cameras start uploading, they'll show up here automatically." />`;
  }

  const animals = withoutEmpty(captures, ov);
  const deer = animals.filter((c) => DEER.has(effectiveSpecies(c, ov)));
  // With no deer on the cameras yet there's nothing to choose between.
  const deerOnly = latestOf !== "all" && deer.length > 0;
  const latestList = deerOnly ? deer : animals;
  const recent = collapseBursts(latestList, LATEST);
  const favorites = captures.filter((c) => c.favorite).slice(0, 6);
  const cams = cameraStatus(captures, data.cameras);
  const showCamera = (camera) => { setFilter({ camera }); setView("gallery"); };

  return html`<div className="col" style=${{ gap: 24 }}>
    <${CastCard} ...${app} />

    <div className="camcards">
      ${cams.map((row) => html`<${CameraCard} key=${row.camera} row=${row}
        name=${camName(row.camera)} onClick=${() => showCamera(row.camera)} />`)}
    </div>

    <${AlertsNudge} onOpen=${openAlerts} />

    <${Panel} title=${deerOnly ? "Latest deer" : "Latest photos"} className="panel--plain" pad=${false}
      actions=${deer.length > 0 && html`<${Segmented} value=${deerOnly ? "deer" : "all"} onChange=${setLatestOf}
        label="Which photos to show" options=${[{ value: "deer", label: "Deer" }, { value: "all", label: "All" }]} />`}>
      <div className="shots size-M">
        ${recent.map(({ capture: c, count }) => html`<${Shot} key=${c.id} capture=${c} burst=${count}
          species=${effectiveSpecies(c, ov)} cameraLabel=${camName(c.camera)}
          onClick=${() => openLightbox(latestList, latestList.indexOf(c))} />`)}
      </div>
      <div className="loadmore">
        <${Btn} iconRight="arrowRight" onClick=${() => setView("gallery")}>All photos</${Btn}>
      </div>
    </${Panel}>

    ${reviewQ.length > 0 && html`<div className="nudge">
      <span><b>${reviewQ.length.toLocaleString()}</b> photo${reviewQ.length === 1 ? "" : "s"} still need an ID</span>
      <${Btn} sm variant="primary" iconRight="arrowRight" onClick=${() => setView("review")}>Identify</${Btn}>
    </div>`}

    ${favorites.length ? html`<${Panel} title="Favorites" className="panel--plain" pad=${false}>
      <div className="shots size-M">
        ${favorites.map((c, i) => html`<${Shot} key=${c.id} capture=${c}
          species=${effectiveSpecies(c, ov)} cameraLabel=${camName(c.camera)}
          onClick=${() => openLightbox(favorites, i)} />`)}
      </div>
    </${Panel}>` : null}
  </div>`;
}
