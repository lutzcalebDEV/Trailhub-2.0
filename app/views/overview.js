// Vale Trails — Overview: the at-a-glance home dashboard (whole dataset).
import { html } from "../react.js";
import { Stat, Panel, Bars, Sparkbars, Histogram, Shot, Empty, Btn } from "../ui.js";
import { effectiveSpecies, fmtDate, labelHour } from "../core.js";
import {
  speciesCounts, cameraCounts, dailyCounts, hourHistogram,
  daylightPct, periodDelta, peakHour,
} from "../analytics.js";

export function Overview(app) {
  const { captures, ov, counts, reviewQ, openLightbox, setView } = app;

  if (!captures.length) {
    return html`<${Empty} icon="camera" title="No captures yet"
      message="Once your cameras start uploading, your dashboard will fill in automatically." />`;
  }

  const week = periodDelta(captures, 7);
  const daylight = daylightPct(captures);
  const peak = peakHour(captures);
  const daily = dailyCounts(captures, 14);
  const daily14 = daily.reduce((s, d) => s + d.value, 0);
  const busiestDay = daily.reduce((a, b) => (b.value > a.value ? b : a), daily[0]);
  const topSpecies = speciesCounts(captures, ov).slice(0, 6);
  const topCams = cameraCounts(captures).slice(0, 5);
  const recent = captures.slice(0, 10);

  return html`<div className="col" style=${{ gap: 18 }}>
    <div className="grid grid--stats">
      <${Stat} label="Total captures" value=${counts.total.toLocaleString()} icon="images" tone="acc"
        sub=${`${counts.cameras} camera${counts.cameras === 1 ? "" : "s"} reporting`} />
      <${Stat} label="Past 7 days" value=${week.cur.toLocaleString()} icon="bolt" delta=${week.delta}
        sub=${`vs ${week.prev} prior week`} />
      <${Stat} label="Daytime activity" value=${daylight + "%"} icon="sun" tone="day"
        sub=${`${100 - daylight}% after dark`} />
      <${Stat} label="Peak hour" value=${peak ? labelHour(peak.hour) : "—"} icon="clock"
        sub=${peak ? `${peak.count} captures in that hour` : "No data"} />
      <${Stat} label="Needs review" value=${reviewQ.length} icon="scan" tone=${reviewQ.length ? "warn" : ""}
        sub=${reviewQ.length ? "Tap Review to confirm" : "All caught up"} />
    </div>

    <div className="grid grid--2">
      <${Panel} title="14-day activity" icon="chart"
        actions=${html`<span className="faint" style=${{ fontSize: 12.5 }}>${daily14} captures</span>`}>
        <${Sparkbars} data=${daily.map((d) => ({ value: d.value, label: d.label }))} />
        <div className="row" style=${{ justifyContent: "space-between", marginTop: 10 }}>
          <span className="faint" style=${{ fontSize: 11.5 }}>${daily[0].label}</span>
          <span className="muted" style=${{ fontSize: 11.5 }}>
            Busiest ${busiestDay.value ? `${fmtDate(busiestDay.date)} · ${busiestDay.value}` : "—"}
          </span>
          <span className="faint" style=${{ fontSize: 11.5 }}>Today</span>
        </div>
      </${Panel}>

      <${Panel} title="Active times" icon="clock">
        <${Histogram} hours=${hourHistogram(captures)} />
      </${Panel}>
    </div>

    <div className="grid grid--2">
      <${Panel} title="Top species" icon="paw">
        ${topSpecies.length
          ? html`<${Bars} data=${topSpecies.map((s) => ({ label: s.species, value: s.value, color: s.color }))} />`
          : html`<p className="faint">No species tallied yet.</p>`}
      </${Panel}>
      <${Panel} title="Busiest cameras" icon="map">
        <${Bars} data=${topCams.map((c) => ({ label: c.camera, value: c.value }))} />
      </${Panel}>
    </div>

    <${Panel} title="Latest captures" icon="images"
      actions=${html`<${Btn} sm variant="ghost" iconRight="arrowRight" onClick=${() => setView("gallery")}>View all</${Btn}>`}>
      <div className="shots size-S">
        ${recent.map((c, i) => html`<${Shot} key=${c.id} capture=${c}
          species=${effectiveSpecies(c, ov)} onClick=${() => openLightbox(recent, i)} />`)}
      </div>
    </${Panel}>
  </div>`;
}
