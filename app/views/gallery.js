// Vale Trails — Photos: every photo, grouped by day, one tile per trigger.
import { html, useState, useMemo, useEffect, Fragment } from "../react.js";
import { FilterBar } from "../shell.js";
import { Segmented, Select, Shot, Empty, Btn } from "../ui.js";
import { effectiveSpecies, TAG_OPTIONS, fmtDateLong, fmtTime, isoDay } from "../core.js";
import { collapseBursts } from "../analytics.js";

const PAGE = 120;

function dayLabel(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isoDay(date) === isoDay(new Date())) return "Today";
  if (isoDay(date) === isoDay(yesterday)) return "Yesterday";
  return fmtDateLong(date);
}

// [{ key, label, items }] in display order; items keep their incoming order.
function groupByDay(items) {
  const groups = [];
  for (const item of items) {
    const key = isoDay(item.capture.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.capture.date), items: [item] });
  }
  return groups;
}

export function Gallery(app) {
  const {
    filtered, filters, setFilter, spList, data, ov,
    gridSize, setGridSize, openLightbox, camName, bulkAssign,
  } = app;
  const [newestFirst, setNewestFirst] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkSpecies, setBulkSpecies] = useState("Deer");

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (newestFirst ? b.date - a.date : a.date - b.date)),
    [filtered, newestFirst]
  );
  // Selecting works on individual photos, so bursts only collapse when browsing.
  const items = useMemo(
    () => (selecting ? sorted.map((capture) => ({ capture, count: 1 })) : collapseBursts(sorted)),
    [sorted, selecting]
  );
  const groups = useMemo(() => groupByDay(items.slice(0, shown)), [items, shown]);
  useEffect(() => setShown(PAGE), [filtered, newestFirst]);

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };
  const allShown = sorted.length > 0 && selected.size === sorted.length;
  const toggleAll = () =>
    setSelected(allShown ? new Set() : new Set(sorted.map((c) => c.id)));
  const applyBulk = () => {
    if (selected.size) bulkAssign([...selected], bulkSpecies);
    exitSelect();
  };

  return html`<div className="col" style=${{ gap: 6 }}>
    <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras}
      speciesList=${spList} count=${filtered.length} camName=${camName}>
      <${Select} value=${newestFirst ? "new" : "old"} onChange=${(v) => setNewestFirst(v === "new")}
        aria-label="Sort order"
        options=${[{ value: "new", label: "Newest" }, { value: "old", label: "Oldest" }]} />
      <${Segmented} value=${gridSize} onChange=${setGridSize} options=${[
        { value: "S", label: "S", title: "Small photos" },
        { value: "M", label: "M", title: "Medium photos" },
        { value: "L", label: "L", title: "Large photos" },
      ]} />
      <${Btn} sm variant=${selecting ? "primary" : "ghost"}
        onClick=${() => (selecting ? exitSelect() : setSelecting(true))}>
        ${selecting ? "Cancel" : "Select"}
      </${Btn}>
    </${FilterBar}>

    ${selecting && html`<div className="bulkbar">
      <button className="bulkbar__all" onClick=${toggleAll}>
        ${allShown ? "Clear all" : "Select all " + sorted.length}
      </button>
      <span className="bulkbar__count">${selected.size} selected</span>
      <div className="spacer" />
      <span className="bulkbar__as">Tag as</span>
      <${Select} value=${bulkSpecies} onChange=${setBulkSpecies}
        options=${TAG_OPTIONS.map((s) => ({ value: s, label: s }))} />
      <${Btn} sm variant="primary" icon="tag" disabled=${!selected.size} onClick=${applyBulk}>
        Tag ${selected.size || ""}
      </${Btn}>
    </div>`}

    ${sorted.length === 0
      ? html`<${Empty} icon="search" title="No matching photos"
          message="Try removing a filter to see more."
          action=${html`<${Btn} variant="primary" sm onClick=${() => setFilter({ species: "All", camera: "All", tod: "all", bucksOnly: false })}>Clear filters</${Btn}>`} />`
      : html`<${Fragment}>
          ${groups.map((g) => html`<section key=${g.key} className="dayblock">
            <h2 className="dayblock__head">${g.label}</h2>
            <div className=${`shots size-${gridSize}`}>
              ${g.items.map(({ capture: c, count }) => html`<${Shot} key=${c.id} capture=${c} burst=${count}
                species=${effectiveSpecies(c, ov)} cameraLabel=${camName(c.camera)} timeLabel=${fmtTime(c.date)}
                selectable=${selecting} selected=${selected.has(c.id)}
                onClick=${selecting ? () => toggle(c.id) : () => openLightbox(sorted, sorted.indexOf(c))} />`)}
            </div>
          </section>`)}
          ${shown < items.length && html`<div className="loadmore">
            <${Btn} onClick=${() => setShown((n) => n + PAGE)}>Show more</${Btn}>
          </div>`}
        </${Fragment}>`}
  </div>`;
}
