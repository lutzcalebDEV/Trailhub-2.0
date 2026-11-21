// Vale Trails — Identify: confirm species on AI-flagged captures, and sort deer that
// are only "Deer" into Buck or Doe.
import { html, useState, useEffect, useMemo } from "../react.js";
import { Empty, Btn, Media, Segmented } from "../ui.js";
import { Icon } from "../icons.js";
import {
  SPECIES_ORDER, speciesColor, effectiveSpecies, reviewReason, fmtDateTime, LS, usePersistentSet,
} from "../core.js";
import { eff, collapseBursts } from "../analytics.js";

// Nearly every photo here is one of these four, so they get the big buttons. The
// other twelve are one tap away and stay open once opened.
const COMMON = ["Deer", "Buck", "Doe", "Empty"].filter((sp) => SPECIES_ORDER.includes(sp));
const OTHERS = SPECIES_ORDER.filter((sp) => !COMMON.includes(sp));

export function Review(app) {
  const { captures, reviewQ, ov, archived } = app;
  // "Can't tell" in the deer pass is remembered on this phone, so those stay "Deer"
  // and don't come back.
  const [unsure, unsure$] = usePersistentSet(LS.deerUnsure);
  // One card per burst: a camera fires several near-identical frames per trigger.
  const deerBursts = useMemo(() => collapseBursts(captures.filter((c) => {
    const id = String(c.id);
    return effectiveSpecies(c, ov) === "Deer" && !archived.has(id) && !unsure.has(id);
  })), [captures, ov, archived, unsure]);
  const [mode, setMode] = useState(() => (reviewQ.length || !deerBursts.length ? "id" : "deer"));

  const showTabs = deerBursts.length > 0 || mode === "deer";
  return html`<div className="col" style=${{ gap: 14 }}>
    ${showTabs && html`<div><${Segmented} value=${mode} onChange=${setMode} label="What to identify" options=${[
      { value: "id", label: `Needs ID${reviewQ.length ? ` · ${reviewQ.length}` : ""}` },
      { value: "deer", label: `Buck or doe?${deerBursts.length ? ` · ${deerBursts.length}` : ""}` },
    ]} /></div>`}
    ${mode === "deer"
      ? html`<${DeerSort} app=${app} bursts=${deerBursts} onUnsure=${(ids) => unsure$.setSet((s) => {
          const n = new Set(s);
          for (const id of ids) n.add(String(id));
          return n;
        })} />`
      : html`<${NeedsId} app=${app} />`}
  </div>`;
}

// Photos tagged only "Deer" (Gemini couldn't judge antlers, or someone tagged it that
// way), one burst at a time. The answer tags every frame in the burst.
function DeerSort({ app, bursts, onUnsure }) {
  const { bulkAssign, camName, openLightbox } = app;
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState(0);
  const [startCount] = useState(bursts.length);
  const len = bursts.length;
  useEffect(() => { if (index >= len && len > 0) setIndex(len - 1); }, [len, index]);

  const current = len ? bursts[Math.min(index, len - 1)] : null;
  const leadId = current ? current.capture.id : null;
  useEffect(() => { setFrame(0); }, [leadId]);

  if (!current) {
    return html`<${Empty} icon="checkCircle" title="Every deer is sorted"
      message="Photos tagged just “Deer” show up here so you can mark them Buck or Doe." />`;
  }

  const frames = current.frames;
  const shown = frames[Math.min(frame, frames.length - 1)];
  const ids = frames.map((c) => c.id);
  const done = Math.max(0, startCount - len);
  const pct = startCount ? Math.round((done / startCount) * 100) : 100;
  const answer = (sp) => bulkAssign(ids, sp);
  const n = frames.length;

  return html`<div className="review">
    <div className="reviewcard">
      ${shown.image
        ? html`<button type="button" className="reviewcard__zoom" aria-label="Open the photo full size"
            onClick=${() => openLightbox(frames, Math.min(frame, n - 1))}>
            <${Media} key=${shown.id} className="reviewcard__img" capture=${shown} alt="Deer" playable />
          </button>`
        : html`<div className="shot__noimg" style=${{ height: "46vh" }}>No image available</div>`}
      <div className="reviewcard__bar">
        <span className="shot__cam"><${Icon} name="camera" size=${14} /><span>${camName(shown.camera)}</span></span>
        ${n > 1 && html`<span className="frames">
          <button type="button" className="iconbtn iconbtn--bare" aria-label="Previous frame" disabled=${frame === 0}
            onClick=${() => setFrame((f) => Math.max(0, f - 1))}><${Icon} name="chevronLeft" size=${16} /></button>
          <span className="tnum" aria-label=${`Frame ${frame + 1} of ${n}`}>${frame + 1}/${n}</span>
          <button type="button" className="iconbtn iconbtn--bare" aria-label="Next frame" disabled=${frame >= n - 1}
            onClick=${() => setFrame((f) => Math.min(n - 1, f + 1))}><${Icon} name="chevronRight" size=${16} /></button>
        </span>`}
        <div className="spacer" />
        <span className="muted" style=${{ fontSize: 12.5, display: "inline-flex", gap: 6, alignItems: "center" }}>
          <${Icon} name=${shown.isNight ? "moon" : "sun"} size=${14} />${fmtDateTime(shown.date)}
        </span>
      </div>
    </div>

    <div className="reviewside">
      <div className="row" style=${{ justifyContent: "space-between", marginBottom: 6 }}>
        <h3>Buck or doe?</h3>
        <span className="faint tnum" style=${{ fontSize: 12.5 }}>${done}/${startCount}</span>
      </div>
      <div className="progressbar"><i style=${{ width: pct + "%" }} /></div>
      <p className="faint mt-sm" style=${{ fontSize: 12.5 }}>
        ${len.toLocaleString()} sighting${len === 1 ? "" : "s"} left · look for antlers, tap the photo to zoom
      </p>

      <div className="spgrid spgrid--common">
        ${["Buck", "Doe"].map((sp) => html`<button key=${sp} className="spbtn" onClick=${() => answer(sp)}>
          <span className="sdot" style=${{ background: speciesColor(sp) }} />${sp}
        </button>`)}
      </div>

      <div className="row mt-lg" style=${{ gap: 9, flexWrap: "wrap" }}>
        <${Btn} onClick=${() => onUnsure(ids)}>Can't tell</${Btn}>
        <${Btn} variant="ghost" onClick=${() => setIndex((i) => (i + 1) % len)}>Skip for now</${Btn}>
      </div>
      <p className="faint mt-sm" style=${{ fontSize: 12.5 }}>
        ${n > 1 ? `Your answer tags all ${n} frames of this sighting, for everyone. ` : "Your answer is saved for everyone. "}
        “Can't tell” keeps it as Deer and takes it off this list on this phone.
      </p>
    </div>
  </div>`;
}

function NeedsId({ app }) {
  const { captures, reviewQ, ov, assignSpecies, keep, archive, camName } = app;
  const [index, setIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);

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
  const speciesButton = (sp) => html`<button key=${sp} className="spbtn" onClick=${() => assignSpecies(current.id, sp)}>
    <span className="sdot" style=${{ background: speciesColor(sp) }} />${sp}
  </button>`;

  return html`<div className="review">
    <div className="reviewcard">
      ${current.image
        ? html`<${Media} key=${current.id} className="reviewcard__img" capture=${current} alt=${guess} playable />`
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

      <div className="spgrid spgrid--common">
        ${COMMON.map(speciesButton)}
      </div>
      <button type="button" className="spmore" onClick=${() => setShowAll((v) => !v)} aria-expanded=${showAll}>
        <span>${showAll ? "Fewer animals" : "Another animal"}</span>
        <${Icon} name="chevronDown" size=${16} className=${showAll ? "is-up" : ""} />
      </button>
      ${showAll && html`<div className="spgrid">${OTHERS.map(speciesButton)}</div>`}

      <div className="row mt-lg" style=${{ gap: 9, flexWrap: "wrap" }}>
        <${Btn} onClick=${() => keep(current.id)}>${guess === "Animal" ? "Can't tell" : `Yes, ${guess}`}</${Btn}>
        <${Btn} variant="ghost" onClick=${skip}>Skip for now</${Btn}>
        <div className="spacer" />
        <${Btn} variant="ghost" onClick=${() => archive(current.id)}>Hide photo</${Btn}>
      </div>
      <p className="faint mt-sm" style=${{ fontSize: 12.5 }}>
        ${guess === "Animal" ? "“Can't tell” leaves it unlabelled" : `“Yes, ${guess}” keeps its label`} and takes it off this list.
        “Skip for now” brings it back later. “Hide photo” hides it on this phone.
      </p>
    </div>
  </div>`;
}
