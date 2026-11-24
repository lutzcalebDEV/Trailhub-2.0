// Vale Trails — what the nearest airport is reading now, checked when the page opens,
// every 10 minutes, and when the forecast is refreshed.
import { html, useState, useEffect } from "../react.js";
import { timeAgo, fetchWindNow } from "../core.js";
import { compass } from "../deercast.js";

// { speed, gust, deg, calm, text, from } or null.
export function useWindNow(site, forecast, now) {
  const [obs, setObs] = useState(null);
  const fetched = forecast ? forecast.fetchedAt : "";
  useEffect(() => {
    let live = true;
    const load = () => fetchWindNow().then((o) => { if (live) setObs(o); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 10 * 60000);
    return () => { live = false; clearInterval(id); };
  }, [fetched]);
  if (!obs || !site || now - obs.at > 2 * 3600000) return null;
  const a = obs.airport;
  const miles = Math.round(Math.hypot((a.lat - site.lat) * 69, (a.lng - site.lng) * 69 * Math.cos((site.lat * Math.PI) / 180)));
  const calm = obs.speed < 1;
  const from = !calm && obs.deg != null ? compass(obs.deg) + " " : "";
  return { ...obs, calm, text: calm ? "calm" : `${from}${Math.round(obs.speed)} mph${obs.gust ? `, gusts ${Math.round(obs.gust)}` : ""}`,
    where: `${a.name}, ${miles} miles away`, ago: timeAgo(new Date(obs.at), now) };
}

export function WindNow({ site, forecast, now }) {
  const o = useWindNow(site, forecast, now);
  if (!o) return null;
  return html`<div className="windnow">
    ${!o.calm && o.deg != null && html`<svg className="castarrow" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"
      style=${{ transform: `rotate(${o.deg + 180}deg)` }}><path d="M12 3v18M6 9l6-6 6 6" /></svg>`}
    <span><b>Right now: ${o.text}</b><small>${o.where} · ${o.ago}</small></span>
  </div>`;
}
