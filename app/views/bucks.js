// Vale Trails — Bucks: one profile per named deer, built from the photos you name.
import { html, useState, useMemo, useEffect } from "../react.js";
import { Stat, Panel, Bars, Histogram, Shot, Empty, Btn, Media, Segmented } from "../ui.js";
import { effectiveSpecies, effectiveTags, fmtDate, fmtTime, timeAgo } from "../core.js";
import { buckProfiles, collapseBursts } from "../analytics.js";
import { windowLabel } from "./insights.js";
import { groupByDay } from "./gallery.js";

const sightings = (n) => `${n} sighting${n === 1 ? "" : "s"}`;

function BuckCard({ buck, onOpen }) {
  return html`<button className="buckcard" onClick=${onOpen}>
    <${Media} capture=${buck.latest} alt=${buck.name} />
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

const PAGE = 60;

// Every photo tagged Buck, named or not, one tile per trigger and grouped by day.
function BuckPhotos({ app, photos }) {
  const { ov, openLightbox, camName } = app;
  const [which, setWhich] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const unnamed = useMemo(() => photos.filter((c) => !c.buck), [photos]);
  const list = which === "unnamed" ? unnamed : photos;
  const items = useMemo(() => collapseBursts(list), [list]);
  const groups = useMemo(() => groupByDay(items.slice(0, shown)), [items, shown]);
  useEffect(() => setShown(PAGE), [which]);

  return html`<section className="col" style=${{ gap: 6 }}>
    <div className="row wrap" style=${{ gap: 10, marginBottom: 6 }}>
      <h2 className="h-sec">Buck photos</h2>
      <span className="faint tnum">${list.length.toLocaleString()}</span>
      <div className="spacer" />
      <${Segmented} value=${which} onChange=${setWhich} options=${[
        { value: "all", label: "All" },
        { value: "unnamed", label: `Not named (${unnamed.length})` },
      ]} />
    </div>
    ${unnamed.length > 0 && html`<p className="faint" style=${{ margin: "0 0 8px", fontSize: 13 }}>
      Open a photo and fill in <b>Buck name</b> to start that buck's history. Use the same name on later photos.
    </p>`}
    ${list.length === 0
      ? html`<p className="faint">Every buck photo has a name.</p>`
      : groups.map((g) => html`<section key=${g.key} className="dayblock">
          <h3 className="dayblock__head">${g.label}</h3>
          <div className="shots size-M">
            ${g.items.map(({ capture: c, count }) => html`<${Shot} key=${c.id} capture=${c} burst=${count}
              species=${effectiveSpecies(c, ov)} cameraLabel=${camName(c.camera)} timeLabel=${fmtTime(c.date)}
              onClick=${() => openLightbox(list, list.indexOf(c))} />`)}
          </div>
        </section>`)}
    ${shown < items.length && html`<div className="loadmore">
      <${Btn} onClick=${() => setShown((n) => n + PAGE)}>Show more</${Btn}>
    </div>`}
  </section>`;
}

export function Bucks(app) {
  const { allCaptures, ov } = app;
  const [open, setOpen] = useState(null);
  // Phone uploads count too: a buck photo is a buck photo wherever it came from.
  const bucks = useMemo(() => buckProfiles(allCaptures), [allCaptures]);
  const photos = useMemo(
    () => allCaptures.filter((c) => c.buck || effectiveTags(c, ov).includes("Buck")),
    [allCaptures, ov]
  );
  const current = bucks.find((b) => b.name === open);

  if (current) return html`<${BuckDetail} buck=${current} app=${app} onBack=${() => setOpen(null)} />`;

  if (!photos.length) {
    return html`<${Empty} icon="target" title="No buck photos yet"
      message="Photos tagged Buck show up here. Name a buck on its photo to build its history." />`;
  }

  return html`<div className="col" style=${{ gap: 26 }}>
    ${bucks.length > 0 && html`<section className="col" style=${{ gap: 12 }}>
      <h2 className="h-sec">Named bucks</h2>
      <div className="buckgrid">
        ${bucks.map((b) => html`<${BuckCard} key=${b.name} buck=${b} onOpen=${() => setOpen(b.name)} />`)}
      </div>
    </section>`}
    <${BuckPhotos} app=${app} photos=${photos} />
  </div>`;
}
