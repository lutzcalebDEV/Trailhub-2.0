// Vale Trails — DeerCast: the forecast page. The math is in ../deercast.js.
import { html, useState, useEffect, useRef } from "../react.js";
import { Segmented, Empty, Btn } from "../ui.js";
import { Icon } from "../icons.js";
import { LS, usePersistent, fmtTime, timeAgo } from "../core.js";
import { standWind, windOver, siteOf, bandOf, daylight, inDaylight } from "../deercast.js";
import { bestSit } from "../analytics.js";
import { windowLabel } from "./insights.js";
import { cx, tone, dayName, when, FAR, useCast, Week, takeOpenDay } from "./castcard.js";
import { WindMap } from "./windmap.js";
import { allStands } from "./livewind.js";
import { calmAir } from "../terrain.js";
import { WindNow } from "./windnow.js";

/* ------------------------------ Hourly curve ------------------------------ */
// `at` is the chosen quarter hour; the chart is the slider that chooses it.
const W = 720, H = 190, TOP = 14;
function Curve({ day, at, onPick, time }) {
  const ref = useRef(null);
  const pts = day.points;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => ((t - t0) / (t1 - t0)) * W;
  const y = (s) => H - (s / 10) * (H - TOP);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.score).toFixed(1)}`).join("");
  const pick = (e) => {
    const r = ref.current.getBoundingClientRect();
    onPick(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (pts.length - 1)));
  };
  const onKey = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    onPick(Math.min(pts.length - 1, Math.max(0, at + (e.key === "ArrowLeft" ? -1 : 1))));
  };
  const p = pts[at];
  const left = ((p.t - t0) / (t1 - t0)) * 100 + "%";
  return html`<div className="castcurve">
    <div className="castcurve__time"><output style=${{ left: `clamp(42px, ${left}, calc(100% - 42px))` }}>${time}</output></div>
    <div className="castcurve__plot" ref=${ref} tabIndex=${0} role="slider" aria-label="Movement by hour"
      aria-valuemin="0" aria-valuemax=${pts.length - 1} aria-valuenow=${at}
      aria-valuetext=${`${fmtTime(new Date(p.t))}: ${Math.round(p.score)} out of 10`}
      onPointerDown=${pick} onPointerMove=${(e) => { if (e.buttons || e.pointerType !== "mouse") pick(e); }} onKeyDown=${onKey}>
      <svg viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <rect className="castcurve__night" x="0" y="0" width=${x(day.light.start)} height=${H} />
        <rect className="castcurve__night" x=${x(day.light.end)} y="0" width=${W - x(day.light.end)} height=${H} />
        ${[2.5, 5, 7.5].map((s) => html`<line key=${s} className="castcurve__grid" x1="0" x2=${W} y1=${y(s)} y2=${y(s)} />`)}
        ${day.windows.map((v) => html`<rect key=${v.label} className="castcurve__win" x=${x(v.start)} y="0" width=${x(v.end) - x(v.start)} height=${H} />`)}
        <path className="castcurve__area" d=${`${line}L${W},${H}L0,${H}Z`} />
        <path className="castcurve__line" d=${line} />
      </svg>
      <span className="castcurve__cross" style=${{ left }} />
      <span className="castcurve__dot" style=${{ left, top: (y(p.score) / H) * 100 + "%" }} />
    </div>
    <div className="axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
    <div className="castcurve__legend">
      <span><i className="is-win" />Best times</span>
      <span><i className="is-night" />Outside daylight</span>
    </div>
  </div>`;
}

/* ---------------------------------- Page ---------------------------------- */
const pts = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(1);
const MAX_PTS = 2;

export function DeerCast(app) {
  const { data, camName } = app;
  const [mode, setMode] = usePersistent(LS.castHours, "day");
  const allHours = mode === "all";
  const [cast, now] = useCast(app, allHours);
  const [picked, setPicked] = useState(takeOpenDay);
  useEffect(() => { app.loadStands(); }, [app.loadStands]);
  const [chosen, setChosen] = useState(null); // quarter hour of the day, or null for now/best

  if (!cast) {
    return html`<${Empty} icon="gauge" title="No forecast yet"
      message="DeerCast fills in once the weather forecast loads. Pull down to try again." />`;
  }
  const day = cast.days.find((d) => d.key === picked) || cast.days[0];
  const stands = (data.cameras || []).filter((c) => (data.stands || {})[c.name]);

  // Until a time is chosen: now, if it's that day, or else the day's best moment.
  const P = day.points, last = P.length - 1;
  const isNow = now >= P[0].t && now < P[last].t;
  const best = P.reduce((b, p, i) => ((allHours || p.light) && (b < 0 || p.score > P[b].score) ? i : b), -1);
  const at = chosen != null ? Math.min(chosen, last) : isNow ? Math.min(last, Math.floor((now - P[0].t) / 900000)) : Math.max(0, best);
  const p = P[at];
  const w = p.weather;
  const time = fmtTime(new Date(p.t));
  const wind = w ? windOver([w]) : null;
  const hour = Math.min(23, Math.floor(at / 4));
  const band = bandOf(p.score);
  const site = siteOf(data);
  const spots = allStands(app).map((s) => ({ ...s, name: s.id, rating: s.camera ? standWind((data.stands || {})[s.camera], wind) : null,
    air: calmAir(data.terrain, s, wind, p.t, site, w && w.rain >= 0.1) }));
  const sit = bestSit(app.captures, app.ov, site && { ...daylight(new Date(now), site), has: (d) => inDaylight(d, site) });
  const pickDay = (k) => { setPicked(k); setChosen(null); };

  return html`<div className="col castpage" style=${{ gap: 18 }}>
    <div className="castpage__bar">
      <${Segmented} value=${mode} onChange=${setMode} label="Hours to score"
        options=${[{ value: "day", label: "Daylight" }, { value: "all", label: "All hours" }]} />
      <span className="faint">${cast.fetchedAt ? `Weather updated ${timeAgo(cast.fetchedAt, now)}` : ""}</span>
    </div>
    ${cast.stale && html`<div className="nudge"><span>This forecast is <b>out of date</b>. Check the weather before you go.</span></div>`}

    <${Week} days=${cast.days} picked=${day.key} onPick=${pickDay} />

    <section className=${cx("casthero", tone(band))}>
      <div className="castnow" aria-live="polite">
        <div className="castnow__score"><b className="tnum">${Math.round(p.score)}</b><span>/10</span></div>
        <div className="castnow__bar"><i style=${{ width: p.score * 10 + "%" }} /></div>
        <div className="castnow__label">${band} deer movement</div>
        <div className="castnow__time">${dayName(day)} at ${time}${chosen == null ? (isNow ? " (now)" : " (best time)") : ""}</div>
        <div className="castnow__day">${day.ahead === 0 ? "Today" : "Day"} overall: <b>${day.shown}/10, ${day.band.toLowerCase()}</b> · ${Math.round(day.lo)}–${Math.round(day.hi)}° · ${day.moon} moon</div>
        ${day.ahead >= FAR && html`<div className="castnow__far"><${Icon} name="info" size=${14} />Less certain this far out</div>`}
      </div>
      <dl className="caststrip">
        <div><dt><${Icon} name="thermo" size=${15} />Temp</dt><dd>${w ? Math.round(w.temp) + "°" : "—"}</dd></div>
        <div><dt><${Icon} name="rain" size=${15} />Rain</dt><dd>${!w ? "—" : w.chance != null ? Math.round(w.chance) + "%" : w.rain >= 0.1 ? "Yes" : "No"}</dd></div>
        <div><dt><${Icon} name="sunrise" size=${15} />Sunrise</dt><dd>${fmtTime(new Date(day.light.rise))}</dd></div>
        <div><dt><${Icon} name="sunset" size=${15} />Sunset</dt><dd>${fmtTime(new Date(day.light.set))}</dd></div>
      </dl>
      ${site && html`<${WindMap} stands=${spots} site=${site} wind=${wind} time=${time} onOpen=${() => app.openWind()} />`}
      ${site && html`<div className="castacts">
        <${Btn} variant="primary" icon="expand" onClick=${() => app.openWind()}>Live wind</${Btn}>
        <${Btn} icon="pin" onClick=${() => app.openWind({ start: "new" })}>Add stand</${Btn}>
        <${Btn} icon="stand" onClick=${() => app.setView("stands")}>Stands</${Btn}>
      </div>`}
      ${site && html`<${WindNow} site=${site} forecast=${data.forecast} now=${now} />`}
      <div>
        <${Curve} day=${day} at=${at} onPick=${setChosen} time=${time} />
        <div className="castcurve__foot"><span>Drag the chart to change the time</span>
          ${chosen != null && html`<button type="button" onClick=${() => setChosen(null)}>${isNow ? "Back to now" : "Back to best time"}</button>`}</div>
      </div>
      <div className="castwins">
        ${day.windows.map((v) => html`<button type="button" key=${v.label} className=${cx("castwin", v.end <= now && "is-past")}
          onClick=${() => setChosen(P.reduce((b, q, i) => (q.t >= v.start && q.t <= v.end && (b < 0 || q.score > P[b].score) ? i : b), -1))}>
          <span><${Icon} name=${v.label === "Morning" ? "sunrise" : "sunset"} size=${15} />Best ${v.label.toLowerCase()}${v.end <= now ? " · passed" : ""}</span>
          <b>${when(v)}</b>
        </button>`)}
      </div>
      <p className="castnote">Streaks show the wind.${spots.some((s) => !s.camera) ? " Trails show where scent blows from each stand." : ""}${spots.some((s) => !s.pinned) ? " Pins are approximate until moved on the Map page." : ""}${stands.length ? " Stand ratings are best guesses and don't change the score." : ""}${wind && wind.unsure ? " Forecasts disagree by more than 45° here, so check the wind when you arrive." : ""}${wind && wind.speed < 3 ? " Wind this light can drift any direction." : ""}${spots.some((s) => !s.camera && s.air && s.air.toward != null) ? " In calm air, plumes follow the slope of the land: an estimate." : ""}</p>
    </section>

    ${sit && html`<button type="button" className="linkrow" onClick=${() => { app.setFilter({ camera: sit.camera }); app.setView("gallery"); }}>
      <span><b>Busiest camera lately: ${camName(sit.camera)}, ${windowLabel(sit)}</b>
        <small>${sit.count} of ${sit.total} daylight deer sightings in 21 days</small></span><${Icon} name="chevronRight" size=${18} />
    </button>`}

    <details className="panel castdetails">
      <summary><span><b>Why ${day.ahead <= 1 ? dayName(day).toLowerCase() : dayName(day)} is ${day.shown}/10</b><small>${day.why}</small></span><${Icon} name="chevronDown" size=${18} /></summary>
      <div className="panel__body">
      <div className="castwhy">
        <div className="castwhy__row is-base"><span>Ordinary day</span><span /><b className="tnum">5.0</b></div>
        ${day.factors.map((f) => html`<div key=${f.id} className="castwhy__row">
          <span>${f.label}<small>${f.detail}</small></span>
          <span className="castwhy__track" aria-hidden="true">
            ${f.pts !== 0 && html`<i className=${f.pts > 0 ? "up" : "down"}
              style=${{ [f.pts > 0 ? "left" : "right"]: "50%", width: (Math.min(MAX_PTS, Math.abs(f.pts)) / MAX_PTS) * 50 + "%" }} />`}
          </span>
          <b className="tnum">${pts(f.pts)}</b>
        </div>`)}
        <div className="castwhy__row is-total"><span>Score</span><span /><b className="tnum">${day.score.toFixed(1)}</b></div>
      </div>
      <p className="castnote">A starting estimate from deer research and ${cast.visits} deer visit${cast.visits === 1 ? "" : "s"} on your cameras in the last 60 days. It hasn't been checked against results yet, and it isn't a percent chance. The moon isn't scored because studies disagree about it. Daylight runs from 30 minutes before sunrise to 30 minutes after sunset.</p>
    </div>
    </details>
  </div>`;
}
