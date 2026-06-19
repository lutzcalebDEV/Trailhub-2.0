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
    return html`<${Empty} icon="checkCircle" title="All caught up"
      message=${allFlagged
        ? `You've reviewed all ${allFlagged} flagged captures. New ones will show up here as your cameras report.`
        : "Nothing needs review right now. Captures the AI can't confidently identify will appear here."} />`;
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
        ${reason && html`<span className="reason"><${Icon} name="scan" size=${14} />${reason}</span>`}
        <span className="shot__cam"><${Icon} name="camera" size=${14} /><span>${camName(current.camera)}</span></span>
        <div className="spacer" />
        <span className="muted" style=${{ fontSize: 12.5, display: "inline-flex", gap: 6, alignItems: "center" }}>
          <${Icon} name=${current.isNight ? "moon" : "sun"} size=${14} />${fmtDateTime(current.date)}
        </span>
      </div>
    </div>

    <div className="reviewside">
      <div className="row" style=${{ justifyContent: "space-between", marginBottom: 6 }}>
        <h3>Identify species</h3>
        <span className="faint tnum" style=${{ fontSize: 12.5 }}>${resolved}/${allFlagged}</span>
      </div>
      <div className="progressbar"><i style=${{ width: pct + "%" }} /></div>
      <p className="faint mt-sm" style=${{ fontSize: 12.5 }}>
        ${len} capture${len === 1 ? "" : "s"} left · currently tagged
        <b style=${{ color: "var(--text-muted)" }}> ${guess}</b>
      </p>

      <div className="spgrid">
        ${SPECIES_ORDER.map((sp) => html`<button key=${sp} className="spbtn" onClick=${() => assignSpecies(current.id, sp)}>
          <span className="sdot" style=${{ background: speciesColor(sp) }} />${sp}
        </button>`)}
      </div>

      <div className="row mt-lg" style=${{ gap: 9 }}>
        <${Btn} variant="primary" icon="check" onClick=${() => keep(current.id)}>Looks right</${Btn}>
        <${Btn} variant="ghost" icon="chevronRight" onClick=${skip}>Skip</${Btn}>
        <div className="spacer" />
        <${Btn} variant="danger" icon="archive" onClick=${() => archive(current.id)}>Archive</${Btn}>
      </div>
    </div>
  </div>`;
}
