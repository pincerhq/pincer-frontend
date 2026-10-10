# 3Days.ai — frontend

React + TypeScript + Vite front end for the Pincer platform: a sign-in flow, the
platform screens (Dashboard, Chat, Tasks, Company Brain, Integrations), the
Notes app, and the Telephony owner app.

Every screen in here reads an endpoint the backend actually serves. Surfaces
whose API does not exist were removed rather than left rendering demo data —
`npm run count-mocks` holds that line in CI.

## Requirements

- Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

## Getting started

```sh
npm install
npm run dev
```

The dev server runs on **:3000** (`strictPort`).

### Backends

| App       | Service                                   | Configure with           |
| --------- | ----------------------------------------- | ------------------------ |
| Platform  | `pincer` (`/api/*`)                        | `VITE_PINCER_API_URL` (default: same origin) |
| Telephony | `pincer` (`/api/voice/*`)                  | `VITE_PINCER_API_URL` (default: same origin) |
| Notes     | `pincer_extensions/notes_app` (`:8000`)    | `VITE_NOTES_API_URL`     |

### Environment

| Variable              | Default       | What it does |
| --------------------- | ------------- | ------------ |
| `VITE_PINCER_API_URL` | page origin   | The Pincer API both login pages sign in against |
| `VITE_NOTES_API_URL`  | —             | Base URL of the Notes service (required for `/notes`) |
| `VITE_NOTES_TOKEN`    | —             | A credential for the Notes service, when it does not accept the Pincer session's token |
| `SIGNUP_ALLOWED`      | `false`       | `true` adds the `/signup` request-access page (build-time) |

Sign-in is a Pincer identity's name or email plus password — see
[`docs/app/login.md`](docs/app/login.md). There is no token or password to put
in an env file; anything prefixed `VITE_` or `SIGNUP_` ends up in the bundle.

Notes calls are same-origin-proxied in dev: point `VITE_NOTES_API_URL` at
`/notes-api` in `.env.local` to use the proxy, and override the upstream with
`NOTES_API_TARGET` if the service is not on `:8000`.

## Scripts

| Command                  | What it does                                             |
| ------------------------ | -------------------------------------------------------- |
| `npm run dev`            | Dev server on :3000                                       |
| `npm run build`          | Production build                                          |
| `npm test`               | Unit tests (vitest)                                       |
| `npm run e2e`            | End-to-end tests (playwright)                             |
| `npm run lint`           | ESLint over the repo                                      |
| `npm run type-check`     | `tsc --noEmit` over the app                               |
| `npm run i18n:check`     | Owner-app translations complete in de/en, no unused keys  |
| `npm run count-mocks`    | Fails if a mocked surface appears without its badge       |
| `npm run check:api`      | Frontend contract vs. the pinned pincer commit            |
| `npm run check:bundle`   | Owner-app initial JS budget                               |
| `npm run ci:voice`       | The full gate, in CI order                                |

## Tech

Vite · TypeScript · React · shadcn-ui · Tailwind CSS · TanStack Query · i18next
