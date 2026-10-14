/**
 * One colour token set, on the document root.
 *
 * Radix renders dialogs, dropdowns and popovers into document.body — outside
 * `.platform` / `.plat` / `.site3d` — so a token defined on a scope never
 * reaches a portal. The fix is a single light definition on `:root` that every
 * surface inherits; a scope quietly re-declaring a fixed light set is how the
 * portals drifted from the pages in the first place, so it is pinned here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '../..');

const PLATFORM_TOKENS = [
  '--bg', '--paper', '--sand', '--sand-deep', '--ink',
  '--brand', '--brand-hover', '--brand-100', '--brand-200', '--on-brand', '--on-ink',
  '--text-1', '--text-2', '--text-3', '--text-4', '--text-5',
  '--ok-bg', '--ok-fg', '--warn-bg', '--warn-fg', '--bad-fg',
  '--line', '--line-soft',
];

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full, ext);
    return ext.test(e.name) ? [full] : [];
  });
}

/** Every innermost `selector { … }` rule with the custom properties it declares. */
function rules(): Array<{ file: string; selector: string; props: string[] }> {
  return files(SRC, /\.css$/).flatMap((file) => {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      file: path.relative(SRC, file),
      selector: m[1].trim().replace(/\s+/g, ' '),
      props: [...m[2].matchAll(/(--[\w-]+)\s*:/g)].map((d) => d[1]),
    }));
  });
}

/** Where each token gets a light value: every rule declaring it outside `.dark`. */
function lightDeclarations(token: string): string[] {
  return rules()
    .filter((r) => r.props.includes(token) && !r.selector.includes('.dark'))
    .map((r) => `${r.file} ${r.selector}`);
}


/** shadcn HSL variable → the palette token it is derived from. */
const SHADCN_SOURCE: Record<string, string> = {
  '--background': '--bg', '--foreground': '--ink',
  '--card': '--paper', '--card-foreground': '--ink',
  '--popover': '--paper', '--popover-foreground': '--ink',
  '--primary': '--ink', '--primary-foreground': '--on-ink',
  '--secondary': '--sand', '--secondary-foreground': '--ink',
  '--muted': '--sand', '--muted-foreground': '--text-3',
  '--accent': '--sand', '--accent-foreground': '--ink',
  '--destructive': '--bad-fg', '--destructive-foreground': '--on-brand',
  '--border': '--line', '--input': '--line', '--ring': '--brand',
  '--sidebar-background': '--bg', '--sidebar-foreground': '--text-1',
  '--sidebar-primary': '--ink', '--sidebar-primary-foreground': '--on-ink',
  '--sidebar-accent': '--sand', '--sidebar-accent-foreground': '--ink',
  '--sidebar-border': '--line', '--sidebar-ring': '--brand',
};

/** The light :root block of index.css as name → raw value. */
function rootValues(): Record<string, string> {
  const css = readFileSync(path.join(SRC, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const body = css.match(/:root\s*\{([^}]*)\}/)![1];
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** "h s% l%" → [r, g, b] in 0..255. */
function hslRgb(triplet: string): number[] {
  const [h, s, l] = triplet.split(/\s+/).map((v) => parseFloat(v));
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

describe('colour tokens', () => {
  it.each(PLATFORM_TOKENS)('%s has exactly one light definition, on :root', (token) => {
    expect(lightDeclarations(token)).toEqual(['index.css :root']);
  });

  it('no scope re-declares any root token in light mode (shadcn variables included)', () => {
    const root = rules().find((r) => r.file === 'index.css' && r.selector === ':root');
    const redeclared = (root?.props ?? []).flatMap((token) =>
      lightDeclarations(token).filter((d) => d !== 'index.css :root').map((d) => `${token} in ${d}`),
    );
    expect(root?.props).toEqual(expect.arrayContaining(['--background', '--border', '--ring', '--radius']));
    expect(redeclared).toEqual([]);
  });


  it.each(Object.entries(SHADCN_SOURCE))('shadcn %s is derived from %s', (shadcn, source) => {
    const root = rootValues();
    const hex = root[source];
    expect(hex, `${source} must be a hex colour to derive from`).toMatch(/^#[0-9a-f]{6}$/i);
    const derived = hslRgb(root[shadcn]);
    hexRgb(hex).forEach((channel, i) => expect(Math.abs(derived[i] - channel), `${shadcn} vs ${source} ${hex}`).toBeLessThanOrEqual(1));
  });

  it('nothing references the old blue token names', () => {
    const hits = files(SRC, /\.(css|tsx?)$/)
      .filter((f) => !f.endsWith('colorTokens.test.ts'))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .flatMap((line, i) => (/--blue\b/.test(line) ? [`${path.relative(SRC, f)}:${i + 1}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
