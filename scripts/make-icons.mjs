/**
 * Renders the app icons (public/icons/) from one SVG design: a lime barbell on black.
 * The PNGs are committed, so this only runs when the icon changes.
 *
 *   npm run icons
 *   BROWSER="/path/to/Chrome or Brave" npm run icons
 *
 * Uses a headless Chromium-based browser's --screenshot (defaults to Brave on macOS).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/icons/", import.meta.url));
const BROWSER = process.env.BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const LIME = "#c6f432";

/** A barbell (Tabler "barbell" geometry), drawn in a 24-unit box and scaled. `pad` leaves room for maskable crops. */
function svg(size, pad) {
  const inner = size * (1 - pad * 2);
  const scale = inner / 24;
  const offset = size * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#000"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${LIME}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12h1"/><path d="M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2"/>
    <path d="M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z"/>
    <path d="M9 12h6"/>
    <path d="M15 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z"/>
    <path d="M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2"/><path d="M22 12h-1"/>
  </g>
</svg>`;
}

const tmp = mkdtempSync(join(tmpdir(), "gym-icons-"));

function render(name, size, pad) {
  const html = join(tmp, `${name}.html`);
  writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:#000}</style>${svg(size, pad)}`);
  execFileSync(BROWSER, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${size},${size}`,
    `--screenshot=${join(OUT, name)}`,
    `file://${html}`,
  ], { stdio: "ignore" });
  console.log("wrote", name);
}

writeFileSync(join(OUT, "favicon.svg"), svg(64, 0.1));
render("icon-192.png", 192, 0.16);
render("icon-512.png", 512, 0.16);
render("icon-512-maskable.png", 512, 0.24);
render("apple-touch-icon.png", 180, 0.16);
