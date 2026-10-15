#!/usr/bin/env node
// `npm run i18n:check` — owner-app namespaces must be complete in de and en
// (Block I rule 3). Fails on any key present in one language and not the
// other; warns on keys no source file references.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'src/i18n/locales';
const LANGS = ['de', 'en'];
const SRC_DIRS = ['src/pages/telephony', 'src/components/voice', 'src/components/account', 'src/components/dashboard', 'src/components/ui', 'src/lib', 'src/stores', 'src/i18n'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const namespaces = readdirSync(join(BASE, 'de', 'voice')).filter((f) => f.endsWith('.json'));
const source = SRC_DIRS.flatMap((d) => {
  try {
    return walk(d);
  } catch {
    return [];
  }
})
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

let failures = 0;
let warnings = 0;
for (const file of namespaces) {
  const per = {};
  for (const lng of LANGS) {
    try {
      per[lng] = flatten(JSON.parse(readFileSync(join(BASE, lng, 'voice', file), 'utf8')));
    } catch (err) {
      console.error(`i18n:check ✗ ${lng}/voice/${file}: ${err.message}`);
      failures++;
      per[lng] = {};
    }
  }
  const all = new Set(LANGS.flatMap((l) => Object.keys(per[l])));
  for (const key of all) {
    for (const lng of LANGS) {
      if (!(key in per[lng])) {
        console.error(`i18n:check ✗ ${lng}/voice/${file} missing "${key}"`);
        failures++;
      } else if (typeof per[lng][key] === 'string' && per[lng][key].trim() === '') {
        console.error(`i18n:check ✗ ${lng}/voice/${file} empty "${key}"`);
        failures++;
      }
    }
  }
  // Unused keys: a key counts as used when its full path, or its top-level
  // section (for dynamic `t(\`${key}.title\`)` lookups), appears in source.
  for (const rawKey of Object.keys(per.de)) {
    // Plural forms (`count_one`, `count_other`) are looked up by their stem.
    const key = rawKey.replace(/_(one|other|zero|few|many)$/, '');
    const head = key.split('.')[0];
    const used = source.includes(`"${key}"`) || source.includes(`'${key}'`) || source.includes(`\`${key}\``) || source.includes(`.${key.split('.').slice(-1)[0]}\``) || source.includes(`"${head}.`) || source.includes(`'${head}.`) || source.includes(`\`${head}.`) || source.includes(`\${surface.key}`) && file === 'placeholders.json';
    if (!used) {
      console.warn(`i18n:check ! voice/${file} "${rawKey}" is not referenced`);
      warnings++;
    }
  }
}

if (failures) {
  console.error(`i18n:check ✗ ${failures} problem(s)`);
  process.exit(1);
}
console.log(`i18n:check ✓ ${namespaces.length} namespace(s) complete in ${LANGS.join('/')}${warnings ? `, ${warnings} unused key warning(s)` : ''}`);
