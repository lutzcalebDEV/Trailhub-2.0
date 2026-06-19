// Vale Trails — Gallery: every capture with shared filters, sizing and sorting.
import { html, useState, useMemo } from "../react.js";
import { FilterBar } from "../shell.js";
import { Segmented, Select, Shot, Empty, Btn } from "../ui.js";
import { effectiveSpecies, TAG_OPTIONS } from "../core.js";

const SORTS = {
  new: { label: "Newest", fn: (a, b) => b.date - a.date },
  old: { label: "Oldest", fn: (a, b) => a.date - b.date },
  cam: { label: "Camera", fn: (a, b) => a.camera.localeCompare(b.camera) || b.date - a.date },
};

export function Gallery(app) {
  const {
    filtered, filters, setFilter, spList, data, ov,
    gridSize, setGridSize, gridLayout, setGridLayout,
    openLightbox, camName, bulkAssign,
  } = app;
  const [sort, setSort] = useState("new");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkSpecies, setBulkSpecies] = useState("Deer");

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort(SORTS[sort].fn);
    return arr;
  }, [filtered, sort]);

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

  return html`<div className="col" style=${{ gap: 4 }}>
    <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras}
      speciesList=${spList} count=${filtered.length} camName=${camName} />

    <div className="row wrap" style=${{ marginBottom: 16 }}>
      <${Select} value=${sort} onChange=${setSort}
        options=${Object.entries(SORTS).map(([value, s]) => ({ value, label: "Sort · " + s.label }))} />
      <${Btn} sm variant=${selecting ? "primary" : "ghost"} icon=${selecting ? "x" : "check"}
        onClick=${() => (selecting ? exitSelect() : setSelecting(true))}>
        ${selecting ? "Cancel" : "Select"}
      </${Btn}>
      <div className="spacer" />
      <${Segmented} value=${gridLayout} onChange=${setGridLayout} options=${[
        { value: "grid", icon: "grid", title: "Grid" },
        { value: "masonry", icon: "columns", title: "Masonry" },
      ]} />
      <${Segmented} value=${gridSize} onChange=${setGridSize} options=${[
        { value: "S", label: "S" }, { value: "M", label: "M" }, { value: "L", label: "L" },
      ]} />
    </div>

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
      ? html`<${Empty} icon="search" title="No matching captures"
          message="Try widening your filters — clear a species, camera or time-of-day filter to see more."
          action=${html`<${Btn} variant="primary" sm onClick=${() => setFilter({ q: "", species: "All", camera: "All", tod: "all", bucksOnly: false })}>Clear filters</${Btn}>`} />`
      : html`<div className=${`shots size-${gridSize} ${gridLayout === "masonry" ? "is-masonry" : ""}`}>
          ${sorted.map((c, i) => html`<${Shot} key=${c.id} capture=${c}
            species=${effectiveSpecies(c, ov)} cameraLabel=${camName(c.camera)}
            selectable=${selecting} selected=${selected.has(c.id)}
            onClick=${selecting ? () => toggle(c.id) : () => openLightbox(sorted, i)} />`)}
        </div>`}
  </div>`;
}
