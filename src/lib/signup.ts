/**
 * Whether this deployment offers the "request access" page at /signup.
 *
 * `SIGNUP_ALLOWED=true` at container start; anything else (and unset) is off. The
 * Pincer API has no registration endpoint, so the page does not create an
 * account — it hands a request to whoever runs the instance.
 */
import { env } from "@/lib/env";

export const SIGNUP_ALLOWED = env("SIGNUP_ALLOWED") === "true";
