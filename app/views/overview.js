// Vale Trails — Home: what's new first, then a short summary of activity.
import { html } from "../react.js";
import { Stat, Panel, Sparkbars, Histogram, Shot, Empty, Btn, CameraCard } from "../ui.js";
import { effectiveSpecies, fmtDate, labelHour } from "../core.js";
import {
  dailyCounts, hourHistogram, daylightPct, periodDelta, peakHour, cameraStatus, collapseBursts, bestSit,
} from "../analytics.js";
import { windowLabel } from "./insights.js";

export function Overview(app) {
  const { captures, data, ov, reviewQ, openLightbox, setView, setFilter, camName } = app;

  if (!captures.length) {
    return html`<${Empty} icon="camera" title="No photos yet"
      message="Once your cameras start uploading, they'll show up here automatically." />`;
  }

  const week = periodDelta(captures, 7);
  const daylight = daylightPct(captures);
  const peak = peakHour(captures);
  const daily = dailyCounts(captures, 14);
  const busiestDay = daily.reduce((a, b) => (b.value > a.value ? b : a), daily[0]);
  const recent = collapseBursts(captures, 12);
  const favorites = captures.filter((c) => c.favorite).slice(0, 6);
  const cams = cameraStatus(captures, data.cameras);
  const sit = bestSit(captures, ov);
  const showCamera = (camera) => { setFilter({ camera }); setView("gallery"); };
  const seeAll = (label) => html`<${Btn} sm variant="ghost" iconRight="arrowRight"
    onClick=${() => setView("gallery")}>${label}</${Btn}>`;

  return html`<div className="col" style=${{ gap: 24 }}>
    <div className="camcards">
      ${cams.map((row) => html`<${CameraCard} key=${row.camera} row=${row}
        name=${camName(row.camera)} onClick=${() => showCamera(row.camera)} />`)}
    </div>

    ${sit && html`<div className="bestsit">
      <span className="bestsit__k">Best bet</span>
      <b>${camName(sit.camera)}, ${windowLabel(sit)}</b>
      <span className="muted">${sit.count} of ${sit.total} recent ${sit.subject} sightings</span>
    </div>`}

    <${Panel} title="Latest photos" className="panel--plain" pad=${false} actions=${seeAll("All photos")}>
      <div className="shots size-M">
        ${recent.map(({ capture: c, count }) => html`<${Shot} key=${c.id} capture=${c} burst=${count}
          species=${effectiveSpecies(c, ov)} cameraLabel=${camName(c.camera)}
          onClick=${() => openLightbox(captures, captures.indexOf(c))} />`)}
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

    <div className="grid grid--stats">
      <${Stat} label="Past 7 days" value=${week.cur.toLocaleString()} delta=${week.delta}
        sub=${`vs ${week.prev} the week before`} />
      <${Stat} label="In daylight" value=${daylight + "%"} sub=${`${100 - daylight}% after dark`} />
      <${Stat} label="Busiest hour" value=${peak ? labelHour(peak.hour) : "—"}
        sub=${peak ? `${peak.count} photos` : "No data"} />
    </div>

    <div className="grid grid--2">
      <${Panel} title="Last 14 days">
        <${Sparkbars} data=${daily.map((d) => ({ value: d.value, label: d.label }))} />
        <div className="row" style=${{ justifyContent: "space-between", marginTop: 10 }}>
          <span className="faint" style=${{ fontSize: 12 }}>${daily[0].label}</span>
          <span className="muted" style=${{ fontSize: 12 }}>
            ${busiestDay.value ? `Busiest ${fmtDate(busiestDay.date)} · ${busiestDay.value}` : ""}
          </span>
          <span className="faint" style=${{ fontSize: 12 }}>Today</span>
        </div>
      </${Panel}>
      <${Panel} title="Time of day">
        <${Histogram} hours=${hourHistogram(captures)} />
      </${Panel}>
    </div>
  </div>`;
}
