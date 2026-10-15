/**
 * MaskedNumber (FE1 §4, Block I rule 5): `+49 171 ••• 4521` by default.
 *
 * Owners can reveal the full number on hover / focus / long-press, and copy
 * it; the copy button copies the full number only for the owner role and the
 * masked form for everyone else. Nothing here ever puts the number in the
 * URL, a title attribute or a log.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhone, maskPhone } from "@/lib/format";
import { useCan } from "@/stores/session";
import { useVoiceT } from "@/i18n/voice";

export interface MaskedNumberProps {
  value: string | null | undefined;
  /** Show the copy button. */
  copy?: boolean;
  /**
   * Plain text, no reveal control — for rows that are themselves clickable
   * (a nested interactive element is an a11y violation). Lists are masked;
   * the detail page reveals.
   */
  static?: boolean;
  className?: string;
}

const LONG_PRESS_MS = 450;

export function MaskedNumber({ value, copy = false, static: isStatic = false, className }: MaskedNumberProps) {
  const t = useVoiceT("voice-common");
  const canReveal = useCan("view_full_number") && !isStatic;
  const canCopyFull = useCan("copy_full_number");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const pressTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  if (!value) return <span className={className}>—</span>;

  const masked = maskPhone(value);
  const full = formatPhone(value);
  const shown = revealed && canReveal ? full : masked;

  const startPress = () => {
    if (!canReveal) return;
    pressTimer.current = window.setTimeout(() => setRevealed(true), LONG_PRESS_MS);
  };
  const endPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(canCopyFull ? full : masked);
      setCopied(true);
    } catch {
      /* clipboard blocked — nothing to say that the person can act on */
    }
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className="inline-flex min-h-11 items-center font-mono tabular-nums sm:min-h-0"
        role={canReveal ? "button" : undefined}
        tabIndex={canReveal ? 0 : undefined}
        aria-label={canReveal ? (revealed ? t("masked.hide") : t("masked.reveal")) : undefined}
        aria-pressed={canReveal ? revealed : undefined}
        onMouseEnter={() => canReveal && setRevealed(true)}
        onMouseLeave={() => setRevealed(false)}
        onFocus={() => canReveal && setRevealed(true)}
        onBlur={() => setRevealed(false)}
        onTouchStart={startPress}
        onTouchEnd={endPress}
        onTouchCancel={endPress}
        onKeyDown={(e) => {
          if (!canReveal) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setRevealed((r) => !r);
          }
        }}
        data-testid="masked-number"
      >
        {shown}
      </span>
      {copy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? t("masked.copied") : t("masked.copy")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[6px] p-0.5 text-[var(--text-3)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] sm:min-h-0 sm:min-w-0"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--ok-fg)]" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      )}
    </span>
  );
}
