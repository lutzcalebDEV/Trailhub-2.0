// Vale Trails — Home: where to sit, how the cameras are doing, the newest deer,
// then a short summary of activity.
import { html } from "../react.js";
import { Stat, Panel, Sparkbars, Histogram, Shot, Empty, Btn, CameraCard, Segmented } from "../ui.js";
import { effectiveSpecies, fmtDate, labelHour, LS, usePersistent } from "../core.js";
import {
  dailyCounts, hourHistogram, daylightPct, periodDelta, peakHour, cameraStatus, collapseBursts, bestSit, withoutEmpty, animalActivity,
} from "../analytics.js";
import { AlertsNudge } from "../alerts.js";
import { windowLabel } from "./insights.js";

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

  const seen = animalActivity(captures, ov);
  const week = periodDelta(seen, 7);
  const daylight = daylightPct(seen);
  const peak = peakHour(seen);
  const daily = dailyCounts(seen, 14);
  const busiestDay = daily.reduce((a, b) => (b.value > a.value ? b : a), daily[0]);
  const animals = withoutEmpty(captures, ov);
  const deer = animals.filter((c) => DEER.has(effectiveSpecies(c, ov)));
  // With no deer on the cameras yet there's nothing to choose between.
  const deerOnly = latestOf !== "all" && deer.length > 0;
  const latestList = deerOnly ? deer : animals;
  const recent = collapseBursts(latestList, LATEST);
  const favorites = captures.filter((c) => c.favorite).slice(0, 6);
  const cams = cameraStatus(captures, data.cameras);
  const sit = bestSit(captures, ov);
  const showCamera = (camera) => { setFilter({ camera }); setView("gallery"); };
  // The charts here count animals only, so the photos a bar opens are animals only.
  const go = (patch) => { setFilter({ ...patch, gameOnly: true }); setView("gallery"); };

  return html`<div className="col" style=${{ gap: 24 }}>
    ${sit && html`<div className="bestsit">
      <span className="bestsit__k">Best bet</span>
      <b>${camName(sit.camera)}, ${windowLabel(sit)}</b>
      <span className="muted">${sit.count} of ${sit.total} recent ${sit.subject} sightings</span>
    </div>`}

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

    <div className="grid grid--stats">
      <${Stat} label="Past 7 days" value=${week.cur.toLocaleString()} delta=${week.delta}
        sub=${`vs ${week.prev} the week before`} />
      <${Stat} label="In daylight" value=${daylight + "%"} sub=${`${100 - daylight}% after dark`} />
      <${Stat} label="Busiest hour" value=${peak ? labelHour(peak.hour) : "—"}
        sub=${peak ? `${peak.count} photos` : "No data"} />
    </div>

    <div className="grid grid--2">
      <${Panel} title="Last 14 days">
        <${Sparkbars} data=${daily.map((d) => ({ value: d.value, label: d.label, key: d.key }))}
          onSelect=${(d) => go({ range: "custom", from: d.key, to: d.key })} />
        <div className="row" style=${{ justifyContent: "space-between", marginTop: 10 }}>
          <span className="faint" style=${{ fontSize: 12 }}>${daily[0].label}</span>
          <span className="muted" style=${{ fontSize: 12 }}>
            ${busiestDay.value ? `Busiest ${fmtDate(busiestDay.date)} · ${busiestDay.value}` : ""}
          </span>
          <span className="faint" style=${{ fontSize: 12 }}>Today</span>
        </div>
      </${Panel}>
      <${Panel} title="Time of day">
        <${Histogram} hours=${hourHistogram(seen)} onSelect=${(h) => go({ hour: h })} />
      </${Panel}>
    </div>
  </div>`;
}
