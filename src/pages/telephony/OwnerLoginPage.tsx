/**
 * Owner login (FE1 §1) at /telephony/login — outside the platform's
 * ProtectedRoute, because it is what creates the session.
 *
 * Name or email plus password, checked by `POST /api/auth/login`. "Remember
 * this device" is opt-in and off by default (shared reception PCs).
 */
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import "@/i18n/voice";
import "@/styles/platform.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/client";
import { loginErrorKind } from "@/lib/api/auth";
import { defaultApiUrl, resolveReturnTo, useSession } from "@/stores/session";
import { useVoiceT } from "@/i18n/voice";
import { ROUTES } from "@/pages/telephony/_lib/routes";

export default function OwnerLoginPage() {
  const t = useVoiceT("voice-auth");
  const tc = useVoiceT("voice-common");
  const navigate = useNavigate();
  const login = useSession((s) => s.login);
  const connected = useSession((s) => s.connected);
  const lastDisconnect = useSession((s) => s.lastDisconnect);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const returnTo = useRef(resolveReturnTo(ROUTES.HOME));

  const finish = () => {
    setDone(true);
    useSession.getState().setReturnTo(null);
    navigate(returnTo.current, { replace: true });
  };

  const errorText = (err: unknown): string => {
    switch (loginErrorKind(err)) {
      case "invalid":
        // Never which of the two: that would confirm an account exists.
        return t("form.errorInvalid");
      case "locked": {
        const wait = err instanceof ApiError ? err.retryAfter : undefined;
        return wait ? t("form.errorLockedFor", { minutes: Math.ceil(wait / 60) }) : t("form.errorLocked");
      }
      case "validation":
        return t("form.errorValidation");
      case "unreachable":
        return t("form.errorUnreachable", { url: defaultApiUrl() });
      default:
        return err instanceof Error && err.message ? err.message : tc("errors.network");
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError(t("form.errorEmpty"));
      return;
    }
    setBusy(true);
    try {
      await login({ identifier, password, remember });
      finish();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const notice = lastDisconnect === "unauthorized" ? t("sessionExpired") : null;
  const describedBy = error ? "owner-login-error" : undefined;

  return (
    <main className="plat flex min-h-screen items-center justify-center bg-[var(--sand)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[14px] bg-[var(--paper)] shadow-sm">
            <KeyRound className="h-5 w-5 text-[var(--blue)]" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)]">{t("title")}</h1>
          <p className="mt-1 text-sm text-[var(--text-3)]">{t("subtitle")}</p>
        </div>

        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="mb-4 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            {notice}
          </p>
        )}

        {connected && !done && (
          <p className="mb-4 text-center text-sm text-[var(--text-3)]">
            <Link to={returnTo.current} className="underline">
              {tc("auth.action")}
            </Link>
          </p>
        )}

        <form onSubmit={onSubmit} className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-5 shadow-sm" aria-busy={busy}>
          <div className="space-y-1.5">
            <Label htmlFor="owner-identifier">{t("form.identifierLabel")}</Label>
            <Input
              id="owner-identifier"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={320}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className="rounded-[10px]"
            />
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="owner-password">{t("form.passwordLabel")}</Label>
              <Link to="/forgot-password" className="text-xs text-[var(--text-3)] underline-offset-2 hover:underline">
                {t("form.forgot")}
              </Link>
            </div>
            <Input
              id="owner-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className="rounded-[10px]"
            />
            {error && (
              <p id="owner-login-error" role="alert" className="text-xs text-[var(--bad-fg)]">
                {error}
              </p>
            )}
          </div>

          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="owner-remember" className="text-sm">
                {t("form.rememberLabel")}
              </Label>
              <p id="owner-remember-hint" className="mt-0.5 text-xs leading-relaxed text-[var(--text-3)]">
                {t("form.rememberHint")}
              </p>
            </div>
            <Switch id="owner-remember" checked={remember} onCheckedChange={setRemember} aria-describedby="owner-remember-hint" />
          </div>

          <Button type="submit" disabled={busy} className="mt-5 w-full rounded-[12px]">
            {busy ? t("form.submitting") : t("form.submit")}
          </Button>
        </form>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--text-3)]">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {tc("app.name")}
        </p>
      </div>
    </main>
  );
}
