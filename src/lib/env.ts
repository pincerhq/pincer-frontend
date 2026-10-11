/**
 * Runtime configuration: the only place the app reads it from.
 *
 * `/config.js` sets `window.__ENV__` before the bundle runs (see `index.html`).
 * The container writes that file from its environment at start
 * (`docker/40-runtime-env.sh`); the dev server builds it from `.env*`
 * (`vite.config.ts`). Nothing is inlined by Vite, so one build serves every
 * deployment — and everything in it is public, so it may never hold a secret.
 */
export function env(name: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__ENV__?.[name]?.trim() || undefined;
}
