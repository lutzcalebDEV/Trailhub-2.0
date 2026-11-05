// Vale Trails — Review: confirm species on AI-flagged captures.
import { html, useState, useEffect } from "../react.js";
import { Empty, Btn } from "../ui.js";
import { Icon } from "../icons.js";
import { SPECIES_ORDER, speciesColor, effectiveSpecies, reviewReason, fmtDateTime } from "../core.js";
import { eff } from "../analytics.js";

export function Review(app) {
  const { captures, reviewQ, ov, assignSpecies, keep, archive, camName } = app;
  const [index, setIndex] = useState(0);

  const len = reviewQ.length;
  useEffect(() => { if (index >= len && len > 0) setIndex(len - 1); }, [len, index]);

  // Denominator uses the original AI flag state so progress fills as you resolve items.
  const allFlagged = captures.filter((c) => reviewReason(c) != null).length;
  const resolved = Math.max(0, allFlagged - len);
  const pct = allFlagged ? Math.round((resolved / allFlagged) * 100) : 100;

  if (len === 0) {
    return html`<${Empty} icon="checkCircle" title="All done"
      message=${allFlagged
        ? `Every photo has an ID. New ones will show up here.`
        : "Nothing needs an ID right now. Photos that can't be identified automatically will show up here."} />`;
  }

  const current = reviewQ[Math.min(index, len - 1)];
  const guess = effectiveSpecies(current, ov);
  const reason = reviewReason(eff(current, ov));
  const skip = () => setIndex((i) => (i + 1) % len);

  return html`<div className="review">
    <div className="reviewcard">
      ${current.image
        ? html`<img className="reviewcard__img" src=${current.image} alt=${guess} />`
        : html`<div className="shot__noimg" style=${{ height: "46vh" }}>No image available</div>`}
      <div className="reviewcard__bar">
        ${reason && reason !== "Needs ID" && html`<span className="reason"><${Icon} name="scan" size=${14} />${reason}</span>`}
        <span className="shot__cam"><${Icon} name="camera" size=${14} /><span>${camName(current.camera)}</span></span>
        <div className="spacer" />
        <span className="muted" style=${{ fontSize: 12.5, display: "inline-flex", gap: 6, alignItems: "center" }}>
          <${Icon} name=${current.isNight ? "moon" : "sun"} size=${14} />${fmtDateTime(current.date)}
        </span>
      </div>
    </div>

    <div className="reviewside">
      <div className="row" style=${{ justifyContent: "space-between", marginBottom: 6 }}>
        <h3>What's in this photo?</h3>
        <span className="faint tnum" style=${{ fontSize: 12.5 }}>${resolved}/${allFlagged}</span>
      </div>
      <div className="progressbar"><i style=${{ width: pct + "%" }} /></div>
      <p className="faint mt-sm" style=${{ fontSize: 12.5 }}>
        ${len.toLocaleString()} photo${len === 1 ? "" : "s"} left
      </p>

      <div className="spgrid">
        ${SPECIES_ORDER.map((sp) => html`<button key=${sp} className="spbtn" onClick=${() => assignSpecies(current.id, sp)}>
          <span className="sdot" style=${{ background: speciesColor(sp) }} />${sp}
        </button>`)}
      </div>

      <div className="row mt-lg" style=${{ gap: 9 }}>
        <${Btn} onClick=${skip}>Skip</${Btn}>
        <${Btn} variant="ghost" onClick=${() => keep(current.id)}>${guess === "Animal" ? "Can't tell" : "Keep " + guess}</${Btn}>
        <div className="spacer" />
        <${Btn} variant="ghost" onClick=${() => archive(current.id)}>Hide photo</${Btn}>
      </div>
    </div>
  </div>`;
}
