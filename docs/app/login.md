# Login

Two pages, one mechanism. Both sign in with a Pincer identity's **name or email + password** against `POST /api/auth/login`, and both store the session through `src/stores/session.ts`.

| Page | Route | Component | Lands on |
|---|---|---|---|
| Platform | `/login` | `src/pages/Login.tsx` | `/dashboard` |
| Owner app | `/telephony/login` (`ROUTES.LOGIN`) | `src/pages/telephony/OwnerLoginPage.tsx` | `/telephony` |

There is no API address field. The API is `VITE_PINCER_API_URL`, else the page's own origin (`defaultApiUrl()`).

Pasted tokens and magic links (`?t=…`) are gone, and so is the browser-side `VITE_AUTH_EMAIL` / `VITE_AUTH_PASSWORD` comparison. An account is created by whoever runs the instance:

```sh
uv run pincer identity create alice --email alice@example.com --display-name Alice
uv run pincer identity set-password alice
```

## API contract

| Call | Request | Response |
|---|---|---|
| `POST /api/auth/login` (public) | `{identifier, password}` | `{access_token, refresh_token, token_type, expires_in, pincer_user_id}` · 401 `invalid_credentials` · 429 `locked_out` (+ `Retry-After`) · 422 |
| `POST /api/auth/refresh` (public) | `{refresh_token}` | a new pair; refresh tokens are single-use · 401 `invalid_token` / `token_expired` |
| `POST /api/auth/logout` | Bearer | 204 |
| `GET /api/identity/me` | Bearer | `{pincer_user_id, display_name, email, …}` |

Every auth failure has the shape `{error: <code>, detail: <sentence>}`. The client branches on `error` (`ApiError.code`).

## Session storage

`pincer.web.auth` holds `{apiUrl, token, refreshToken, expiresAt, userId}` (`PincerAuth` in `src/lib/pincerClient.ts`; `token` is the access token).

- **Remember this device / Remember me** is off by default (shared reception PCs). Off → memory + `sessionStorage`; on → `localStorage`.
- A stored record without `refreshToken` / `expiresAt` is from the shared-token era: it is deleted on read, so that browser lands on the login. The old `isAuthenticated` / `userEmail` flags are deleted at startup.
- Logout clears both storages immediately and then calls `POST /api/auth/logout` without waiting for it (best effort; it never blocks or fails the local sign-out).

## Keeping the session alive

All of it lives in `src/lib/pincerClient.ts`; every authenticated request goes through `authedFetch`.

1. **Ahead of expiry.** `ensureFreshAuth()` refreshes when the access token has less than 30 s left.
2. **On a 401 `token_expired`.** Refresh, then retry the request exactly once.
3. **Single-flight.** Concurrent requests share one refresh. Across tabs that share `localStorage` the refresh runs inside `navigator.locks.request("pincer.web.auth.refresh")` and re-reads storage first, so a tab that waited uses the pair the other tab just stored instead of spending the (single-use) refresh token again. A `storage` listener in the session store drops the stale in-memory copy.

What ends the session (`onAuthLost` → `session.disconnect("unauthorized")`):

- a 401 `invalid_token`,
- a refresh the server rejects,
- a second 401 after the one retry.

What does **not**: a refresh that could not be done (429, 5xx, offline), and a 401 without an `error` code, which is a route's own answer.

Known limit: a **duplicated tab that is not remembered** copies `sessionStorage`, refresh token included. Whichever copy refreshes second is rejected and signed out.

## Guards and returning

- `src/components/ProtectedRoute.tsx` reads `useSession((s) => s.connected)` and nothing else. Signed out → `/telephony/login?returnTo=…` for `/telephony*`, otherwise `/login?returnTo=…`.
- When a session is lost mid-use, the store records the current path as `returnTo`; the owner login shows "Ihre Sitzung ist abgelaufen".
- After sign-in both pages go to `resolveReturnTo(fallback)`: the `returnTo` query, else the recorded path, else the page's home. `safeReturnTo` rejects anything that is not a same-origin path or that carries a `t=` / `token=` / `key=` parameter.

## Errors shown

`loginErrorKind(err)` in `src/lib/api/auth.ts` picks the message; the copy is in `src/i18n/locales/{de,en}/voice/auth.json` for the owner page and inline (English) on `/login`.

| Answer | Message |
|---|---|
| 401 | "Name/email or password is incorrect" — never which of the two |
| 429 | "Too many failed attempts, try again in a few minutes". The wait is shown only when `Retry-After` is readable, which cross-origin it is not unless the API lists it in `Access-Control-Expose-Headers` |
| 422 | its own "please check" copy |
| no answer | "The server at … cannot be reached" |

## Sign-up and forgotten passwords

- `/forgot-password` opens a prefilled mail to the administrator; there is no self-service reset.
- `/signup` exists only in builds with `SIGNUP_ALLOWED=true` (build-time; `src/lib/signup.ts`). It is a **request-access** form that opens a mail draft — the API has no registration endpoint, so enabling the flag does not give self-service accounts.

## Roles

`can(action)` / `useCan(action)` gate nav rows and buttons; the role is `owner` for every signed-in identity until C3. `session.setSessionInfo()` / `setRole()` exist for tenant and role facts.

## Deploying

This frontend and the API's per-identity auth must go out together: the old frontend cannot sign in to the new API and this one cannot sign in to an API without `/api/auth/login`. Every user needs an identity with a password before the cutover.

Listen-in uses the same session: the WebSocket is opened with a one-minute ticket from `POST /api/voice/listen/{call_sid}/ticket` (`?token=<ticket>`), never with the access token.
