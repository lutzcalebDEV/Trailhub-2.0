// Vale Trails — icon set. Stroke-based inline SVGs (feather/lucide style).
import { html } from "./react.js";

const P = {
  dashboard: html`<g><rect x="3" y="3" width="7" height="9" rx="1.6"/><rect x="14" y="3" width="7" height="5" rx="1.6"/><rect x="14" y="12" width="7" height="9" rx="1.6"/><rect x="3" y="16" width="7" height="5" rx="1.6"/></g>`,
  images: html`<g><rect x="3" y="3" width="18" height="18" rx="2.6"/><circle cx="8.5" cy="8.5" r="1.7"/><path d="m21 15-5-5L5 21"/></g>`,
  map: html`<g><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></g>`,
  chart: html`<g><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6" rx="1"/><rect x="12" y="6.5" width="3" height="10.5" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/></g>`,
  scan: html`<g><path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7"/><path d="M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7"/><path d="M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17"/><path d="M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17"/><circle cx="12" cy="12" r="3.2"/></g>`,
  camera: html`<g><path d="M3 8.5A2 2 0 0 1 5 6.5h1.6l1.1-2h8.6l1.1 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.2"/></g>`,
  sun: html`<g><circle cx="12" cy="12" r="4"/><path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2 12h2.2M19.8 12H22M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></g>`,
  moon: html`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>`,
  thermo: html`<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z"/>`,
  download: html`<g><path d="M12 3v12"/><path d="m7 10.5 5 5 5-5"/><path d="M5 21h14"/></g>`,
  x: html`<path d="M6 6l12 12M18 6 6 18"/>`,
  chevronDown: html`<path d="m6 9 6 6 6-6"/>`,
  chevronLeft: html`<path d="m15 6-6 6 6 6"/>`,
  chevronRight: html`<path d="m9 6 6 6-6 6"/>`,
  search: html`<g><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></g>`,
  sliders: html`<g><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2.1" fill="var(--surface)"/><circle cx="16" cy="12" r="2.1" fill="var(--surface)"/><circle cx="11" cy="18" r="2.1" fill="var(--surface)"/></g>`,
  check: html`<path d="m5 12.5 4.5 4.5L19 7"/>`,
  checkCircle: html`<g><circle cx="12" cy="12" r="9"/><path d="m8.3 12.3 2.5 2.5 4.9-5.2"/></g>`,
  archive: html`<g><rect x="3" y="4" width="18" height="4.2" rx="1.2"/><path d="M5 8.2V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.2"/><path d="M10 12h4"/></g>`,
  refresh: html`<g><path d="M20.5 12a8.5 8.5 0 1 1-2.4-5.9"/><path d="M20.5 3v5h-5"/></g>`,
  layers: html`<g><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></g>`,
  calendar: html`<g><rect x="3" y="4.5" width="18" height="16" rx="2.6"/><path d="M3 9.2h18M8 2.5v4M16 2.5v4"/></g>`,
  clock: html`<g><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></g>`,
  mountains: html`<path d="m2.5 20 6-10 3.5 5.5L15.5 10l6 10Z"/>`,
  target: html`<g><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.7" fill="currentColor"/></g>`,
  arrowUp: html`<path d="M12 19V5M6 11l6-6 6 6"/>`,
  arrowDown: html`<path d="M12 5v14M6 13l6 6 6-6"/>`,
  arrowRight: html`<path d="M5 12h14M13 6l6 6-6 6"/>`,
  menu: html`<path d="M3 6h18M3 12h18M3 18h18"/>`,
  trash: html`<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12.1a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L18 7"/>`,
  info: html`<g><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.2"/></g>`,
  external: html`<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>`,
  sparkle: html`<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/>`,
  eye: html`<g><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></g>`,
  paw: html`<g><circle cx="6.5" cy="12.5" r="1.7"/><circle cx="10" cy="9" r="1.7"/><circle cx="14" cy="9" r="1.7"/><circle cx="17.5" cy="12.5" r="1.7"/><path d="M8.2 16.4c0-2 1.7-3.4 3.8-3.4s3.8 1.4 3.8 3.4-1.7 2.6-3.8 2.6-3.8-.6-3.8-2.6Z"/></g>`,
  grid: html`<g><rect x="3" y="3" width="8" height="8" rx="1.6"/><rect x="13" y="3" width="8" height="8" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/><rect x="13" y="13" width="8" height="8" rx="1.6"/></g>`,
  columns: html`<g><rect x="3" y="3" width="8" height="12" rx="1.6"/><rect x="13" y="3" width="8" height="7" rx="1.6"/><rect x="3" y="17" width="8" height="4" rx="1.6"/><rect x="13" y="12" width="8" height="9" rx="1.6"/></g>`,
  inbox: html`<g><path d="M3 13h4.5l1.6 2.6h5.8L16.5 13H21"/><path d="M5.5 5h13l2.5 8v5.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V13Z"/></g>`,
  bolt: html`<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>`,
  pin: html`<g><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></g>`,
  pencil: html`<g><path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"/><path d="M13.5 6.5l4 4"/></g>`,
  tag: html`<g><path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l8.5 8.5a1.5 1.5 0 0 1 0 2.1l-6.9 6.9a1.5 1.5 0 0 1-2.1 0L3 12Z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/></g>`,
  star: html`<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z"/>`,
  note: html`<g><path d="M5 3.5h9L19 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M13.5 3.5V9H19"/><path d="M7.5 12.5h7M7.5 15.5h5"/></g>`,
};

export function Icon({ name, size = 18, className = "", strokeWidth = 1.9 }) {
  return html`<svg
    width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth=${strokeWidth}
    strokeLinecap="round" strokeLinejoin="round"
    className=${className} aria-hidden="true"
  >${P[name] || null}</svg>`;
}

// The Vale Trails brand mark — mountains + trail inside a rounded badge tile.
export function BrandMark({ size = 38 }) {
  const inner = Math.round(size * 0.62);
  return html`<span className="brand__mark" style=${{ width: size, height: size }}>
    <svg width=${inner} height=${inner} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2.5 19 5.5-9 3 4.5L18 7l3.5 12Z"/>
      <path d="M2.5 19c3.5 0 4.5-2 7-2s3.5 2 7 2" opacity="0.55"/>
    </svg>
  </span>`;
}
