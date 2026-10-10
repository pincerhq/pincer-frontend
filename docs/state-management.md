# State Management

The app uses a lightweight, pragmatic approach to state — no global Redux or Zustand store. State is scoped to the smallest appropriate layer.

## Layers

### 1. Local Component State — `useState` / `useReducer`

The primary state mechanism. UI state (open/closed modals, form inputs, active tabs, loading flags) lives as `useState` in the component that owns it.

```tsx
const [isOpen, setIsOpen] = useState(false);
const [tab, setTab] = useState<"overview" | "settings">("overview");
```

### 2. URL State — React Router

Route-level state (which page, which entity is selected) is encoded in the URL via React Router v6 params and search params.

```tsx
// Dynamic route: /ai-assistants/:id
const { id } = useParams();
```

### 3. Theme Context — `ThemeContext`

The global theme (light / dark / system) is held in a React context so any component can read and toggle it.

```tsx
// src/contexts/ThemeContext.tsx
const { theme, setTheme } = useTheme();
```

The context persists the theme choice to `localStorage` under the key `theme`.

### 4. Persisted State — `localStorage`

Used for the session and theme preference. Keys:

| Key | Values | Description |
|-----|--------|-------------|
| `pincer.web.auth` | `{apiUrl, token, refreshToken, expiresAt, userId}` | The signed-in session. In `sessionStorage` by default, in `localStorage` only with "remember this device" |
| `theme` | `"light"` / `"dark"` / `"system"` | Active theme |

Never read or write `pincer.web.auth` directly: `src/lib/pincerClient.ts` owns the record and `useSession` (`src/stores/session.ts`) is the single source of truth for "is someone signed in".

```ts
const connected = useSession((s) => s.connected);
const identity = useSession((s) => s.identity); // { id, displayName, email } | null
useSession.getState().logout();
```

### 5. Server State — TanStack React Query

`@tanstack/react-query` is installed and a `QueryClient` is provided at the app root. Use it for any real API calls to avoid manual loading/error state.

```tsx
import { useQuery } from "@tanstack/react-query";

const { data, isLoading } = useQuery({
  queryKey: ["agents"],
  queryFn: () => fetch("/api/agents").then(r => r.json()),
});
```

Currently the app uses mock/static data in most pages. When real endpoints are wired up, migrate those pages to `useQuery`.

---

## What Lives Where

| Type of State | Where to put it |
|---------------|-----------------|
| Open/closed modal | `useState` in parent |
| Form values | `useForm` (React Hook Form) |
| Currently selected item | `useState` or URL param |
| Theme | `ThemeContext` + localStorage |
| Auth status | `useSession` (`src/stores/session.ts`) |
| API data (future) | TanStack React Query |
| Shared page-level data | Prop drilling or co-located context |

---

## Authentication Flow

1. User submits name or email + password on `/login` (or `/telephony/login`)
2. `useSession.getState().login()` posts them to `POST /api/auth/login`
3. On success the access + refresh token pair is stored under `pincer.web.auth` and `/api/identity/me` fills `identity`
4. User is redirected to `returnTo`, else `/dashboard`
5. `ProtectedRoute` reads `connected` from the store — if false, redirects to the login with `returnTo`
6. `authedFetch` refreshes the access token before it expires and once on a 401 `token_expired`; a rejected refresh signs the user out
7. Logout clears the session locally, calls `POST /api/auth/logout`, and navigates to the login

Details: `docs/app/login.md`.
