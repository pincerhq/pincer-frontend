/**
 * Whether this build offers the "request access" page at /signup.
 *
 * `SIGNUP_ALLOWED=true` at build time; anything else (and unset) is off. The
 * Pincer API has no registration endpoint, so the page does not create an
 * account — it hands a request to whoever runs the instance.
 */
export const SIGNUP_ALLOWED = import.meta.env.SIGNUP_ALLOWED === "true";
