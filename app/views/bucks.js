// Vale Trails — Bucks: one profile per named deer, built from the photos you name.
import { html, useState } from "../react.js";
import { Stat, Panel, Bars, Histogram, Shot, Empty, Btn } from "../ui.js";
import { effectiveSpecies, fmtDate, timeAgo } from "../core.js";
import { buckProfiles } from "../analytics.js";
import { windowLabel } from "./insights.js";

const sightings = (n) => `${n} sighting${n === 1 ? "" : "s"}`;

function BuckCard({ buck, onOpen }) {
  return html`<button className="buckcard" onClick=${onOpen}>
    <img src=${buck.latest.image} alt=${buck.name} loading="lazy" />
    <span className="buckcard__name">${buck.name}</span>
    <span className="buckcard__sub">${sightings(buck.events)} · last seen ${timeAgo(buck.last)}</span>
    ${buck.peak && html`<span className="buckcard__sub">Usually ${windowLabel(buck.peak)}</span>`}
  </button>`;
}

function BuckDetail({ buck, app, onBack }) {
  const { ov, openLightbox, camName } = app;
  return html`<div className="col" style=${{ gap: 20 }}>
    <div className="row">
      <${Btn} sm variant="ghost" icon="chevronLeft" onClick=${onBack}>All bucks</${Btn}>
    </div>
    <h2 className="h-page">${buck.name}</h2>

    <div className="grid grid--stats">
      <${Stat} label="Sightings" value=${buck.events} sub=${`${fmtDate(buck.first)} to ${fmtDate(buck.last)}`} />
      <${Stat} label="Usual time" value=${buck.peak ? windowLabel(buck.peak) : "—"} sub="Busiest 3-hour window" />
      <${Stat} label="In daylight" value=${buck.dayPct + "%"} sub=${`${100 - buck.dayPct}% after dark`} />
    </div>

    <div className="grid grid--2">
      <${Panel} title="Time of day"><${Histogram} hours=${buck.hours} /></${Panel}>
      <${Panel} title="Cameras">
        <${Bars} data=${buck.cameras.map((c) => ({ label: camName(c.camera), value: c.value }))} />
      </${Panel}>
    </div>

    <${Panel} title="Photos" className="panel--plain" pad=${false}>
      <div className="shots size-M">
        ${buck.shots.map((c, i) => html`<${Shot} key=${c.id} capture=${c} species=${effectiveSpecies(c, ov)}
          cameraLabel=${camName(c.camera)} onClick=${() => openLightbox(buck.shots, i)} />`)}
      </div>
    </${Panel}>
  </div>`;
}

export function Bucks(app) {
  const { captures, setFilter, setView } = app;
  const [open, setOpen] = useState(null);
  const bucks = buckProfiles(captures);
  const current = bucks.find((b) => b.name === open);

  if (current) return html`<${BuckDetail} buck=${current} app=${app} onBack=${() => setOpen(null)} />`;

  if (!bucks.length) {
    return html`<${Empty} icon="target" title="No named bucks yet"
      message="Open a photo and fill in Buck name. Use the same name on later photos to build its history."
      action=${html`<${Btn} sm variant="primary" onClick=${() => { setFilter({ bucksOnly: true }); setView("gallery"); }}>
        See buck photos
      </${Btn}>`} />`;
  }

  return html`<div className="buckgrid">
    ${bucks.map((b) => html`<${BuckCard} key=${b.name} buck=${b} onOpen=${() => setOpen(b.name)} />`)}
  </div>`;
}
