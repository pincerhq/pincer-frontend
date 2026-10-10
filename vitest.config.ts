import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Pinned so the due-bucket tests mean something.
 *
 * FE-2's O7 asserts that "this week" is seven calendar days across a DST change.
 * On a UTC CI box that assertion passes for the wrong reason — there is no
 * change to cross — and the bug it guards against ships. Berlin is where the
 * users are and where the clock actually moves.
 */
process.env.TZ = 'Europe/Berlin';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      include: ['src/stores/**', 'src/lib/docs/**'],
    },
  },
});
