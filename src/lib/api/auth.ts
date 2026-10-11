/**
 * Sign-in, sign-out and "who am I" against Pincer's per-identity auth.
 *
 * `login` is public and goes through `publicRequest`: a 401 there means the
 * name/email or password was wrong, nothing else, so it must never touch the
 * refresh machinery. Everything after sign-in uses the authenticated client.
 *
 * `LoginIn` is the pinned contract's (`api-contract.lock`). The token pair is
 * the one `pincerClient` already reads on refresh. `/api/identity/me` answers
 * an untyped dict and stays hand-written.
 */
import type { PincerAuth, TokenPair } from "@/lib/pincerClient";
import { ApiError, publicRequest, request, type Schema } from "./client";

export type TokenPairOut = TokenPair;

export type LoginIn = Schema<"LoginIn">;

/** The fields of `GET /api/identity/me` this app reads. */
export interface Me {
  pincer_user_id: string;
  display_name?: string | null;
  email?: string | null;
}

export type LoginErrorKind = "invalid" | "locked" | "validation" | "unreachable" | "other";

/** Which message a failed sign-in deserves. */
export function loginErrorKind(err: unknown): LoginErrorKind {
  if (!(err instanceof ApiError)) return "other";
  if (err.status === 0) return "unreachable";
  if (err.status === 401) return "invalid";
  if (err.status === 429) return "locked";
  if (err.status === 422) return "validation";
  return "other";
}

export const authApi = {
  login: (apiUrl: string, identifier: string, password: string) =>
    publicRequest<TokenPairOut>(apiUrl, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password } satisfies LoginIn),
    }),

  /**
   * End the session on the server so its tokens are dead, not just forgotten
   * here. Best effort: signing out locally must never fail, so this takes the
   * credentials it should revoke and never throws.
   */
  logout: async (auth: PincerAuth): Promise<void> => {
    try {
      await fetch(`${auth.apiUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
        keepalive: true,
      });
    } catch {
      /* offline or unreachable: the local sign-out still happened */
    }
  },

  me: () => request<Me>("/api/identity/me"),
};
