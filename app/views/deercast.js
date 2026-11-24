// Vale Trails — DeerCast: the Home card and the forecast page. The math is in
// ../deercast.js.
import { html, useState, useEffect, useMemo, useRef } from "../react.js";
import { Panel, Segmented, Empty } from "../ui.js";
import { Icon } from "../icons.js";
import { LS, usePersistent, fmtTime, fmtDateLong, timeAgo } from "../core.js";
import { buildCast, standWind, windOver, siteOf, bandOf } from "../deercast.js";
import { WindMap } from "./windmap.js";

const cx = (...xs) => xs.filter(Boolean).join(" ");
const tone = (band) => "cast-" + band.toLowerCase();
const weekday = (d) => d.toLocaleDateString([], { weekday: "short" });
const dayName = (day) => (day.ahead === 0 ? "Today" : day.ahead === 1 ? "Tomorrow" : fmtDateLong(day.date));
const when = (w) => `${fmtTime(new Date(w.start))} – ${fmtTime(new Date(w.end))}`;
// Forecasts this far out change a lot.
const FAR = 5;

// Moves on with the clock: the page can stay open past the end of a hunt.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 5 * 60000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return now;
}
function useCast({ data, captures, ov }, allHours) {
  const now = useNow();
  const cast = useMemo(() => buildCast(data, captures, ov, { allHours, now }), [data, captures, ov, allHours, now]);
  return [cast, now];
}

// The day tapped on the Home card, opened when the page appears.
let openOn = null;

function Week({ days, picked, onPick }) {
  return html`<div className="cast__week" role="group" aria-label="Next 7 days">
    ${days.map((d) => html`<button type="button" key=${d.key} onClick=${() => onPick(d.key)}
      className=${cx("cast__day", tone(d.band), picked === d.key && "is-active")}
      aria-pressed=${picked == null ? undefined : picked === d.key}
      aria-label=${`${dayName(d)}: ${d.shown} out of 10, ${d.band}${d.ahead >= FAR ? ", less certain" : ""}`}>
      <span>${d.ahead === 0 ? "Today" : weekday(d.date)}</span>
      <b className="tnum">${d.shown}</b>
      <i className=${d.ahead >= FAR ? "is-far" : ""} style=${{ "--fill": d.score * 10 + "%" }} />
    </button>`)}
  </div>`;
}

function Score({ day, large }) {
  return html`<div className=${cx("cast__score", tone(day.band), large && "is-large")}
    role="img" aria-label=${`${day.shown} out of 10`}>
    <b className="tnum">${day.shown}</b><span>/10</span>
  </div>`;
}

/* ------------------------------- Home card -------------------------------- */
export function CastCard(app) {
  const [cast, now] = useCast(app, false);
  if (!cast) return null;
  const day = cast.days[0];
  const left = day.windows.filter((w) => w.end > now);
  const open = (key) => { openOn = key; app.setView("deercast"); };
  return html`<section className="cast" aria-label="DeerCast">
    <button type="button" className="cast__main" onClick=${() => open(day.key)}>
      <span className="cast__text">
        <span className="cast__k"><${Icon} name="gauge" size=${15} />DeerCast · ${dayName(day)}</span>
        <span className="cast__head">${day.band} deer movement</span>
        ${left.length > 0 && html`<span className="cast__best">
          ${left.map((w) => html`<span key=${w.label}><${Icon} name=${w.label === "Morning" ? "sun" : "moon"} size=${14} />${when(w)}</span>`)}
        </span>`}
        <span className="cast__why">${day.why}${cast.stale ? " · forecast is out of date" : ""}</span>
      </span>
      <${Score} day=${day} />
    </button>
    <${Week} days=${cast.days} onPick=${open} />
    <button type="button" className="cast__more" onClick=${() => open(day.key)}>
      <span>See hourly forecast and wind map</span><${Icon} name="chevronRight" size=${18} />
    </button>
  </section>`;
}

/* ------------------------------ Hourly curve ------------------------------ */
// `at` is the chosen quarter hour; dragging here and the slider above move together.
const W = 720, H = 190, TOP = 14;
function Curve({ day, at, onPick }) {
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
  const [picked, setPicked] = useState(() => { const k = openOn; openOn = null; return k; });
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
  const spots = (data.cameras || []).filter((c) => c.latitude != null && c.longitude != null)
    .map((c) => ({ name: c.name, label: camName(c.name), latitude: c.latitude, longitude: c.longitude, pinned: c.pinned,
      rating: standWind((data.stands || {})[c.name], wind) }));
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
      </div>
      <dl className="caststrip">
        <div><dt><${Icon} name="thermo" size=${15} />Temp</dt><dd>${w ? Math.round(w.temp) + "°" : "—"}</dd></div>
        <div><dt><${Icon} name="rain" size=${15} />Rain</dt><dd>${!w ? "—" : w.chance != null ? Math.round(w.chance) + "%" : w.rain >= 0.1 ? "Yes" : "No"}</dd></div>
        <div><dt><${Icon} name="sunrise" size=${15} />Sunrise</dt><dd>${fmtTime(new Date(day.light.rise))}</dd></div>
        <div><dt><${Icon} name="sunset" size=${15} />Sunset</dt><dd>${fmtTime(new Date(day.light.set))}</dd></div>
      </dl>
      ${site && html`<${WindMap} stands=${spots} site=${site} wind=${wind} time=${time} />`}
      <div className="castslide">
        <output style=${{ left: `calc(${(hour / 23) * 100}% + ${(0.5 - hour / 23) * 28}px)` }}>${time}</output>
        <input type="range" min="0" max="23" step="1" value=${hour} aria-label="Time of day" aria-valuetext=${time}
          onInput=${(e) => setChosen(Number(e.target.value) * 4)} onChange=${() => {}} />
        <div className="castslide__ends"><span>12 AM</span>
          ${chosen != null && html`<button type="button" onClick=${() => setChosen(null)}>${isNow ? "Back to now" : "Back to best time"}</button>`}
          <span>11 PM</span></div>
      </div>
      <p className="castnote">Streaks show where the wind, and your scent, is headed.${spots.some((s) => !s.pinned) ? " Pins are approximate until moved on the Map page." : ""}${wind && wind.speed < 3 ? " Wind this light can drift any direction." : ""}</p>
    </section>

    <section className="casthero">
      <div className="casthero__top">
        <${Score} day=${day} large />
        <div>
          <div className="cast__k">${dayName(day)} overall</div>
          <h2>${day.band} deer movement</h2>
          <p>${day.why}</p>
        </div>
      </div>
      ${day.ahead >= FAR && html`<p className="casthero__far"><${Icon} name="info" size=${15} />Less certain: weather this far out often changes.</p>`}
      <div className="castwins">
        ${day.windows.map((v) => html`<button type="button" key=${v.label} className=${cx("castwin", v.end <= now && "is-past")}
          onClick=${() => setChosen(P.reduce((b, q, i) => (q.t >= v.start && q.t <= v.end && (b < 0 || q.score > P[b].score) ? i : b), -1))}>
          <span><${Icon} name=${v.label === "Morning" ? "sunrise" : "sunset"} size=${15} />Best ${v.label.toLowerCase()}${v.end <= now ? " · passed" : ""}</span>
          <b>${when(v)}</b>
        </button>`)}
      </div>
      <dl className="castfacts">
        <div><dt>${allHours ? "Temperature" : "Daylight temps"}</dt><dd>${Math.round(day.lo)}–${Math.round(day.hi)}°F</dd></div>
        <div><dt>Moon</dt><dd>${day.moon}</dd></div>
      </dl>
    </section>

    <${Panel} title="Hour by hour" actions=${html`<span className="faint tnum" style=${{ fontSize: 13 }}>${time} · ${Math.round(p.score)}/10</span>`}>
      <${Curve} day=${day} at=${at} onPick=${setChosen} />
    </${Panel}>

    ${stands.length > 0 && html`<${Panel} title="Stand wind"
      actions=${html`<span className="castguess">Best guess</span>`}>
      <div className="caststands">
        ${stands.map((c) => html`<div key=${c.name} className="caststand">
          <b>${camName(c.name)}</b>
          ${day.windows.map((w) => {
            const r = standWind(data.stands[c.name], w.wind);
            return r && html`<div key=${w.label} className="caststand__row">
              <span className="muted">${w.label}</span>
              <span className="caststand__wind">
                <svg className="castarrow" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"
                  style=${{ transform: `rotate(${w.wind.deg + 180}deg)` }}><path d="M12 3v18M6 9l6-6 6 6" /></svg>
                ${w.wind.dir} ${Math.round(w.wind.speed)} mph
              </span>
              <span className=${"windpill is-" + r.level}>
                <${Icon} name=${r.level === "good" ? "check" : r.level === "avoid" ? "x" : "info"} size=${13} />${r.text}
              </span>
            </div>`;
          })}
        </div>`)}
      </div>
      <p className="castnote">Arrows show where your scent blows. Based on your walk-in, not on where deer have been seen, and hills and evening air can differ. It doesn't change the score.</p>
    </${Panel}>`}

    <${Panel} title=${`Why ${day.shown}`}>
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
    </${Panel}>
  </div>`;
}
