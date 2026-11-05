/**
 * Presentation metadata shared by every voice surface: languages, the
 * language-switch SYSTEM transcript entries, and the outcome/failure taxonomy.
 *
 * Kept out of the components because the history table, the inline transcript
 * panel and the full-screen transcript modal all need the same answers, and
 * three copies of a flag table drift within a sprint.
 */
import {
  LATENCY_TARGET_GOOD_MS,
  LATENCY_TARGET_OK_MS,
  type CallSummary,
  type TranscriptLine,
} from '@/lib/api/voice';

// ── Languages ────────────────────────────────────────────────────────

interface LanguageMeta {
  /** Regional-indicator pair, not an emoji font dependency. */
  flag: string;
  /** English label, for tooltips. */
  label: string;
  /** Endonym — what the divider says the call switched *to*. */
  native: string;
}

const LANGUAGES: Record<string, LanguageMeta> = {
  en: { flag: '🇬🇧', label: 'English', native: 'English' },
  de: { flag: '🇩🇪', label: 'German', native: 'Deutsch' },
  fr: { flag: '🇫🇷', label: 'French', native: 'Français' },
  es: { flag: '🇪🇸', label: 'Spanish', native: 'Español' },
  it: { flag: '🇮🇹', label: 'Italian', native: 'Italiano' },
  nl: { flag: '🇳🇱', label: 'Dutch', native: 'Nederlands' },
  pl: { flag: '🇵🇱', label: 'Polish', native: 'Polski' },
  uk: { flag: '🇺🇦', label: 'Ukrainian', native: 'Українська' },
  ru: { flag: '🇷🇺', label: 'Russian', native: 'Русский' },
  tr: { flag: '🇹🇷', label: 'Turkish', native: 'Türkçe' },
};

/** `en-GB`, `DE`, `de_DE` all collapse to the base subtag. */
export function langCode(raw: string | null | undefined): string | null {
  const base = (raw ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return base || null;
}

export function languageMeta(raw: string | null | undefined): LanguageMeta | null {
  const code = langCode(raw);
  return code ? (LANGUAGES[code] ?? null) : null;
}

/** Endonym where known, otherwise the code itself — never a guess. */
export function languageNative(raw: string | null | undefined): string {
  return languageMeta(raw)?.native ?? (langCode(raw) ?? '').toUpperCase();
}

/** Reverse lookup so "switched to Deutsch" / "switched to German" resolve. */
function codeFromName(name: string): string | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  if (LANGUAGES[needle]) return needle;
  for (const [code, meta] of Object.entries(LANGUAGES)) {
    if (meta.label.toLowerCase() === needle || meta.native.toLowerCase() === needle) return code;
  }
  return null;
}

// ── Language-switch transcript entries ───────────────────────────────

export interface LanguageSwitch {
  /** Null when the entry only records where the call went. */
  from: string | null;
  to: string;
  /** e.g. "caller request" — null when the entry does not say. */
  reason: string | null;
}

/**
 * A SYSTEM transcript entry marking a mid-call language switch.
 *
 * The language-consistency task writes these; the exact wire format is not
 * pinned, so three shapes are accepted and anything else is left to render as
 * an ordinary system line:
 *
 *   {"event":"language_switch","from":"en","to":"de","reason":"caller request"}
 *   language_switch: en -> de (caller request)
 *   switched to Deutsch at caller request
 */
export function parseLanguageSwitch(line: TranscriptLine): LanguageSwitch | null {
  if (line.speaker !== 'system' && line.speaker !== 'provider') return null;
  const text = (line.text ?? '').trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const event = String(data.event ?? data.type ?? '');
      const to = langCode(String(data.to ?? data.language ?? ''));
      if (/language[_ ]?switch/i.test(event) && to) {
        return {
          from: langCode(String(data.from ?? '')),
          to,
          reason: data.reason ? String(data.reason) : null,
        };
      }
    } catch {
      /* not JSON after all — fall through to the text forms */
    }
  }

  const arrow = text.match(
    /language[_ ]?switch\b[:\s]*([a-z]{2}(?:[-_][a-z]{2})?)?\s*(?:->|→|to)\s*([a-z]{2}(?:[-_][a-z]{2})?)\s*(?:[(–—-]\s*(.+?)\s*\)?)?$/i,
  );
  if (arrow) {
    const to = langCode(arrow[2]);
    if (to) return { from: langCode(arrow[1]), to, reason: arrow[3]?.trim() || null };
  }

  const prose = text.match(/switch(?:ed|ing)?\s+to\s+([\p{L}]+)(?:\s+(?:at|on|per|because of)\s+(.+?))?[.!]?$/iu);
  if (prose) {
    const to = codeFromName(prose[1]) ?? langCode(prose[1]);
    if (to && LANGUAGES[to]) return { from: null, to, reason: prose[2]?.trim() || null };
  }

  return null;
}

/** "— switched to Deutsch at caller request —" */
export function languageSwitchText(sw: LanguageSwitch): string {
  const reason = sw.reason ? ` at ${sw.reason}` : '';
  return `switched to ${languageNative(sw.to)}${reason}`;
}

// ── Outcome / failure taxonomy ───────────────────────────────────────

export type ChipTone = 'green' | 'grey' | 'amber' | 'red';

/**
 * Colour for the outcome chip. Failure codes are always red — they are the
 * Sprint 9 taxonomy of things that went wrong, and a soft colour for
 * `stt_timeout` would read as "fine".
 */
const OUTCOME_TONE: Record<string, ChipTone> = {
  completed: 'green',
  confirmed: 'green',
  booked: 'green',
  scheduled: 'green',
  resolved: 'green',
  no_answer: 'grey',
  voicemail: 'grey',
  busy: 'grey',
  cancelled: 'grey',
  declined: 'amber',
  rescheduled: 'amber',
  partial: 'amber',
  incomplete: 'amber',
};

export function outcomeTone(value: string): ChipTone {
  return OUTCOME_TONE[value.toLowerCase()] ?? 'amber';
}

export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  green: 'border-green-200 bg-green-50 text-green-700',
  grey: 'border-[var(--line)] bg-[var(--sand)] text-[var(--text-4)]',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-red-200 bg-red-50 text-red-700',
};

/** `no_answer` → `no answer`. The backend's codes are the source of truth. */
export function humanizeCode(code: string): string {
  return code.replace(/_/g, ' ');
}

/**
 * The single chip a history row shows: the failure code if the call failed,
 * otherwise the extracted outcome. Null when the backend has told us neither.
 */
export function rowChip(
  call: CallSummary,
  lang?: string,
): { label: string; tone: ChipTone; title: string } | null {
  if (call.failure_code) {
    const explained = FAILURE_TOOLTIPS[call.failure_code.toLowerCase()];
    return {
      label: failureLabel(call.failure_code),
      tone: 'red',
      // Our own sentence where we have one (it says who is to blame), the
      // backend's where it does not, and the bare code only as a last resort.
      title: explained
        ? failureTitle(call.failure_code, lang)
        : call.failure_description || failureTitle(call.failure_code, lang),
    };
  }
  const outcome = call.outcome?.outcome;
  if (outcome) {
    return {
      label: humanizeCode(outcome),
      tone: outcomeTone(outcome),
      title: call.outcome?.task_result || `Outcome: ${outcome}`,
    };
  }
  return null;
}

// ── Latency & cost formatting ────────────────────────────────────────

export function latencyTone(ms: number): ChipTone {
  if (ms <= LATENCY_TARGET_GOOD_MS) return 'green';
  if (ms <= LATENCY_TARGET_OK_MS) return 'amber';
  return 'red';
}

/** Sub-second turns are the target, so the unit follows the magnitude. */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Sub-cent calls are the norm, so the precision follows the magnitude. */
export function fmtCostUsd(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

// ═══════════════════════════════════════════════════════════════════════
// v3 — in-call tool policy (S11) & receptionist (S12)
// ═══════════════════════════════════════════════════════════════════════

// ── Inbound intent (S12 §11) ─────────────────────────────────────────

interface IntentMeta {
  label: string;
  tone: ChipTone;
  /** Tooltip: what the receptionist actually did with the call. */
  title: string;
}

const INTENT_META: Record<string, IntentMeta> = {
  question: { label: 'question', tone: 'grey', title: 'Caller asked something the receptionist could answer' },
  message: { label: 'message', tone: 'amber', title: 'Caller left a message for you' },
  appointment: { label: 'appointment', tone: 'green', title: 'Caller wanted to book a slot' },
  human: { label: 'wants a human', tone: 'amber', title: 'Caller asked to be put through' },
  after_hours: { label: 'after hours', tone: 'grey', title: 'Call arrived outside business hours' },
  unknown: { label: 'unclear', tone: 'grey', title: 'The receptionist could not classify this call' },
};

export function intentMeta(raw: string | null | undefined): IntentMeta | null {
  const key = (raw ?? '').trim().toLowerCase();
  if (!key) return null;
  // Unknown codes render as themselves; the backend owns this vocabulary.
  return INTENT_META[key] ?? { label: humanizeCode(key), tone: 'grey', title: `Inbound intent: ${key}` };
}

// ── Failure codes new in v3 (S12 §10) ────────────────────────────────

/** Codes whose underscore form reads badly; the rest fall through. */
const FAILURE_LABELS: Record<string, string> = {
  blocked: 'blocked caller',
  busy_capacity: 'line at capacity',
  silent_hangup: 'silent hangup',
  briefing_lost: 'briefing lost (system)',
};

/**
 * Failures whose cause is the system, not the person who placed the call.
 * `briefing_lost` means the agent's task never reached the call and it was
 * terminated rather than improvised — the user must not read that as "my
 * purpose was bad".
 */
const FAILURE_TOOLTIPS: Record<string, { en: string; de: string }> = {
  briefing_lost: {
    en: 'The call was terminated because the agent’s briefing did not reach the call. This is a system error — please retry.',
    de: 'Der Anruf wurde beendet, weil die Anweisung den Anruf nicht erreicht hat. Das ist ein Systemfehler — bitte erneut versuchen.',
  },
};

/** The tooltip for a failure chip: the explanation where we have one. */
export function failureTitle(code: string, lang?: string): string {
  const entry = FAILURE_TOOLTIPS[code.toLowerCase()];
  if (!entry) return `Failure code: ${code}`;
  return lang?.startsWith('de') ? entry.de : entry.en;
}

export function failureLabel(code: string): string {
  return FAILURE_LABELS[code.toLowerCase()] ?? humanizeCode(code);
}

// ── Tool tiers and approval modes (S11 §3, §6) ───────────────────────

interface TierMeta {
  label: string;
  title: string;
  cls: string;
}

/** R read, W write, X dangerous. Denied actions are red whatever the tier. */
export const TIER_META: Record<string, TierMeta> = {
  R: { label: 'R', title: 'Read-only tool — cannot change anything', cls: CHIP_TONE_CLASS.grey },
  W: {
    label: 'W',
    title: 'Write tool — changes data outside the call',
    cls: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  X: { label: 'X', title: 'Dangerous tool — money, deletion or irreversible effects', cls: CHIP_TONE_CLASS.red },
};

export function tierMeta(raw: string | null | undefined): TierMeta | null {
  const key = (raw ?? '').trim().toUpperCase();
  if (!key) return null;
  return TIER_META[key] ?? { label: key, title: `Tool tier: ${key}`, cls: CHIP_TONE_CLASS.grey };
}

interface ModeMeta {
  label: string;
  title: string;
  tone: ChipTone;
}

const MODE_META: Record<string, ModeMeta> = {
  auto: { label: 'auto', title: 'No approval needed for this tier', tone: 'grey' },
  verbal: { label: 'verbal', title: 'The caller confirmed it out loud on the call', tone: 'green' },
  user: { label: 'you', title: 'You approved it from the dashboard while the caller held', tone: 'green' },
  off: {
    label: 'autonomous',
    title: 'Approvals are switched off — the agent acted on its own',
    tone: 'amber',
  },
};

export function modeMeta(raw: string | null | undefined): ModeMeta | null {
  const key = (raw ?? '').trim().toLowerCase();
  if (!key) return null;
  return MODE_META[key] ?? { label: humanizeCode(key), title: `Approval mode: ${key}`, tone: 'grey' };
}

// ── Briefing transcript entry ────────────────────────────────────────

/**
 * The briefing is written into the transcript as a SYSTEM line so "what was
 * the agent told?" is answerable from the transcript alone. It was never
 * audio, so it must not render as something someone said — same reasoning as
 * the language-switch divider.
 */
export function parseBriefingLine(line: { speaker: string; text: string; state?: string }): string | null {
  const text = (line.text ?? '').trim();
  const isSystem = (line.speaker ?? '').toLowerCase() === 'system' || line.state === 'briefing';
  if (!isSystem) return null;
  const m = /^\[BRIEFING\]\s*([\s\S]*)$/i.exec(text);
  return m ? m[1].trim() : null;
}

// ── Delivery outcome of an agent line ────────────────────────────────

/**
 * An agent line that did not play in full. `failed` is a delivery failure
 * (state `undelivered`); `cancelled` (never played) and `interrupted` (cut off
 * partway) are deliberate — the caller talked over it or the call ended — and
 * must not read as a fault.
 */
export type LineDelivery = 'failed' | 'cancelled' | 'interrupted';

const DELIVERY_BY_STATE: Record<string, LineDelivery> = {
  undelivered: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
};

/** The line's delivery outcome, or null for a line that played. */
export function lineDelivery(line: { state?: string }): LineDelivery | null {
  return DELIVERY_BY_STATE[line.state ?? ''] ?? null;
}

/**
 * Why it did not play: `barge_in`, `call_ended`, or a failure code
 * (`send_error`, `tts_failed`, …). Read loosely — older backends do not send it.
 */
export function lineDeliveryReason(line: object): string {
  const reason = (line as { delivery_reason?: unknown }).delivery_reason;
  return typeof reason === 'string' ? reason : '';
}

// ── Deny reasons (S11 §5.2 codes → sentences, both UI languages) ─────

/**
 * The backend sends a code, never a sentence, so this map is the one place
 * either language changes when the taxonomy grows. An unmapped code renders as
 * itself: a wrong sentence about a refusal is worse than a bare code.
 */
const DENY_REASONS: Record<string, { en: string; de: string }> = {
  tier_blocked: {
    en: 'Blocked by policy: this tool’s tier is not allowed during calls.',
    de: 'Durch Richtlinie blockiert: Diese Tool-Stufe ist während Anrufen nicht erlaubt.',
  },
  budget_exhausted: {
    en: 'The write budget for this call was already used up.',
    de: 'Das Schreib-Budget für diesen Anruf war bereits aufgebraucht.',
  },
  policy_off: {
    en: 'Tool calls are switched off for this deployment.',
    de: 'Tool-Aufrufe sind für diese Installation abgeschaltet.',
  },
  user_denied: {
    en: 'You denied this action from the dashboard.',
    de: 'Sie haben diese Aktion im Dashboard abgelehnt.',
  },
  verbal_denied: {
    en: 'The caller did not confirm it on the call.',
    de: 'Der Anrufer hat es im Gespräch nicht bestätigt.',
  },
  expired: {
    en: 'The approval request timed out while the caller waited.',
    de: 'Die Freigabe-Anfrage lief ab, während der Anrufer wartete.',
  },
  call_ended: {
    en: 'The call ended before the action could be approved.',
    de: 'Der Anruf endete, bevor die Aktion freigegeben werden konnte.',
  },
  invalid_args: {
    en: 'The agent asked for this with arguments the tool rejected.',
    de: 'Der Agent hat den Aufruf mit ungültigen Argumenten gestellt.',
  },
  tool_unavailable: {
    en: 'The tool was not reachable at that moment.',
    de: 'Das Tool war in diesem Moment nicht erreichbar.',
  },
  rate_limited: {
    en: 'The tool refused: too many calls in a short window.',
    de: 'Das Tool hat abgelehnt: zu viele Aufrufe in kurzer Zeit.',
  },
  unknown: {
    en: 'The action was refused; the backend did not say why.',
    de: 'Die Aktion wurde abgelehnt; das Backend nennt keinen Grund.',
  },
};

/** `lang` is the UI language, not the language of the call. */
export function denyReasonText(code: string | null | undefined, lang?: string): string | null {
  const key = (code ?? '').trim().toLowerCase();
  if (!key) return null;
  const entry = DENY_REASONS[key];
  if (!entry) return key; // raw code, never a guess
  return lang?.startsWith('de') ? entry.de : entry.en;
}

/** Exported so a test can pin EN and DE coverage in step. */
export const DENY_REASON_CODES = Object.keys(DENY_REASONS);

// ── Business hours, evaluated in the BUSINESS's timezone ─────────────

export interface HoursRange {
  open: string;
  close: string;
}

/**
 * "Now" as the business sees it: weekday and minutes since midnight in the
 * profile's zone. The browser gives the instant, never the zone, and `Intl`
 * does the conversion so DST is not our arithmetic.
 */
export function businessNow(
  timezone: string,
  now: Date = new Date(),
): { weekday: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    // An unknown zone is a backend bug; the browser zone at least renders.
    parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // Some ICU builds render midnight as "24" under hour12:false.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { weekday: get('weekday').toLowerCase().slice(0, 3), minutes: hour * 60 + minute };
}

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** A close before its open (22:00–02:00) is read as running past midnight. */
export function isOpenNow(
  hours: Partial<Record<string, HoursRange[]>>,
  timezone: string,
  now: Date = new Date(),
): boolean {
  const { weekday, minutes } = businessNow(timezone, now);
  const ranges = hours[weekday] ?? [];
  return ranges.some((r) => {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (open == null || close == null) return false;
    return close >= open
      ? minutes >= open && minutes < close
      : minutes >= open || minutes < close;
  });
}

/** "09:00 – 17:00" · "09:00 – 12:00, 13:00 – 17:00" · "closed today". */
export function todayHoursLabel(
  hours: Partial<Record<string, HoursRange[]>>,
  timezone: string,
  now: Date = new Date(),
): string {
  const { weekday } = businessNow(timezone, now);
  const ranges = hours[weekday] ?? [];
  if (!ranges.length) return 'closed today';
  return ranges.map((r) => `${r.open} – ${r.close}`).join(', ');
}
