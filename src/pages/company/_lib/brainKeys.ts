/**
 * Local inventory of memory keys taught through this console.
 *
 * memento has no "list keys" tool — the server can store/read/forget by key
 * but cannot enumerate. So the console keeps its own registry of every key
 * taught (or inspected successfully) here, clearly labelled in the UI. When
 * memento grows a list tool, this becomes a cache instead of the source.
 */

export interface BrainKey {
  key: string;
  /** Last content this console stored (inspection may show newer server state). */
  lastContent: string;
  updated: string;
}

const KEYS_KEY = 'company.brain.keys';

export function loadKeys(): BrainKey[] {
  try {
    return JSON.parse(localStorage.getItem(KEYS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function upsertKey(key: string, lastContent: string): BrainKey[] {
  const rest = loadKeys().filter((k) => k.key !== key);
  const next = [{ key, lastContent, updated: new Date().toISOString() }, ...rest];
  localStorage.setItem(KEYS_KEY, JSON.stringify(next));
  return next;
}

export function dropKey(key: string): BrainKey[] {
  const next = loadKeys().filter((k) => k.key !== key);
  localStorage.setItem(KEYS_KEY, JSON.stringify(next));
  return next;
}
