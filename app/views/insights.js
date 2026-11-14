// Vale Trails — Insights: movement patterns, timing, species mix and calendar.
// Every bar and cell is a link: tapping it opens those photos in Photos with the
// matching filter applied.
import { html, Fragment } from "../react.js";
import { FilterBar } from "../shell.js";
import { Stat, Panel, Histogram, HourStrip, Bars, SplitBar, CalHeat, Empty } from "../ui.js";
import { Icon } from "../icons.js";
import { labelHour } from "../core.js";
import {
  filterCaptures, weatherRates, animalActivity, NOT_GAME, hourHistogram, dayNightSplit, daylightPct, peakHour,
  weekdayCounts, speciesByDayNight, speciesActivity, peakWindow,
  tempBuckets, moonCounts, cameraCounts, isoDayCounts,
} from "../analytics.js";

export const windowLabel = (p) => (p ? labelHour(p.start) + "–" + labelHour(p.end) : "—");

export function Insights(app) {
  const { captures, filters, setFilter, setView, spList, data, ov, camName } = app;
  // Choosing Person, Vehicle or Empty on purpose still charts them.
  const filtered = NOT_GAME.has(filters.species) ? app.filtered : animalActivity(app.filtered, ov);
  // Open Photos with an extra filter layered on the current ones.
  const go = (patch) => { setFilter(patch); setView("gallery"); };

  const filterBar = html`<${FilterBar} filters=${filters} set=${setFilter}
    cameras=${data.cameras} speciesList=${spList} count=${filtered.length} camName=${camName} />`;

  if (!filtered.length) {
    return html`<div className="col" style=${{ gap: 4 }}>
      ${filterBar}
      <${Empty} icon="chart" title="Nothing to chart yet"
        message="No captures match the current filters. Clear a filter to see movement patterns." />
    </div>`;
  }

  const split = dayNightSplit(filtered);
  const peak = peakHour(filtered);
  const wk = weekdayCounts(filtered);
  const busiestWk = wk.reduce((a, b) => (b.value > a.value ? b : a), wk[0]);
  const byDN = speciesByDayNight(filtered, ov, 6);
  const temps = tempBuckets(filtered);
  const moons = moonCounts(filtered);
  const cams = cameraCounts(filtered);

  // Per-species activity timing — the heart of "when is a species most active".
  // When one species is selected we still compare it against the others (ignoring
  // only the species filter) so its timing reads in context, with that row lit up.
  const sel = filters.species !== "All" ? filters.species : null;
  const activityBase = sel ? filterCaptures(captures, { ...filters, species: "All" }, ov) : filtered;
  const activity = speciesActivity(activityBase, ov, 6);
  const selPeak = sel ? peakWindow(hourHistogram(filtered)) : null;
  const dielLabel = (dp) => (dp >= 65 ? "mostly daytime" : dp <= 35 ? "mostly nocturnal" : "active day & night");

  // Choose the most informative secondary panel based on available data.
  let secondary;
  if (temps) {
    secondary = html`<${Panel} title="Temperature">
      <${Bars} data=${temps.buckets.map((b) => ({ label: `${b.lo}–${b.hi}°F`, value: b.value }))} />
    </${Panel}>`;
  } else if (moons) {
    secondary = html`<${Panel} title="Moon phase">
      <${Bars} data=${moons.map((m) => ({ label: m.moon, value: m.value }))} />
    </${Panel}>`;
  } else {
    secondary = html`<${Panel} title="Camera">
      <${Bars} data=${cams.slice(0, 7).map((c) => ({ label: camName(c.camera), value: c.value, camera: c.camera }))}
        onSelect=${(d) => go({ camera: d.camera })} />
    </${Panel}>`;
  }

  const weather = weatherRates(filtered, data.weatherHours);
  const tapHint = html`<span className="faint" style=${{ fontSize: 12 }}>Tap a bar to see those photos</span>`;

  return html`<div className="col" style=${{ gap: 18 }}>
    ${filterBar}

    <div className="grid grid--stats">
      <${Stat} label="In daylight" value=${daylightPct(filtered) + "%"}
        sub=${`${split.day} day · ${split.night} night`} />
      <${Stat} label="Busiest hour" value=${peak ? labelHour(peak.hour) : "—"}
        sub=${peak ? `${peak.count} photos` : ""} />
      <${Stat} label="Busiest day" value=${busiestWk.value ? busiestWk.label : "—"}
        sub=${busiestWk.value ? `${busiestWk.value} photos` : ""} />
    </div>

    ${sel && selPeak && html`<div className="besttime">
      <div className="besttime__ico"><${Icon} name="target" size=${22} /></div>
      <div>
        <div className="besttime__k">Best time to catch ${sel}</div>
        <div className="besttime__v">${windowLabel(selPeak)}</div>
        <div className="besttime__sub">${selPeak.pct}% of ${sel.toLowerCase()} sightings fall in this window · ${dielLabel(daylightPct(filtered))}</div>
      </div>
    </div>`}

    <${Panel} title="Time of day" actions=${tapHint}>
      <${Histogram} hours=${hourHistogram(filtered)} onSelect=${(h) => go({ hour: h })} />
    </${Panel}>

    <${Panel} title="Time of day by species"
      actions=${html`<span className="faint" style=${{ fontSize: 12 }}>Peak = busiest 3-hour window</span>`}>
      ${activity.length
        ? html`<${Fragment}>
            <div className="actclock">
              ${activity.map((r) => html`<div key=${r.species} className=${"actrow" + (r.species === sel ? " is-sel" : "")}>
                <div className="actrow__head">
                  <button className="actrow__name" title=${`Only ${r.species}`}
                    onClick=${() => setFilter({ species: r.species === sel ? "All" : r.species })}>
                    <span className="sdot" style=${{ background: r.color }} />${r.species}
                  </button>
                  ${r.peak && html`<span className="actrow__peak">Peak ${windowLabel(r.peak)} · ${dielLabel(r.dayPct)}</span>`}
                  <span className="actrow__total tnum">${r.total}</span>
                </div>
                <${HourStrip} hours=${r.hours} color=${r.color} peak=${r.peak}
                  onSelect=${(h) => go({ species: r.species, hour: h })} />
              </div>`)}
            </div>
            <div className="actclock__axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
          </${Fragment}>`
        : html`<p className="faint">Identify a few photos to see when each species moves.</p>`}
    </${Panel}>

    <div className="grid grid--2">
      <${Panel} title="Day or night">
        <div className="col" style=${{ gap: 13 }}>
          ${byDN.map((r) => html`<div key=${r.species}>
            <div className="row" style=${{ justifyContent: "space-between", marginBottom: 6 }}>
              <span className="bar__label"><span className="sdot" style=${{ background: r.color }} /><span>${r.species}</span></span>
              <span className="faint" style=${{ fontSize: 12 }}>${r.day} day · ${r.night} night</span>
            </div>
            <${SplitBar} segments=${[
              { value: r.day, color: "var(--day)", title: `${r.species}, daytime`, tod: "day" },
              { value: r.night, color: "var(--night)", title: `${r.species}, night`, tod: "night" },
            ]} onSelect=${(s) => go({ species: r.species, tod: s.tod })} />
          </div>`)}
        </div>
      </${Panel}>

      <${Panel} title="Day of the week">
        <${Bars} data=${wk} max=${Math.max(1, ...wk.map((w) => w.value))} onSelect=${(d, i) => go({ wday: i })} />
      </${Panel}>
    </div>

    ${weather && html`<${Panel} title="Weather"
      actions=${html`<span className="faint" style=${{ fontSize: 12 }}>Sightings per 100 hours of each condition</span>`}>
      <div className="grid grid--3">
        ${[["Wind", weather.wind], ["Pressure", weather.trend], ["Rain", weather.sky]].map(([title, rows]) => html`<div key=${title}>
          <div className="h-sub">${title}</div>
          <${Bars} data=${rows} fmt=${(v) => v.toFixed(1)} />
        </div>`)}
      </div>
    </${Panel}>`}

    ${secondary}

    <${Panel} title="Calendar"
      actions=${html`<span className="faint" style=${{ fontSize: 12 }}>Last 6 months · tap a day</span>`}>
      <div className="scroll-x"><${CalHeat} counts=${isoDayCounts(filtered)} weeks=${26}
        onSelect=${(key) => go({ range: "custom", from: key, to: key })} /></div>
    </${Panel}>
  </div>`;
}
