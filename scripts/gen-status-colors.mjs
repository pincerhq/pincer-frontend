#!/usr/bin/env node
// `node scripts/gen-status-colors.mjs` — writes src/styles/status-colors.css.
//
// The status and categorical hues (red, amber, green, emerald, blue, sky,
// zinc) stay Tailwind classes in the components; tailwind.config.ts points
// each one at a CSS variable per role instead of a fixed colour:
//
//   text-X-n   → --st-X-n        (type, icons, strokes)
//   bg-X-n     → --st-X-n-bg     (surfaces, fills, dots; also ring/accent/fill)
//   border-X-n → --st-X-n-line   (borders)
//
// (`st-` keeps them clear of the retired `--blue-*` palette tokens.)
//
// Light values are Tailwind's own, byte for byte, except a few type shades
// that fail AA on the light surfaces (LIGHT_TYPE_FLOOR below).
// Dark values are derived here: type turns light enough to clear WCAG AA on
// the dark surfaces it sits on, pale surfaces become deep tints of the hue,
// and saturated fills (400 and up) keep their colour.
//
// A status badge with type on it does not use these: it takes a fill token and
// its paired type (--ok-fill / --on-ok-fill, … in src/index.css), so the pair
// is designed and checked together.
import { writeFileSync } from 'node:fs';
import colors from 'tailwindcss/colors.js';

const HUES = ['red', 'amber', 'green', 'emerald', 'blue', 'sky', 'zinc'];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Dark surfaces status type has to read on (src/index.css html.dark).
const DARK_PAPER = '#20241f';
const DARK_BG = '#181b17';
const DARK_SAND = '#262b25';

// How much of the hue a pale surface / border gets when it turns dark.
const SURFACE_TINT = { 50: 0.16, 100: 0.22, 200: 0.3, 300: 0.4 };
const LINE_TINT = { 50: 0.2, 100: 0.28, 200: 0.38, 300: 0.5 };

const AA = 4.5;

// Light surfaces status type sits on (src/index.css :root), plus its own -50 chip.
const LIGHT_PAPER = '#ffffff';
const LIGHT_BG = '#fafaf7';
const LIGHT_SAND = '#f4f5ef';

// Light shades the app uses for type (4.5:1) or only for icons (3:1, WCAG
// 1.4.11) whose Tailwind value falls short. Each is darkened to the first
// Tailwind step of its hue that clears the floor; surfaces and borders keep
// Tailwind's value. Which is which comes from the JSX element a class sits on
// (a lucide icon or <svg> vs anything else); a shade used for both counts as
// type. Shades not listed already pass (or are not used for type at all).
const LIGHT_TYPE_FLOOR = {
  'amber-500': 3, // icon only (TranscriptModal)
  'amber-600': AA,
  'green-500': 3, // icons only
  'green-600': AA,
  'red-500': AA,
  'red-600': AA,
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v * (1 - t) + rgb(b)[i] * t));
const triplet = (h) => rgb(h).join(' ');

function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function darkSurface(hue, shade) {
  return shade in SURFACE_TINT ? mix(DARK_PAPER, colors[hue][600], SURFACE_TINT[shade]) : colors[hue][shade];
}

function darkLine(hue, shade) {
  return shade in LINE_TINT ? mix(DARK_PAPER, colors[hue][500], LINE_TINT[shade]) : colors[hue][shade];
}

/** The darkest light step of the hue that reads on every dark status surface. */
function darkText(hue, shade) {
  const grounds = [DARK_PAPER, DARK_BG, DARK_SAND, darkSurface(hue, 50), darkSurface(hue, 100)];
  const start = Math.min(400, 1000 - shade);
  const steps = SHADES.filter((s) => s <= Math.max(start, 50)).reverse();
  for (const s of steps) {
    if (grounds.every((g) => contrast(colors[hue][s], g) >= AA)) return colors[hue][s];
  }
  return colors[hue][50];
}

/** The first step of the hue, from `shade` down the scale, that clears `floor` on every light ground. */
function lightText(hue, shade) {
  const floor = LIGHT_TYPE_FLOOR[`${hue}-${shade}`];
  if (!floor) return colors[hue][shade];
  const grounds = [LIGHT_PAPER, LIGHT_BG, LIGHT_SAND, colors[hue][50]];
  const step = SHADES.filter((s) => s >= shade).find((s) => grounds.every((g) => contrast(colors[hue][s], g) >= floor));
  return colors[hue][step];
}

function block(selector, entries) {
  return `${selector} {\n${entries.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
}

const light = [];
const dark = [];
for (const hue of HUES) {
  for (const shade of SHADES) {
    const base = colors[hue][shade];
    light.push([`--st-${hue}-${shade}`, triplet(lightText(hue, shade))], [`--st-${hue}-${shade}-bg`, triplet(base)], [`--st-${hue}-${shade}-line`, triplet(base)]);
    dark.push(
      [`--st-${hue}-${shade}`, triplet(darkText(hue, shade))],
      [`--st-${hue}-${shade}-bg`, triplet(darkSurface(hue, shade))],
      [`--st-${hue}-${shade}-line`, triplet(darkLine(hue, shade))],
    );
  }
}

const css = `/* Generated by scripts/gen-status-colors.mjs — edit that, not this.
   Status and categorical hues as themed variables (see the script header). */

${block(':root', light)}
${block('html.dark', dark)}`;

writeFileSync(new URL('../src/styles/status-colors.css', import.meta.url), css);
console.log(`status-colors.css: ${HUES.length} hues × ${SHADES.length} shades × 3 roles`);
