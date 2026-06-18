// Vale Trails — Gallery: every capture with shared filters, sizing and sorting.
import { html, useState, useMemo } from "../react.js";
import { FilterBar } from "../shell.js";
import { Segmented, Select, Shot, Empty, Btn } from "../ui.js";
import { effectiveSpecies } from "../core.js";

const SORTS = {
  new: { label: "Newest", fn: (a, b) => b.date - a.date },
  old: { label: "Oldest", fn: (a, b) => a.date - b.date },
  cam: { label: "Camera", fn: (a, b) => a.camera.localeCompare(b.camera) || b.date - a.date },
};

export function Gallery(app) {
  const { filtered, filters, setFilter, spList, data, ov, gridSize, setGridSize, gridLayout, setGridLayout, openLightbox } = app;
  const [sort, setSort] = useState("new");

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort(SORTS[sort].fn);
    return arr;
  }, [filtered, sort]);

  return html`<div className="col" style=${{ gap: 4 }}>
    <${FilterBar} filters=${filters} set=${setFilter} cameras=${data.cameras}
      speciesList=${spList} count=${filtered.length} />

    <div className="row wrap" style=${{ marginBottom: 16 }}>
      <${Select} value=${sort} onChange=${setSort}
        options=${Object.entries(SORTS).map(([value, s]) => ({ value, label: "Sort · " + s.label }))} />
      <div className="spacer" />
      <${Segmented} value=${gridLayout} onChange=${setGridLayout} options=${[
        { value: "grid", icon: "grid", title: "Grid" },
        { value: "masonry", icon: "columns", title: "Masonry" },
      ]} />
      <${Segmented} value=${gridSize} onChange=${setGridSize} options=${[
        { value: "S", label: "S" }, { value: "M", label: "M" }, { value: "L", label: "L" },
      ]} />
    </div>

    ${sorted.length === 0
      ? html`<${Empty} icon="search" title="No matching captures"
          message="Try widening your filters — clear a species, camera or time-of-day filter to see more."
          action=${html`<${Btn} variant="primary" sm onClick=${() => setFilter({ q: "", species: "All", camera: "All", tod: "all", bucksOnly: false })}>Clear filters</${Btn}>`} />`
      : html`<div className=${`shots size-${gridSize} ${gridLayout === "masonry" ? "is-masonry" : ""}`}>
          ${sorted.map((c, i) => html`<${Shot} key=${c.id} capture=${c}
            species=${effectiveSpecies(c, ov)} onClick=${() => openLightbox(sorted, i)} />`)}
        </div>`}
  </div>`;
}
