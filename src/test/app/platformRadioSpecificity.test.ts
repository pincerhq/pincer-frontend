/**
 * platform.css gives Radix-style radios a default frame and ink text. As
 * `.platform [role='radio']` (specificity 0,2,0) it outranked every utility
 * class (0,1,0), so a radio that set its own colours lost them — the selected
 * telephony period chip rendered ink text on its ink fill and went blank.
 * Defaults like these must carry zero specificity (`:where(…)`), so an
 * explicit class on the element always wins.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '../../styles/platform.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** A selector list split on its top-level commas (not those inside :where(…)). */
const splitList = (list: string) => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, list.slice(start)];
};

/** Every selector that targets role=radio. */
const radioSelectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
  .flatMap((m) => splitList(m[1]))
  .map((s) => s.trim().replace(/\s+/g, ' '))
  .filter((s) => /\[role='radio'\]/.test(s));

/** Selector with every :where(…) group removed — what is left carries specificity. */
const specificPart = (selector: string) => {
  let out = '';
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    if (depth === 0 && selector.startsWith(':where(', i)) {
      depth = 1;
      i += ':where('.length - 1;
      continue;
    }
    if (depth > 0) {
      if (selector[i] === '(') depth++;
      if (selector[i] === ')') depth--;
      continue;
    }
    out += selector[i];
  }
  return out.trim();
};

describe('platform radio defaults', () => {
  it('exist (the guard below is not vacuous)', () => {
    expect(radioSelectors.length).toBeGreaterThan(0);
  });

  it.each(radioSelectors)('%s carries zero specificity', (selector) => {
    expect(specificPart(selector)).toBe('');
  });
});
