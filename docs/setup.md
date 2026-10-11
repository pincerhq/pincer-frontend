# Setup & Development

## Prerequisites

- [Bun](https://bun.sh/) (preferred) or Node.js 18+
- Git

## Install Dependencies

```bash
bun install
# or
npm install
```

## Start Dev Server

```bash
bun run dev
# or
npm run dev
```

Dev server runs at **http://localhost:8080**

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite` | Start dev server with HMR |
| `build` | `vite build` | Production build to `dist/` |
| `preview` | `vite preview` | Preview the production build locally |
| `lint` | `eslint .` | Run ESLint |

## Build

```bash
bun run build
```

Output is placed in `dist/`. The build uses SWC for fast TypeScript/JSX compilation.

## Preview Production Build

```bash
bun run preview
```

## Environment & Config Files

| File | Purpose |
|------|---------|
| `vite.config.ts` | Vite bundler config (dev server port, path aliases, plugins) |
| `tsconfig.json` | Base TypeScript config |
| `tsconfig.app.json` | App TypeScript config (ES2020 target, strict mode off) |
| `tailwind.config.ts` | Tailwind theme, dark mode, custom colors |
| `postcss.config.js` | PostCSS (used by Tailwind) |
| `eslint.config.js` | ESLint rules |
| `components.json` | shadcn/ui configuration (base color: slate) |

## Path Alias

The `@/` alias maps to `src/`. Use it for all imports:

```ts
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
```

## Authentication (Dev/Demo)

Sign-in is real: `/login` and `/telephony/login` post a Pincer identity's name or email and password to the API at `VITE_PINCER_API_URL` (default: this app's origin). There are no demo credentials and no flag to set in DevTools. Create an identity on the API side first:

```sh
cd ../pincer
uv run pincer identity create alice --email alice@example.com --display-name Alice
uv run pincer identity set-password alice
PINCER_VOICE_ENABLED=1 uv run pincer run
```

Then put `VITE_PINCER_API_URL=http://localhost:<api port>` in `.env.local` and run `npm run dev` (port 3000 is on the API's dev CORS list). In a container the same variable is set at container start, not at build time. See `docs/app/login.md`.
