// Vale Trails — DeerCast's Home card, and the pieces the DeerCast page shares with it.
import { html, useState, useEffect, useMemo } from "../react.js";
import { Icon } from "../icons.js";
import { fmtTime, fmtDateLong } from "../core.js";
import { buildCast, standWind } from "../deercast.js";

export const cx = (...xs) => xs.filter(Boolean).join(" ");
export const tone = (band) => "cast-" + band.toLowerCase();
const weekday = (d) => d.toLocaleDateString([], { weekday: "short" });
export const dayName = (day) => (day.ahead === 0 ? "Today" : day.ahead === 1 ? "Tomorrow" : fmtDateLong(day.date));
export const when = (w) => `${fmtTime(new Date(w.start))} – ${fmtTime(new Date(w.end))}`;
// Forecasts this far out change a lot.
export const FAR = 5;

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
export function useCast({ data, captures, ov }, allHours) {
  const now = useNow();
  const cast = useMemo(() => buildCast(data, captures, ov, { allHours, now }), [data, captures, ov, allHours, now]);
  return [cast, now];
}

// The day tapped on the Home card, opened when the page appears.
let openOn = null;
export const takeOpenDay = () => { const k = openOn; openOn = null; return k; };

export function Week({ days, picked, onPick }) {
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

function Score({ day }) {
  return html`<div className=${cx("cast__score", tone(day.band))}
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
  const next = left[0] || day.windows[0];
  const stands = next ? (app.data.cameras || []).map((c) => ({ name: app.camName(c.name), r: standWind((app.data.stands || {})[c.name], next.wind) })).filter((x) => x.r) : [];
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
    ${stands.length > 0 && html`<div className="cast__stands">
      ${stands.map((x) => html`<span key=${x.name}><b>${x.name}</b>
        <span className=${"windpill is-" + x.r.level}><${Icon} name=${x.r.level === "good" ? "check" : x.r.level === "avoid" ? "x" : "info"} size=${13} />${x.r.text}</span></span>`)}
      <small>${next.label} wind, ${next.wind.unsure ? "direction uncertain," : next.wind.dir} ${Math.round(next.wind.speed)} mph · best guess</small>
    </div>`}
    <${Week} days=${cast.days} onPick=${open} />
    <button type="button" className="cast__more" onClick=${() => open(day.key)}>
      <span>See hourly forecast and wind map</span><${Icon} name="chevronRight" size=${18} />
    </button>
  </section>`;
}
