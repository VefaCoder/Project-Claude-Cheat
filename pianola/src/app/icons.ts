// Inline SVG icons (24px grid, stroke based).
const svg = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${body}</svg>`

export const icons = {
  play: svg('<path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.5-6.8c.6-.4.6-1.3 0-1.7L9.6 4.3C8.9 3.9 8 4.4 8 5.2z"/>', true),
  pause: svg('<rect x="6.5" y="4.5" width="4" height="15" rx="1.2"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.2"/>', true),
  restart: svg('<path d="M6 5v14"/><path d="M18 6.2v11.6c0 .7-.8 1.1-1.4.7L9 13a1.2 1.2 0 0 1 0-2l7.6-5.5c.6-.4 1.4 0 1.4.7z"/>'),
  sparkles: svg('<path d="M12 3.5l1.6 4.3 4.4 1.7-4.4 1.7L12 15.5l-1.6-4.3L6 9.5l4.4-1.7z"/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path d="M5.5 15l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/>'),
  film: svg('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M8 4.5V9M16 4.5V9"/><path d="M10.5 12.5v4l3.5-2z"/>'),
  run: svg('<path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.5-6.8c.6-.4.6-1.3 0-1.7L9.6 4.3C8.9 3.9 8 4.4 8 5.2z"/>', true),
  open: svg('<path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z"/>'),
  save: svg('<path d="M5 3.5h11l3.5 3.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 3.5v5h8v-5M7.5 20.5v-6h9v6"/>'),
  book: svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>'),
  volume: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
  hall: svg('<path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M3 17c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" opacity=".5"/><path d="M3 7c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" opacity=".5"/>'),
  speed: svg('<path d="M12 4v9"/><path d="M8.5 9.5L12 13l3.5-3.5"/><path d="M5 19.5h14"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>'),
  paste: svg('<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.8c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3v.7"/><path d="M9 11h6M9 15h4"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  warn: svg('<path d="M12 4.5l9 15.5H3z"/><path d="M12 10v4.5M12 17.3v.2"/>'),
  error: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  chevron: svg('<path d="M7 10l5 5 5-5"/>'),
}

export const logo = `<svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa8ff"/><stop offset="1" stop-color="#8a6cff"/></linearGradient></defs>
  <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#lg)"/>
  <rect x="14" y="12" width="8" height="22" rx="4" fill="#fff" opacity=".95"/>
  <rect x="28" y="20" width="8" height="14" rx="4" fill="#fff" opacity=".75"/>
  <rect x="42" y="9" width="8" height="25" rx="4" fill="#fff" opacity=".9"/>
  <rect x="10" y="40" width="44" height="14" rx="3" fill="#fff"/>
  <path d="M21 40v9M32 40v9M43 40v9" stroke="#2b2f55" stroke-width="5" stroke-linecap="round"/>
</svg>`
