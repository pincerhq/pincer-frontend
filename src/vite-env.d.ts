/// <reference types="vite/client" />

interface Window {
  /** Runtime configuration from `/config.js`. Read it through `src/lib/env.ts`. */
  __ENV__?: Record<string, string>;
}
