// Vale Trails — Insights: movement patterns, timing, species mix and calendar.
import { html } from "../react.js";
import { FilterBar } from "../shell.js";
import { Stat, Panel, Histogram, Donut, Legend, Bars, SplitBar, CalHeat, Empty } from "../ui.js";
import { labelHour } from "../core.js";
import {
  speciesCounts, hourHistogram, dayNightSplit, daylightPct, peakHour,
  weekdayCounts, speciesByDayNight, tempBuckets, moonCounts, cameraCounts, isoDayCounts,
} from "../analytics.js";

function buildDonut(counts) {
  if (counts.length <= 7) return counts.map((c) => ({ value: c.value, color: c.color, label: c.species }));
  const top = counts.slice(0, 6).map((c) => ({ value: c.value, color: c.color, label: c.species }));
  const other = counts.slice(6).reduce((s, c) => s + c.value, 0);
  top.push({ value: other, color: "var(--sp-other)", label: "Other" });
  return top;
}

export function Insights(app) {
  const { filtered, filters, setFilter, spList, data, ov } = app;

  const filterBar = html`<${FilterBar} filters=${filters} set=${setFilter}
    cameras=${data.cameras} speciesList=${spList} count=${filtered.length} />`;

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
  const counts = speciesCounts(filtered, ov);
  const byDN = speciesByDayNight(filtered, ov, 6);
  const temps = tempBuckets(filtered);
  const moons = moonCounts(filtered);
  const cams = cameraCounts(filtered);
  const donut = buildDonut(counts);

  // Choose the most informative secondary panel based on available data.
  let secondary;
  if (temps) {
    secondary = html`<${Panel} title="By temperature" icon="thermo">
      <${Bars} data=${temps.buckets.map((b) => ({ label: `${b.lo}–${b.hi}°`, value: b.value }))} />
    </${Panel}>`;
  } else if (moons) {
    secondary = html`<${Panel} title="By moon phase" icon="moon">
      <${Bars} data=${moons.map((m) => ({ label: m.moon, value: m.value }))} />
    </${Panel}>`;
  } else {
    secondary = html`<${Panel} title="By camera" icon="map">
      <${Bars} data=${cams.slice(0, 7).map((c) => ({ label: c.camera, value: c.value }))} />
    </${Panel}>`;
  }

  return html`<div className="col" style=${{ gap: 18 }}>
    ${filterBar}

    <div className="grid grid--stats">
      <${Stat} label="Captures" value=${filtered.length.toLocaleString()} icon="images" tone="acc" />
      <${Stat} label="Daytime" value=${daylightPct(filtered) + "%"} icon="sun" tone="day"
        sub=${`${split.day} day · ${split.night} night`} />
      <${Stat} label="Peak hour" value=${peak ? labelHour(peak.hour) : "—"} icon="clock"
        sub=${peak ? `${peak.count} captures` : ""} />
      <${Stat} label="Busiest day" value=${busiestWk.value ? busiestWk.label : "—"} icon="calendar"
        sub=${busiestWk.value ? `${busiestWk.value} captures` : ""} />
      <${Stat} label="Species" value=${counts.length} icon="paw"
        sub=${counts[0] ? `Top: ${counts[0].species}` : ""} />
    </div>

    <${Panel} title="Activity by hour" icon="clock">
      <${Histogram} hours=${hourHistogram(filtered)} />
    </${Panel}>

    <div className="grid grid--2">
      <${Panel} title="Day vs night by species" icon="layers">
        <div className="col" style=${{ gap: 13 }}>
          ${byDN.map((r) => html`<div key=${r.species}>
            <div className="row" style=${{ justifyContent: "space-between", marginBottom: 6 }}>
              <span className="bar__label"><span className="sdot" style=${{ background: r.color }} /><span>${r.species}</span></span>
              <span className="faint" style=${{ fontSize: 12 }}>${r.day} day · ${r.night} night</span>
            </div>
            <${SplitBar} segments=${[
              { value: r.day, color: "var(--day)", title: "Day" },
              { value: r.night, color: "var(--night)", title: "Night" },
            ]} />
          </div>`)}
        </div>
      </${Panel}>

      <${Panel} title="Species mix" icon="paw">
        <div className="row" style=${{ gap: 22, alignItems: "center", flexWrap: "wrap" }}>
          <${Donut} segments=${donut} centerValue=${filtered.length.toLocaleString()} centerLabel="captures" />
          <div style=${{ flex: 1, minWidth: 180 }}>
            <${Legend} items=${donut} />
          </div>
        </div>
      </${Panel}>
    </div>

    <div className="grid grid--2">
      <${Panel} title="By day of week" icon="calendar">
        <${Bars} data=${wk} max=${Math.max(1, ...wk.map((w) => w.value))} />
      </${Panel}>
      ${secondary}
    </div>

    <${Panel} title="Activity calendar" icon="calendar"
      actions=${html`<span className="faint" style=${{ fontSize: 12 }}>Last 6 months</span>`}>
      <div className="scroll-x"><${CalHeat} counts=${isoDayCounts(filtered)} weeks=${26} /></div>
    </${Panel}>
  </div>`;
}
