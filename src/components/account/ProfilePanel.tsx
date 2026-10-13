/**
 * Profile panel: who is signed in, and a form to change the password. Opened
 * from the user menu of both shells (platform sidebar and owner app), so it
 * lives outside either and brings its own design tokens.
 *
 * The API takes the current and the new password only; the confirmation is
 * checked here. A successful change replaces the session's token pair
 * (`session.changePassword`) and signs every other device out.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import "@/i18n/voice";
import "@/styles/platform.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api/client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordChangeErrorKind } from "@/lib/api/auth";
import { useSession } from "@/stores/session";
import { useVoiceT } from "@/i18n/voice";

type Field = "current" | "next" | "confirm";
type Errors = Partial<Record<Field | "form", string>>;

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: string;
  hintId?: string;
}

function PasswordField({ id, label, value, onChange, autoComplete, error, hintId }: PasswordFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hintId}
        className="rounded-[10px]"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-[var(--bad-fg)]">
          {error}
        </p>
      )}
    </div>
  );
}

export function ProfilePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useVoiceT("voice-account");
  const tc = useVoiceT("voice-common");
  const { toast } = useToast();
  const identity = useSession((s) => s.identity);
  const changePassword = useSession((s) => s.changePassword);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  // Counts the times the panel closed, so an answer can tell it is late.
  const closings = useRef(0);

  // A closed panel keeps nothing: no typed password, no stale error.
  useEffect(() => {
    if (open) return;
    closings.current += 1;
    setCurrent("");
    setNext("");
    setConfirm("");
    setErrors({});
  }, [open]);

  const check = (): Errors => {
    const found: Errors = {};
    if (!current) found.current = t("password.errorRequired");
    // Code points, as the server counts them: an emoji is one character, not two.
    const nextLength = [...next].length;
    if (!next) found.next = t("password.errorRequired");
    else if (nextLength < PASSWORD_MIN_LENGTH) found.next = t("password.errorTooShort", { min: PASSWORD_MIN_LENGTH });
    else if (nextLength > PASSWORD_MAX_LENGTH) found.next = t("password.errorTooLong", { max: PASSWORD_MAX_LENGTH });
    if (!confirm) found.confirm = t("password.errorRequired");
    else if (confirm !== next) found.confirm = t("password.errorMismatch");
    return found;
  };

  const serverErrors = (err: unknown): Errors => {
    const detail = err instanceof Error && err.message ? err.message : tc("errors.network");
    switch (passwordChangeErrorKind(err)) {
      case "wrongCurrent":
        return { current: t("password.errorWrongCurrent") };
      case "validation":
        // Rule 11: the server's sentence about the new password, verbatim.
        return { next: detail };
      case "locked": {
        const wait = err instanceof ApiError ? err.retryAfter : undefined;
        return { form: wait ? t("password.errorLockedFor", { minutes: Math.ceil(wait / 60) }) : t("password.errorLocked") };
      }
      case "unreachable":
        return { form: t("password.errorUnreachable") };
      default:
        return { form: detail };
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    // The panel this answer belongs to may be closed, or closed and reopened,
    // by the time it arrives: then its error is not shown and it closes nothing.
    const closedBefore = closings.current;
    try {
      await changePassword(current, next);
      toast({ title: t("password.success") });
      if (closings.current === closedBefore) onOpenChange(false);
    } catch (err) {
      if (closings.current === closedBefore) setErrors(serverErrors(err));
    } finally {
      // `busy` outlives a close on purpose: a second change sent while the
      // first is in the air would use the token the first one revokes.
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        /* Radix portals to <body>, outside `.platform` — `plat` re-declares the
           design tokens so the vars below resolve inside the portal. */
        className="plat flex w-full flex-col gap-0 overflow-y-auto border-[var(--line)] sm:max-w-md"
        style={{ background: "var(--paper)" }}
      >
        <SheetHeader className="pb-4 text-left">
          <SheetTitle className="plat-display text-[19px] text-[var(--ink)]">{t("title")}</SheetTitle>
          <SheetDescription className="text-xs text-[var(--text-4)]">{t("description")}</SheetDescription>
        </SheetHeader>

        <section aria-labelledby="profile-account-heading" className="border-t border-[var(--line-soft)] py-4">
          <h3 id="profile-account-heading" className="plat-eyebrow !text-[var(--text-3)] mb-3">
            {t("account.heading")}
          </h3>
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-[var(--text-3)]">{t("account.nameLabel")}</dt>
              <dd className="min-w-0 truncate text-[var(--ink)]">{identity?.displayName || identity?.id || t("account.none")}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-[var(--text-3)]">{t("account.emailLabel")}</dt>
              <dd className="min-w-0 truncate text-[var(--ink)]">{identity?.email || t("account.none")}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="profile-password-heading" className="border-t border-[var(--line-soft)] py-4">
          <h3 id="profile-password-heading" className="plat-eyebrow !text-[var(--text-3)] mb-3">
            {t("password.heading")}
          </h3>
          <form onSubmit={onSubmit} noValidate aria-busy={busy} className="space-y-3">
            {/* Not shown: tells a password manager which entry the new password belongs to. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={identity?.email || identity?.displayName || identity?.id || ""}
              readOnly
              hidden
            />
            <PasswordField
              id="profile-current-password"
              label={t("password.currentLabel")}
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              error={errors.current}
            />
            <PasswordField
              id="profile-new-password"
              label={t("password.newLabel")}
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              error={errors.next}
              hintId="profile-new-password-hint"
            />
            {!errors.next && (
              <p id="profile-new-password-hint" className="!mt-1.5 text-xs text-[var(--text-3)]">
                {t("password.lengthHint", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
              </p>
            )}
            <PasswordField
              id="profile-confirm-password"
              label={t("password.confirmLabel")}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              error={errors.confirm}
            />

            {errors.form && (
              <p role="alert" className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-xs text-[var(--bad-fg)]">
                {errors.form}
              </p>
            )}

            <Button type="submit" disabled={busy} className="!mt-5 w-full rounded-[12px]">
              {busy ? t("password.submitting") : t("password.submit")}
            </Button>
            <p className="text-xs leading-relaxed text-[var(--text-3)]">{t("password.devicesHint")}</p>
          </form>
        </section>
      </SheetContent>
    </Sheet>
  );
}
