// Vale Trails — Uploads: everything added through the Upload button, newest first.
import { html } from "../react.js";
import { Shot, Empty, Btn } from "../ui.js";
import { effectiveSpecies, fmtTime } from "../core.js";
import { groupByDay } from "./gallery.js";

export function Uploads(app) {
  const { uploads, ov, camName, openLightbox, openUpload, comments } = app;

  if (!uploads.length) {
    return html`<${Empty} icon="upload" title="Nothing uploaded yet"
      message="Photos and videos added with the Upload button appear here."
      action=${html`<${Btn} sm variant="primary" onClick=${openUpload}>Upload</${Btn}>`} />`;
  }

  const groups = groupByDay(uploads.map((capture) => ({ capture })));
  const caption = (c) => {
    const n = (comments[c.id] || []).length;
    return n ? `${n} comment${n === 1 ? "" : "s"}` : fmtTime(c.date);
  };

  return html`<div className="col" style=${{ gap: 6 }}>
    <span className="filterbar__count" style=${{ marginLeft: 0 }}>
      ${uploads.length.toLocaleString()} upload${uploads.length === 1 ? "" : "s"}
    </span>
    ${groups.map((g) => html`<section key=${g.key} className="dayblock">
      <h2 className="dayblock__head">${g.label}</h2>
      <div className="shots size-M">
        ${g.items.map(({ capture: c }) => html`<${Shot} key=${c.id} capture=${c}
          species=${effectiveSpecies(c, ov)} cameraLabel=${camName(c.camera)} timeLabel=${caption(c)}
          onClick=${() => openLightbox(uploads, uploads.indexOf(c))} />`)}
      </div>
    </section>`)}
  </div>`;
}
