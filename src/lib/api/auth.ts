/**
 * Sign-in, sign-out and "who am I" against Pincer's per-identity auth.
 *
 * `login` is public and goes through `publicRequest`: a 401 there means the
 * name/email or password was wrong, nothing else, so it must never touch the
 * refresh machinery. Everything after sign-in uses the authenticated client.
 *
 * `LoginIn` and `PasswordChangeIn` are the pinned contract's (`api-contract.lock`). The token pair is
 * the one `pincerClient` already reads on refresh. `/api/identity/me` answers
 * an untyped dict and stays hand-written.
 */
import { endSession, type PincerAuth, type TokenPair } from "@/lib/pincerClient";
import { ApiError, publicRequest, request, type Schema } from "./client";

export type TokenPairOut = TokenPair;

export type LoginIn = Schema<"LoginIn">;

export type PasswordChangeIn = Schema<"PasswordChangeIn">;

/** The backend's only password rule is length (`MIN_`/`MAX_PASSWORD_LENGTH` in `pincer/security/credentials.py`). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

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

export type PasswordChangeErrorKind = "wrongCurrent" | "locked" | "validation" | "unreachable" | "other";

/** Which message a failed password change deserves. */
export function passwordChangeErrorKind(err: unknown): PasswordChangeErrorKind {
  if (!(err instanceof ApiError)) return "other";
  if (err.status === 0) return "unreachable";
  if (err.status === 403) return "wrongCurrent";
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
  logout: (auth: PincerAuth): Promise<void> => endSession(auth),

  me: () => request<Me>("/api/identity/me"),

  /**
   * Change the caller's password. The answer is the pair that replaces every
   * token issued before, including the one this request was made with.
   */
  changePassword: (currentPassword: string, newPassword: string) =>
    request<TokenPairOut>("/api/identity/me/password", {
      method: "PUT",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword } satisfies PasswordChangeIn),
    }),
};
