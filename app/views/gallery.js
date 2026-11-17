// Vale Trails — Photos: every photo, grouped by day, one tile per trigger.
import { html, useState, useMemo, useEffect, useRef, Fragment } from "../react.js";
import { FilterBar, defaultFilters } from "../shell.js";
import { Segmented, Select, Shot, Empty, Btn } from "../ui.js";
import { effectiveSpecies, TAG_OPTIONS, fmtDateLong, fmtTime, isoDay } from "../core.js";
import { collapseBursts } from "../analytics.js";

const PAGE = 120;
let keptShown = PAGE;

function dayLabel(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isoDay(date) === isoDay(new Date())) return "Today";
  if (isoDay(date) === isoDay(yesterday)) return "Yesterday";
  return fmtDateLong(date);
}

// [{ key, label, items }] in display order; items keep their incoming order.
export function groupByDay(items) {
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
  // Kept when leaving the tab, so Back returns to the same spot in a long list.
  const [shown, setShown] = useState(() => keptShown);
  const firstRun = useRef(true);
  useEffect(() => { keptShown = shown; }, [shown]);
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
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setShown(PAGE);
  }, [filtered, newestFirst]);

  // More photos load as the end of the list comes near, the way photo apps scroll.
  // The "Show more" button stays as the fallback (and for keyboards).
  const moreRef = useRef(null);
  const more = shown < items.length;
  useEffect(() => {
    const el = moreRef.current;
    if (!more || !el || typeof IntersectionObserver !== "function") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
    }, { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown]);

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

  // Sort order and photo size sit on the bar on a computer. A phone has no room for
  // them there (they pushed the photos half a screen down), so it shows them in the
  // Filters sheet, each with its name.
  const sortSelect = html`<${Select} value=${newestFirst ? "new" : "old"} onChange=${(v) => setNewestFirst(v === "new")}
    aria-label="Sort order"
    options=${[{ value: "new", label: "Newest first" }, { value: "old", label: "Oldest first" }]} />`;
  const sizeOptions = (labels) => [
    { value: "S", icon: "gridSmall", label: labels && "Small", title: "Small photos: more on screen" },
    { value: "M", icon: "grid", label: labels && "Medium", title: "Medium photos" },
    { value: "L", icon: "gridLarge", label: labels && "Large", title: "Large photos: one per row on a phone" },
  ];
  const sheetExtras = html`<${Fragment}>
    <div className="field-row"><span>Sort</span>${sortSelect}</div>
    <div className="field-row"><span>Photo size</span>
      <${Segmented} value=${gridSize} onChange=${setGridSize} label="Photo size" options=${sizeOptions(true)} />
    </div>
  </${Fragment}>`;
  const bulkbar = selecting && html`<div className="bulkbar">
    <button className="bulkbar__all" onClick=${toggleAll}>
      ${allShown ? "Clear all" : "Select all " + sorted.length}
    </button>
    <span className="bulkbar__count">${selected.size} selected</span>
    <div className="spacer" />
    <span className="bulkbar__as">Tag as</span>
    <${Select} value=${bulkSpecies} onChange=${setBulkSpecies} aria-label="Tag as"
      options=${TAG_OPTIONS.map((s) => ({ value: s, label: s }))} />
    <${Btn} sm variant="primary" icon="tag" disabled=${!selected.size} onClick=${applyBulk}>
      Tag ${selected.size || ""}
    </${Btn}>
  </div>`;

  return html`<div className="col" style=${{ gap: 6 }}>
    <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras}
      speciesList=${spList} count=${filtered.length} camName=${camName}
      quick sheetExtras=${sheetExtras} below=${bulkbar}>
      <span className="filterbar__wide">
        ${sortSelect}
        <${Segmented} value=${gridSize} onChange=${setGridSize} label="Photo size" options=${sizeOptions(false)} />
      </span>
      <${Btn} sm variant=${selecting ? "primary" : "ghost"}
        onClick=${() => (selecting ? exitSelect() : setSelecting(true))}>
        ${selecting ? "Cancel" : "Select"}
      </${Btn}>
    </${FilterBar}>

    ${sorted.length === 0
      ? html`<${Empty} icon="search" title="No matching photos"
          message="Try removing a filter to see more."
          action=${html`<${Btn} variant="primary" sm onClick=${() => setFilter(defaultFilters())}>Clear filters</${Btn}>`} />`
      : html`<${Fragment}>
          ${groups.map((g) => html`<section key=${g.key} className="dayblock">
            <h2 className="dayblock__head">${g.label}</h2>
            <div className=${`shots size-${gridSize}`}>
              ${g.items.map(({ capture: c, count }) => html`<${Shot} key=${c.id} capture=${c} burst=${count}
                species=${effectiveSpecies(c, ov)} cameraLabel=${camName(c.camera)} timeLabel=${fmtTime(c.date)}
                selectable=${selecting} selected=${selected.has(c.id)}
                onLongPress=${selecting ? undefined : () => { setSelecting(true); setSelected(new Set([c.id])); }}
                onClick=${selecting ? () => toggle(c.id) : () => openLightbox(sorted, sorted.indexOf(c))} />`)}
            </div>
          </section>`)}
          ${shown < items.length && html`<div className="loadmore" ref=${moreRef}>
            <${Btn} onClick=${() => setShown((n) => n + PAGE)}>Show more</${Btn}>
          </div>`}
        </${Fragment}>`}
  </div>`;
}
