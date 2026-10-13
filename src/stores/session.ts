/**
 * Owner-app session (FE-BINDING: "Session store"; FE-ADR-003 phase 1).
 *
 * zustand holds only session/UI state: the backend connection, the tenant
 * (null until C3), the role (`owner` in phase 1), the per-browser user id,
 * the owner app's locale and where to return after a re-login. Server state
 * stays in TanStack Query, and is dropped whenever the signed-in identity
 * changes: the cache must never show one person another's calls.
 *
 * Sign-in is an identity's name or email plus password against
 * `POST /api/auth/login`. The token pair lives in memory + sessionStorage;
 * "remember this device" moves it to localStorage. Both are cleared on
 * logout. This store is the single source of truth for "is someone signed
 * in" — the route guards read `connected`, nothing else.
 *
 * When the session is lost (`onAuthLost` in pincerClient: an invalid token or
 * a rejected refresh) the store disconnects and records the current path as
 * `returnTo`, so the auth guard can send the person to the login and the
 * login can bring them back. `safeReturnTo` rejects a return path that is not
 * a same-origin path or that carries a credential.
 */
import { create } from "zustand";
import {
  AUTH_STORAGE_KEY,
  authFromTokenPair,
  clearAuth,
  dropMemoryAuth,
  endSession,
  getAuth,
  getUserId,
  isAuthPersisted,
  normalizeApiUrl,
  onAuthLost,
  setAuth,
} from "@/lib/pincerClient";
import { authApi } from "@/lib/api/auth";
import { queryClient } from "@/lib/queryClient";
import { setTenantId } from "@/lib/api/tenant";
import i18n from "@/i18n";
import { env } from "@/lib/env";

export type VoiceLocale = "de" | "en";

/** Phase 1: everyone is the owner. Phase 2 (C3) adds `staff`. */
/** C3 roles: `owner`, `staff` (wire `viewer`), `admin` (operator acting as owner, impersonation audited). */
export type Role = "owner" | "staff" | "admin";

/**
 * Actions the UI gates on. Nav rows and buttons ask `can()` from day one so
 * C3's roles need no refactor — only this table changes.
 */
export type OwnerAction =
  | "view_full_number"
  | "copy_full_number"
  | "view_transcript_full"
  | "change_settings"
  | "view_costs"
  | "manage_team"
  | "start_call"
  | "handle_attention"
  | "add_knowledge"
  | "view_reports"
  | "start_campaign"
  | "erase_data";

const ROLE_ACTIONS: Record<Role, ReadonlySet<OwnerAction>> = {
  owner: new Set<OwnerAction>([
    "view_full_number",
    "copy_full_number",
    "view_transcript_full",
    "change_settings",
    "view_costs",
    "manage_team",
    "start_call",
    "handle_attention",
    "add_knowledge",
    "view_reports",
    "start_campaign",
    "erase_data",
  ]),
  staff: new Set<OwnerAction>(["start_call", "handle_attention", "add_knowledge", "view_reports"]),
  admin: new Set<OwnerAction>([
    "view_full_number",
    "copy_full_number",
    "view_transcript_full",
    "change_settings",
    "view_costs",
    "manage_team",
    "start_call",
    "handle_attention",
    "add_knowledge",
    "view_reports",
    "start_campaign",
    "erase_data",
  ]),
};

const LOCALE_KEY = "voice.locale";
const RETURN_TO_KEY = "voice.returnTo";
/** Flags of the old browser-side login; nothing reads them any more. */
const LEGACY_KEYS = ["isAuthenticated", "userEmail"];

/** The wire role names C3 uses → the app's. */
export function roleFromWire(raw: string | null | undefined): Role | null {
  const k = (raw ?? "").toLowerCase();
  if (k === "owner" || k === "admin") return k;
  if (k === "viewer" || k === "staff") return "staff";
  return null;
}

export function canRole(role: Role | null, action: OwnerAction): boolean {
  if (!role) return false;
  return ROLE_ACTIONS[role].has(action);
}

export type DisconnectReason = "unauthorized" | "user";

export interface LoginInput {
  /** Identity name or email. */
  identifier: string;
  password: string;
  remember?: boolean;
  /** Defaults to `VITE_PINCER_API_URL`, else the page origin. */
  apiUrl?: string;
}

/** Who is signed in, from `GET /api/identity/me`. */
export interface SessionIdentity {
  id: string;
  displayName: string | null;
  email: string | null;
}

export interface SessionState {
  apiUrl: string | null;
  connected: boolean;
  remembered: boolean;
  tenantId: string | null;
  tenantName: string | null;
  role: Role | null;
  /** C3 §3.5: an instance admin acting inside this tenant (banner + audit). */
  impersonating: boolean;
  userId: string;
  locale: VoiceLocale;
  returnTo: string | null;
  lastDisconnect: DisconnectReason | null;
  /** Null until `/api/identity/me` answered (and when it could not). */
  identity: SessionIdentity | null;

  /** Sign in with name/email + password, then store the session. Throws ApiError. */
  login(input: LoginInput): Promise<void>;
  /** Change the password and store the token pair that replaces the current one. Throws ApiError. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Clear the session here, and end it on the server (best effort, not awaited). */
  logout(): void;
  disconnect(reason?: DisconnectReason): void;
  can(action: OwnerAction): boolean;
  setTenant(id: string | null): void;
  setRole(role: Role | null): void;
  /** Phase 2 session facts from `POST /api/auth/session` (or `/api/status.tenancy`). */
  setSessionInfo(info: { tenantId: string | null; tenantName?: string | null; role: Role | null; impersonating?: boolean }): void;
  setLocale(locale: VoiceLocale): void;
  setReturnTo(path: string | null): void;
  /** Re-read the persisted connection (after another tab or the login page changed it). */
  refresh(): void;
  /** Load `identity` from `/api/identity/me`. Best effort: never throws. */
  loadIdentity(): Promise<void>;
}

/** German unless the browser (or an explicit choice) says English. */
export function resolveVoiceLocale(language: string | undefined = i18n.language): VoiceLocale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === "de" || stored === "en") return stored;
  } catch {
    /* storage unavailable */
  }
  return language?.toLowerCase().startsWith("en") ? "en" : "de";
}

function readReturnTo(): string | null {
  try {
    return sessionStorage.getItem(RETURN_TO_KEY);
  } catch {
    return null;
  }
}

function writeReturnTo(path: string | null) {
  try {
    if (path) sessionStorage.setItem(RETURN_TO_KEY, path);
    else sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Only same-origin paths are worth returning to; never a URL with a token in it. */
export function safeReturnTo(path: string | null | undefined): string | null {
  // Browsers read a backslash as a slash, so "/\host" is another origin too.
  if (!path || !path.startsWith("/") || path.includes("\\")) return null;
  try {
    if (new URL(path, window.location.origin).origin !== window.location.origin) return null;
  } catch {
    return null;
  }
  if (/[?&#](t|token|access_token|key)=/i.test(path)) return null;
  return path;
}

/** The backend this deployment talks to when the login does not say otherwise. */
export function defaultApiUrl(): string {
  const configured = env("VITE_PINCER_API_URL");
  if (configured) return normalizeApiUrl(configured);
  if (typeof window !== "undefined" && window.location?.origin) return normalizeApiUrl(window.location.origin);
  return "";
}

/**
 * Where to go after signing in: `?returnTo=` when it is a safe same-origin
 * path, else the path recorded when the session was lost, else `fallback`.
 */
export function resolveReturnTo(fallback: string): string {
  const fromQuery =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("returnTo") : null;
  return safeReturnTo(fromQuery) ?? useSession.getState().returnTo ?? fallback;
}

function purgeLegacyFlags() {
  for (const kind of ["local", "session"] as const) {
    try {
      const storage = kind === "local" ? localStorage : sessionStorage;
      for (const key of LEGACY_KEYS) storage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
}

export const useSession = create<SessionState>((set, get) => {
  const auth = getAuth();
  return {
    apiUrl: auth?.apiUrl ?? null,
    connected: auth !== null,
    remembered: isAuthPersisted(),
    tenantId: null,
    tenantName: null,
    role: auth ? "owner" : null,
    impersonating: false,
    userId: getUserId(),
    locale: resolveVoiceLocale(),
    returnTo: safeReturnTo(readReturnTo()),
    lastDisconnect: null,
    identity: auth ? { id: auth.userId, displayName: null, email: null } : null,

    async login({ identifier, password, remember = false, apiUrl }) {
      const url = normalizeApiUrl((apiUrl ?? "").trim() || defaultApiUrl());
      // Nothing is stored before the server accepted the credentials, so a
      // failed attempt leaves whatever session there was untouched.
      const pair = await authApi.login(url, identifier.trim(), password);
      // Signing in over someone else's session: what they loaded is not this person's.
      if (get().identity?.id !== pair.pincer_user_id) queryClient.clear();
      setAuth(authFromTokenPair(url, pair), { persist: remember });
      set({
        apiUrl: url,
        connected: true,
        remembered: remember,
        role: "owner",
        lastDisconnect: null,
        identity: { id: pair.pincer_user_id, displayName: null, email: null },
      });
      await get().loadIdentity();
    },

    async changePassword(currentPassword, newPassword) {
      const before = getAuth();
      // Nothing is stored on failure: the old pair is still the valid one.
      const pair = await authApi.changePassword(currentPassword, newPassword);
      const auth = getAuth();
      // Signed out, or signed in as someone else, while this was in the air.
      // Storing the pair would undo that, and it must not stay live either.
      if (!auth || auth.userId !== before?.userId) {
        if (before) void endSession(authFromTokenPair(before.apiUrl, pair));
        return;
      }
      // Back where the old pair was: a session-only tab stays session-only.
      setAuth(authFromTokenPair(auth.apiUrl, pair), { persist: isAuthPersisted() });
    },

    logout() {
      const auth = getAuth();
      clearAuth();
      queryClient.clear();
      writeReturnTo(null);
      set({ apiUrl: null, connected: false, remembered: false, role: null, tenantId: null, tenantName: null, impersonating: false, returnTo: null, lastDisconnect: "user", identity: null });
      setTenantId(null);
      if (auth) void authApi.logout(auth);
    },

    disconnect(reason = "user") {
      const here = typeof window !== "undefined" ? window.location.pathname + window.location.search : "";
      const returnTo = reason === "unauthorized" ? safeReturnTo(here) : null;
      clearAuth();
      queryClient.clear();
      writeReturnTo(returnTo);
      set({ apiUrl: null, connected: false, remembered: false, role: null, lastDisconnect: reason, returnTo, identity: null });
    },

    can(action) {
      return canRole(get().role, action);
    },

    setTenant(id) {
      setTenantId(id);
      set({ tenantId: id });
    },

    setRole(role) {
      set({ role });
    },

    setSessionInfo(info) {
      setTenantId(info.tenantId);
      set({ tenantId: info.tenantId, tenantName: info.tenantName ?? null, role: info.role ?? get().role, impersonating: Boolean(info.impersonating) });
    },

    setLocale(locale) {
      try {
        localStorage.setItem(LOCALE_KEY, locale);
      } catch {
        /* storage unavailable */
      }
      set({ locale });
    },

    setReturnTo(path) {
      const safe = safeReturnTo(path);
      writeReturnTo(safe);
      set({ returnTo: safe });
    },

    refresh() {
      const current = getAuth();
      // Another tab signed out or signed in as someone else: the cache is the
      // previous identity's. Mounted views start over with the new one's data.
      if (!current) queryClient.clear();
      else if (get().identity && get().identity?.id !== current.userId) void queryClient.resetQueries();
      set({
        apiUrl: current?.apiUrl ?? null,
        connected: current !== null,
        remembered: isAuthPersisted(),
        role: current ? (get().role ?? "owner") : null,
        lastDisconnect: current !== null ? null : get().lastDisconnect,
        identity: !current
          ? null
          : get().identity?.id === current.userId
            ? get().identity
            : { id: current.userId, displayName: null, email: null },
      });
    },

    async loadIdentity() {
      const userId = getAuth()?.userId;
      if (!userId) return;
      try {
        const me = await authApi.me();
        // Signed out, or signed in as someone else, while this was in the air.
        if (getAuth()?.userId !== userId) return;
        set({ identity: { id: me.pincer_user_id ?? userId, displayName: me.display_name ?? null, email: me.email ?? null } });
      } catch {
        /* the name in the sidebar is a nicety — never fail a sign-in on it */
      }
    },
  };
});

/** Hook form of `can()` that re-renders when the role changes. */
export function useCan(action: OwnerAction): boolean {
  return useSession((s) => canRole(s.role, action));
}

// One subscription for the life of the app: a lost session logs out.
onAuthLost(() => {
  if (useSession.getState().connected) useSession.getState().disconnect("unauthorized");
});

purgeLegacyFlags();

if (typeof window !== "undefined") {
  // Another tab signed in, refreshed its tokens or signed out: the copy in
  // memory is stale, so read the record again. Fires for localStorage only —
  // a session-only tab keeps its own record.
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== AUTH_STORAGE_KEY) return;
    dropMemoryAuth();
    useSession.getState().refresh();
  });
}

if (useSession.getState().connected) void useSession.getState().loadIdentity();
