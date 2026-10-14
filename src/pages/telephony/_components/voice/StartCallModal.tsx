/**
 * The call composer — one large modal for everything outbound.
 *
 *   Call now     → POST /api/voice/calls. The agent dials immediately with
 *                  nothing but the purpose as its briefing. The default.
 *   Schedule a   → POST /api/voice/calls/scheduled. The server places it at
 *   call           the moment you pick.
 *   Schedule an  → POST /api/voice/schedule. The agent calls, offers slots
 *   appointment    inside the timeframe, agrees one, and writes the calendar
 *                  event (Sprint 6 T6.1).
 *
 * These used to be three equal pills across the header, which gave the two
 * rarer ones the same weight as the one people came for. They are a split
 * button now: the mode you want is already showing, the others are behind the
 * chevron beside it, and `MODES` is the single table both halves read.
 *
 * There is no fourth mode. The call-queue one used to save a series of calls
 * to localStorage because no endpoint places one — a composer that looked
 * like it dialed and did not — so it is gone rather than badged.
 *
 * Contacts are a searchable picker column (real, /api/voice/contacts) —
 * scales past the handful that chips could hold. Opted-out contacts are
 * disabled: the backend would 403 them, and the UI should not pretend
 * otherwise (Sprint 8 T8.3).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  BookUser,
  CalendarCheck2,
  ChevronDown,
  Clock3,
  PhoneOutgoing,
  Search,
  User,
  Video,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AutoTextarea } from '@/components/ui/textarea';
import { useTranslation } from 'react-i18next';
import type { PincerError } from '@/lib/pincerClient';
import {
  COUNTER_FROM_CHARS,
  MAX_TASK_CHARS,
  PASTE_FLASH_CHARS,
  briefingError,
  briefingExamples,
  briefingSentNote,
  charCount,
  clampBriefing,
  truncatedToast,
  type BriefingField,
} from '@/pages/telephony/_lib/briefing';
import {
  useContacts,
  useInitiateCall,
  useScheduleAppointment,
  useScheduleCall,
} from '@/lib/api/voice';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Mode = 'appointment' | 'now' | 'later';

/**
 * The three things this modal can do, in menu order — dialling now first,
 * because it is the default and the reason the modal is usually open.
 *
 * One table, two readers: the split button renders the active row, the menu
 * renders all of them. They cannot drift out of step the way three hand-written
 * pills could.
 */
const MODES: {
  id: Mode;
  label: string;
  icon: typeof PhoneOutgoing;
  /** Right-hand note in the menu — what the agent does with it. */
  hint: string;
  /** Sits beside the button, so the choice explains itself without opening it. */
  blurb: string;
}[] = [
  {
    id: 'now',
    label: 'Call now',
    icon: PhoneOutgoing,
    hint: 'instant',
    blurb: 'The agent dials straight away with your purpose as its briefing.',
  },
  {
    id: 'later',
    label: 'Schedule a call',
    icon: Clock3,
    hint: 'at a time',
    blurb: 'The server places the call at the moment you pick.',
  },
  {
    id: 'appointment',
    label: 'Schedule appointment',
    icon: CalendarCheck2,
    hint: 'books a slot',
    blurb: 'The agent calls, agrees a slot in your timeframe and writes the calendar event.',
  },
];

/**
 * When a scheduled call should go out. "In 20 minutes" is how people actually
 * think about a call they want to make shortly — a date picker forces them to
 * do clock arithmetic to say it, and at 23:50 to get the date right too.
 */
type Lead = 5 | 15 | 30 | 60 | 120 | 'custom';

const LEAD_PRESETS: { value: Lead; label: string }[] = [
  { value: 5, label: 'in 5 min' },
  { value: 15, label: 'in 15 min' },
  { value: 30, label: 'in 30 min' },
  { value: 60, label: 'in 1 hour' },
  { value: 120, label: 'in 2 hours' },
  { value: 'custom', label: 'pick a time' },
];

type Timeframe = 'today' | 'tomorrow' | 'next_week' | 'custom';

const DURATIONS = [15, 30, 45, 60] as const;

/**
 * The languages the agent can hold a call in.
 *
 * Mirrors the backend's `KNOWN_LANGUAGES` in `voice/language.py`, which is what
 * `PINCER_VOICE_SUPPORTED_LANGUAGES` is filtered against (default `en,de,uk`)
 * and what ConversationRelay has a locale and a voice for. Offering anything
 * else here would just get resolved away to the default mid-call.
 *
 * The endonyms come from `voiceMeta`, the same table the call history and the
 * transcript header read — so a language is spelled one way across the app.
 * This list used to be hand-written next to those, which is how Ukrainian came
 * to be missing from the picker while the rest of the app already knew it.
 */
const CALL_LANGUAGES = ['en', 'de', 'uk'] as const;

/** `auto` lets the agent follow the callee — the language-consistency default. */
const LANGUAGES: { value: string; label: string }[] = [
  { value: '', label: 'Auto — follow the callee' },
  ...CALL_LANGUAGES.map((code) => ({ value: code, label: languageNative(code) })),
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * The preset timeframes resolved to the concrete [start, end] dates that go
 * over the wire. Shown back to the user under the picker, because "next week"
 * meaning Mon–Fri is a decision, not an obvious fact.
 */
function resolveTimeframe(
  tf: Timeframe,
  customStart: string,
  customEnd: string,
): { start: string; end: string } {
  if (tf === 'today') {
    const t = isoDate(new Date());
    return { start: t, end: t };
  }
  if (tf === 'tomorrow') {
    const t = isoDate(addDays(1));
    return { start: t, end: t };
  }
  if (tf === 'next_week') {
    const today = new Date();
    // Monday of next week, through the Friday after it.
    const toMonday = ((8 - today.getDay()) % 7) || 7;
    const monday = addDays(toMonday);
    const friday = addDays(toMonday + 4);
    return { start: isoDate(monday), end: isoDate(friday) };
  }
  return { start: customStart, end: customEnd };
}

function fmtRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: 'short' };
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  const left = s.toLocaleDateString(undefined, opts);
  return start === end ? left : `${left} – ${e.toLocaleDateString(undefined, opts)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

import PlatMenu from '@/pages/telephony/_components/shared/PlatMenu';
import PlatSelect from '@/pages/telephony/_components/shared/PlatSelect';
import { languageNative } from '@/pages/telephony/_lib/voiceMeta';
import { fromLocalInput, leadTimeLabel, stampIn } from '@/pages/telephony/_lib/planned';

const labelCls = 'text-xs font-medium text-[var(--text-3)]';
const inputCls =
  'rounded-[10px] border-[var(--line)] bg-[var(--sand)] text-[var(--ink)] placeholder:text-[var(--text-5)] focus-visible:ring-[color:color-mix(in_srgb,var(--ink)_25%,transparent)]';

/**
 * The purpose field — the text that becomes the agent's briefing.
 *
 * Everything here exists because of one bug: a purpose that did not reach the
 * call. So the field shows the paste landed (a flash on a big one), shows how
 * much room is left before the server's ceiling, refuses to drop a tail
 * silently, and says what is wrong in the server's own words before the
 * request is even made.
 */
function PurposeField({
  id,
  label,
  hint,
  value,
  onChange,
  field,
  serverError,
  fieldRef,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  field: BriefingField;
  /** A 422 the API answered with — shown verbatim, and it wins over ours. */
  serverError?: string | null;
  fieldRef?: React.RefObject<HTMLTextAreaElement>;
}) {
  const { toast } = useToast();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [touched, setTouched] = useState(false);
  const [flash, setFlash] = useState(false);
  const [maxPx, setMaxPx] = useState(() =>
    typeof window === 'undefined' ? 420 : Math.round(window.innerHeight * 0.5),
  );

  useEffect(() => {
    const onResize = () => setMaxPx(Math.round(window.innerHeight * 0.5));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const localError = briefingError(value, field, lang);
  const error = serverError || (touched && value.trim() ? localError : null);
  const count = value.length;
  const showCount = count >= COUNTER_FROM_CHARS;

  const set = (next: string) => {
    const { value: clamped, truncated } = clampBriefing(next);
    if (truncated) {
      toast({ title: truncatedToast(lang), variant: 'destructive' });
    }
    onChange(clamped);
    return clamped.length - value.length;
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={id} className={labelCls}>
          {label}
        </Label>
        {showCount && (
          <span
            className={cn(
              'font-mono text-[10.5px] tabular-nums',
              count >= MAX_TASK_CHARS ? 'text-red-600' : 'text-[var(--text-5)]',
            )}
            aria-live="polite"
          >
            {charCount(count, lang)}
          </span>
        )}
      </div>

      <AutoTextarea
        id={id}
        ref={fieldRef}
        value={value}
        onChange={(e) => set(e.target.value)}
        onBlur={() => setTouched(true)}
        onPaste={(e) => {
          const pasted = e.clipboardData?.getData('text') ?? '';
          if (pasted.length < PASTE_FLASH_CHARS) return;
          // Confirm the paste landed in full — the whole point of this field.
          setFlash(true);
          setTimeout(() => setFlash(false), 700);
        }}
        required
        minRows={3}
        maxRows={40}
        maxHeightPx={maxPx}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className={cn(
          inputCls,
          'transition-[border-color,box-shadow] duration-300',
          flash && 'border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-100)]',
          error && 'border-red-300',
        )}
      />

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[11px] text-red-600">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-[11px] text-[var(--text-5)]">
          {hint}
        </p>
      )}

      <BriefingHints lang={lang} />
    </div>
  );
}

/** Three examples: two goals, one non-goal. Illustration, never validation. */
function BriefingHints({ lang }: { lang: string }) {
  return (
    <ul className="space-y-0.5 pt-0.5">
      {briefingExamples(lang).map((ex) => (
        <li key={ex.text} className="flex gap-1.5 text-[10.5px] leading-relaxed">
          <span className={ex.good ? 'text-green-600' : 'text-[var(--text-5)]'} aria-hidden="true">
            {ex.good ? '✓' : '✗'}
          </span>
          <span className={ex.good ? 'text-[var(--text-4)]' : 'text-[var(--text-5)]'}>
            “{ex.text}”
            {ex.why && <span className="italic"> ({ex.why})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function StartCallModal({
  onClose,
  initialMode = 'now',
  initialNumber = '',
  initialName = '',
  initialPurpose = '',
  initialLanguage = '',
  thread,
}: {
  onClose: () => void;
  initialMode?: Mode;
  initialNumber?: string;
  initialName?: string;
  initialPurpose?: string;
  initialLanguage?: string;
  /**
   * S14 §3.4: the matter this call continues. Shown as a removable chip —
   * removing it means "actually, this is a new matter", and the backend then
   * decides where the call lands instead of being told.
   */
  thread?: { id: string; subject: string };
}) {
  const { toast } = useToast();
  const { data: contacts } = useContacts();
  const initiate = useInitiateCall();
  const schedule = useScheduleAppointment();
  const scheduleCall = useScheduleCall();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [contactQuery, setContactQuery] = useState('');

  // Shared form state
  const [number, setNumber] = useState(initialNumber);
  const [name, setName] = useState(initialName);
  const [purpose, setPurpose] = useState(initialPurpose);

  // Appointment state (POST /api/voice/schedule)
  const [topic, setTopic] = useState(initialPurpose);
  const [timeframe, setTimeframe] = useState<Timeframe>('tomorrow');
  const [customStart, setCustomStart] = useState(isoDate(addDays(1)));
  const [customEnd, setCustomEnd] = useState(isoDate(addDays(7)));
  const [duration, setDuration] = useState<number>(30);
  const [language, setLanguage] = useState(initialLanguage);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [attendeeDraft, setAttendeeDraft] = useState('');
  const [meetLink, setMeetLink] = useState(true);

  const range = resolveTimeframe(timeframe, customStart, customEnd);

  const addAttendee = (raw: string) => {
    const email = raw.trim().replace(/[,;]$/, '');
    if (!EMAIL_RE.test(email) || attendees.includes(email)) return;
    setAttendees((prev) => [...prev, email]);
    setAttendeeDraft('');
  };

  // A 422 belongs on the field that caused it, not in a toast stack (§5).
  const [purposeError, setPurposeError] = useState<string | null>(null);
  const purposeRef = useRef<HTMLTextAreaElement>(null);
  const { i18n } = useTranslation();

  const failValidation = (err: PincerError) => {
    if (err.status !== 422) return false;
    setPurposeError(err.message);
    purposeRef.current?.focus();
    return true;
  };

  // Attach to the thread it was opened from, until the owner says otherwise.
  const [attachThread, setAttachThread] = useState(true);
  const threadId = thread && attachThread ? thread.id : undefined;

  // Scheduled-call state (demo store — nothing dials on its own)
  const [lead, setLead] = useState<Lead>(15);
  const [customAt, setCustomAt] = useState('');

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const list = contacts ?? [];
    if (!q) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone_number.includes(q),
    );
  }, [contacts, contactQuery]);

  /**
   * A number typed by hand can still be one the picker would have refused.
   * The UI warns rather than blocks: the do-not-call list lives on the server
   * and the server's 403 is the authority, not this lookup.
   */
  const typedOptOut = (contacts ?? []).find(
    (c) => c.opted_out && c.phone_number === number.trim(),
  );

  const pickContact = (contactName: string, phone: string, optedOut: boolean) => {
    // Belt and braces: the button is disabled, but a keyboard path or a stale
    // render must not be able to load an opted-out number into the form.
    if (optedOut) return;
    setNumber(phone);
    setName(contactName);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'appointment') {
      schedule.mutate(
        {
          target_number: number.trim(),
          // `contact_name` is required (minLength 1); the number stands in when
          // the caller did not name anyone.
          contact_name: name.trim() || number.trim(),
          topic: topic.trim(),
          // The server takes one free-text window, not a start/end pair.
          timeframe: `${range.start} – ${range.end}`,
          duration_minutes: duration,
          ...(language ? { language } : {}),
          ...(attendees.length ? { attendees: attendees.join(', ') } : {}),
          ...(meetLink ? { location_or_meet: 'meet' } : {}),
          ...(threadId ? { thread_id: threadId } : {}),
        },
        {
          onSuccess: (r) => {
            toast({
              title: 'Appointment call started',
              description: `${r.call_sid} — ${briefingSentNote(topic.trim().length, i18n.language)}`,
            });
            onClose();
          },
          // The backend's own words: "no free slots", daily limit, quiet hours,
          // opt-out and validation are all different problems, and paraphrasing
          // them here would hide which guardrail actually fired. A 422 is about
          // the text in the field, so it goes to the field instead (§5).
          onError: (err) => {
            if (failValidation(err)) return;
            toast({ title: 'Could not schedule', description: err.message, variant: 'destructive' });
          },
        },
      );
      return;
    }

    if (mode === 'now') {
      initiate.mutate(
        {
          target_number: number,
          purpose,
          ...(name.trim() ? { target_name: name.trim() } : {}),
          ...(threadId ? { thread_id: threadId } : {}),
        },
        {
          onSuccess: (r) => {
            // The count is the confirmation that the text went with the call.
            toast({
              title: 'Dialing…',
              description: `${briefingSentNote(purpose.trim().length, i18n.language)}${r.call_sid ? ` · ${r.call_sid}` : ''}`,
            });
            onClose();
          },
          onError: (err) => {
            if (failValidation(err)) return;
            toast({ title: 'Call failed', description: err.message, variant: 'destructive' });
          },
        },
      );
      return;
    }

    if (mode === 'later') {
      scheduleCall.mutate(
        {
          target_number: number.trim(),
          purpose,
          ...(lead === 'custom'
            ? { at: fromLocalInput(customAt) }
            : { run_in_minutes: lead }),
          ...(name.trim() ? { target_name: name.trim() } : {}),
          ...(language ? { language } : {}),
          ...(threadId ? { thread_id: threadId } : {}),
        },
        {
          onSuccess: (call) => {
            toast({
              title: 'Call scheduled',
              description: [call.target_number, call.next_run_at ? new Date(call.next_run_at).toLocaleString() : null, briefingSentNote(purpose.trim().length, i18n.language)].filter(Boolean).join(' · '),
            });
            onClose();
          },
          // 422 covers both a purpose the agent could not open with and a
          // moment that has passed; the first belongs on the field.
          onError: (err) => {
            if (failValidation(err)) return;
            toast({ title: 'Not scheduled', description: err.message, variant: 'destructive' });
          },
        },
      );
    }
  };

  // The briefing gate is the server's, mirrored: a purpose the API would
  // refuse must not be dialable from here (§1.1).
  const topicOk = !briefingError(topic, 'topic', i18n.language);
  const purposeOk = !briefingError(purpose, 'task', i18n.language);
  const scheduledAt = lead === 'custom' ? fromLocalInput(customAt) : stampIn(lead);
  const canSubmit =
    mode === 'appointment'
      ? number.trim() !== '' && topicOk && range.start !== '' && range.end !== ''
      : mode === 'now'
        ? number.trim() !== '' && purposeOk
        : number.trim() !== '' && purposeOk && (lead !== 'custom' || customAt !== '');

  const pending = initiate.isPending || schedule.isPending || scheduleCall.isPending;

  // One split control, not three equal pills: dialling now is what the button
  // says, and the two scheduled variants sit behind the chevron next to it.
  // `MODES` stays the single source for the label and icon of each — the
  // button renders the active one, the menu renders all three.
  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  const submitLabel =
    mode === 'appointment'
      ? schedule.isPending ? 'Starting…' : 'Call & book'
      : mode === 'now'
        ? initiate.isPending ? 'Dialing…' : 'Call'
        : scheduleCall.isPending ? 'Scheduling…' : 'Schedule call';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] w-[92vw] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        {/* Header + mode switch */}
        <div className="border-b border-[var(--line-soft)] px-6 py-4">
          <DialogTitle className="flex items-center gap-2.5 text-base font-semibold text-[var(--ink)]">
            <div className="rounded-[10px] bg-[var(--sand)] p-2">
              <PhoneOutgoing className="h-4 w-4 text-[var(--ink)]" />
            </div>
            Start calls
          </DialogTitle>
          <div className="mt-3 flex items-center gap-2">
            {/* No `overflow-hidden` here, however tempting it is for the rounded
                ends: the menu panel is an absolutely-positioned child of the
                PlatMenu inside this wrapper, so clipping the wrapper clips the
                open menu down to the height of the button. The two ends are
                rounded individually instead. */}
            <div className="inline-flex items-stretch rounded-full bg-[var(--ink)] text-[var(--on-ink)]">
              <span className="flex h-8 items-center gap-1.5 rounded-l-full pl-3.5 pr-2.5 text-xs font-medium" data-testid="call-mode">
                <active.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {active.label}
              </span>
              <span className="my-1.5 w-px bg-[color:color-mix(in_srgb,var(--on-ink)_25%,transparent)]" aria-hidden="true" />
              <PlatMenu
                ariaLabel="Change call type"
                align="start"
                panelClassName="min-w-[304px]"
                triggerClassName="flex h-8 items-center rounded-r-full px-2 text-[var(--on-ink)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--on-ink)_15%,transparent)]"
                trigger={<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                sections={[
                  {
                    items: MODES.map((m) => ({
                      key: m.id,
                      label: m.label,
                      icon: m.icon,
                      hint: m.hint,
                      selected: m.id === mode,
                      onSelect: () => setMode(m.id),
                    })),
                  },
                ]}
              />
            </div>
            <p className="text-xs text-[var(--text-4)]">{active.blurb}</p>
          </div>
        </div>


        <div className="flex min-h-0 flex-1">
          {/* ── Contact picker column ── */}
          <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--line-soft)] bg-[color:color-mix(in_srgb,var(--ink)_1.5%,transparent)]">
            <div className="border-b border-[var(--line-soft)] p-3">
              <p className="plat-eyebrow mb-2 flex items-center gap-1.5 px-1">
                <BookUser className="h-3.5 w-3.5" />
                Contacts
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-5)]" />
                <Input
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  placeholder="Search name or number…"
                  className={cn(inputCls, 'h-9 bg-[var(--paper)] pl-9 text-xs')}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {!filteredContacts.length ? (
                <p className="px-3 py-6 text-center text-xs text-[var(--text-5)]">
                  {contacts?.length ? 'No contact matches.' : 'No contacts on the backend yet.'}
                </p>
              ) : (
                filteredContacts.map((c) => {
                  const active = number === c.phone_number;
                  const optedOut = c.opted_out === true;
                  return (
                    <button
                      key={c.phone_number}
                      type="button"
                      onClick={() => pickContact(c.name, c.phone_number, optedOut)}
                      disabled={optedOut}
                      title={
                        optedOut
                          ? `${c.name} is on the do-not-call list — the agent will not dial this number.`
                          : undefined
                      }
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left transition-colors',
                        optedOut
                          ? 'cursor-not-allowed opacity-45'
                          : active
                            ? 'bg-[var(--brand)]/50'
                            : 'hover:bg-[var(--paper)]',
                      )}
                    >
                      <span className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        active && !optedOut ? 'bg-[var(--brand)]' : 'bg-[var(--sand-deep)]',
                      )}>
                        {optedOut ? (
                          <Ban className="h-3.5 w-3.5 text-red-500" />
                        ) : (
                          <User className="h-3.5 w-3.5 text-[var(--text-4)]" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--ink)]">{c.name}</span>
                        <span className="block truncate font-mono text-[11px] text-[var(--text-5)]">{c.phone_number}</span>
                      </span>
                      {optedOut && (
                        <span className="ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wide text-red-600">
                          opted out
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* ── Form column ── */}
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="call-number" className={labelCls}>Number *</Label>
                  <Input
                    id="call-number"
                    placeholder="+49…"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    required
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="call-name" className={labelCls}>Name (optional)</Label>
                  <Input
                    id="call-name"
                    placeholder="Who is being called"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Which matter this call belongs to (S14 §3.4). Removable:
                  "actually, new matter" is a real case and the owner owns it. */}
              {thread && (
                <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--sand)] px-3 py-2">
                  {attachThread ? (
                    <>
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-3)]">
                        <span aria-hidden="true">🧵</span>
                        in thread:
                        <span className="truncate font-medium text-[var(--ink)]">{thread.subject}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setAttachThread(false)}
                        className="ml-auto rounded-full p-1 text-[var(--text-5)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                        aria-label={`Do not attach this call to ${thread.subject}`}
                        title="Start a new matter instead"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] text-[var(--text-4)]">
                        This call will start its own thread.
                      </span>
                      <button
                        type="button"
                        onClick={() => setAttachThread(true)}
                        className="ml-auto text-[11px] font-medium text-[var(--text-3)] underline decoration-dotted hover:text-[var(--ink)]"
                      >
                        Put it back in “{thread.subject}”
                      </button>
                    </>
                  )}
                </div>
              )}

              {typedOptOut && (
                <div className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5">
                  <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                  <p className="text-[11px] leading-relaxed text-red-700">
                    {typedOptOut.name} is on the do-not-call list. The backend will refuse this
                    number — its answer is what counts, so the button stays live.
                  </p>
                </div>
              )}

              {mode === 'appointment' ? (
                <PurposeField
                  id="appt-topic"
                  label="Topic *"
                  hint="The agent explains this on the call before offering slots. The field grows as you type — drag its corner for more room."
                  value={topic}
                  onChange={(v) => {
                    setPurposeError(null);
                    setTopic(v);
                  }}
                  field="topic"
                  serverError={purposeError}
                  fieldRef={purposeRef}
                />
              ) : (
                <PurposeField
                  id="call-purpose"
                  label="Purpose *"
                  hint="This text is the agent's briefing, word for word — line breaks included."
                  value={purpose}
                  onChange={(v) => {
                    setPurposeError(null);
                    setPurpose(v);
                  }}
                  field="task"
                  serverError={purposeError}
                  fieldRef={purposeRef}
                />
              )}

              {/* When the call itself goes out. Minutes first: "in 20 minutes"
                  is how someone actually thinks about a call they want to make
                  shortly, and a date picker makes them do the arithmetic. */}
              {mode === 'later' && (
                <div className="space-y-1.5">
                  <Label className={labelCls}>When *</Label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {LEAD_PRESETS.map((opt) => (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => setLead(opt.value)}
                        aria-pressed={lead === opt.value}
                        className={cn(
                          'flex h-10 items-center gap-1 rounded-[10px] px-3 text-xs font-medium transition-colors',
                          lead === opt.value
                            ? 'bg-[var(--ink)] text-[var(--on-ink)]'
                            : 'border border-[var(--line)] text-[var(--text-3)] hover:bg-[var(--sand)]',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {lead === 'custom' && (
                    <Input
                      type="datetime-local"
                      value={customAt}
                      onChange={(e) => setCustomAt(e.target.value)}
                      aria-label="Date and time for the call"
                      className={cn(inputCls, 'mt-1 w-64')}
                    />
                  )}

                  <p className="text-[11px] text-[var(--text-5)]">
                    {lead === 'custom' && !customAt
                      ? 'Pick the moment the call should go out.'
                      : `The agent dials at ${scheduledAt}${lead === 'custom' ? '' : ` · ${leadTimeLabel(scheduledAt)}`}. Quiet hours and the do-not-call list still apply then.`}
                  </p>
                </div>
              )}

              {mode === 'appointment' && (
                <>
                  {/* Timeframe — the window the agent may offer slots inside */}
                  <div className="space-y-1.5">
                    <Label className={labelCls}>Timeframe *</Label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {([
                        { id: 'today', label: 'Today' },
                        { id: 'tomorrow', label: 'Tomorrow' },
                        { id: 'next_week', label: 'Next week' },
                        { id: 'custom', label: 'Custom range' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setTimeframe(opt.id)}
                          className={cn(
                            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                            timeframe === opt.id
                              ? 'bg-[var(--ink)] text-[var(--on-ink)]'
                              : 'border border-[var(--line)] text-[var(--text-3)] hover:bg-[var(--sand)]',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                      {timeframe !== 'custom' && (
                        <span className="text-[11px] text-[var(--text-5)]">
                          {fmtRange(range.start, range.end)}
                        </span>
                      )}
                    </div>
                    {timeframe === 'custom' && (
                      <div className="grid grid-cols-2 gap-4 pt-1">
                        <div className="space-y-1.5">
                          <Label htmlFor="appt-from" className={labelCls}>From</Label>
                          <Input
                            id="appt-from"
                            type="date"
                            value={customStart}
                            min={isoDate(new Date())}
                            onChange={(e) => setCustomStart(e.target.value)}
                            className={inputCls}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="appt-to" className={labelCls}>To</Label>
                          <Input
                            id="appt-to"
                            type="date"
                            value={customEnd}
                            min={customStart || isoDate(new Date())}
                            onChange={(e) => setCustomEnd(e.target.value)}
                            className={inputCls}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Duration + language */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className={labelCls}>Duration</Label>
                      <div className="flex items-center rounded-full border border-[var(--line)] bg-[var(--paper)] p-0.5">
                        {DURATIONS.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDuration(d)}
                            className={cn(
                              'flex-1 rounded-full px-2 py-1.5 text-xs font-medium tabular-nums transition-colors',
                              duration === d
                                ? 'bg-[var(--ink)] text-[var(--on-ink)]'
                                : 'text-[var(--text-4)] hover:text-[var(--ink)]',
                            )}
                          >
                            {d} min
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="appt-language" className={labelCls}>Language</Label>
                      <PlatSelect
                        id="appt-language"
                        value={language}
                        onChange={setLanguage}
                        ariaLabel="Call language"
                      >
                        {LANGUAGES.map((l) => (
                          <option key={l.value} value={l.value}>
                            {l.label}
                          </option>
                        ))}
                      </PlatSelect>
                    </div>
                  </div>

                  {/* Attendees */}
                  <div className="space-y-1.5">
                    <Label htmlFor="appt-attendees" className={labelCls}>
                      Attendees (optional)
                    </Label>
                    {attendees.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {attendees.map((a) => (
                          <span
                            key={a}
                            className="flex items-center gap-1 rounded-full bg-[var(--sand-deep)] py-1 pl-2.5 pr-1 text-[11px] text-[var(--text-2)]"
                          >
                            {a}
                            <button
                              type="button"
                              onClick={() => setAttendees((prev) => prev.filter((x) => x !== a))}
                              className="rounded-full p-0.5 text-[var(--text-5)] hover:text-[var(--ink)]"
                              aria-label={`Remove ${a}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <Input
                      id="appt-attendees"
                      type="email"
                      placeholder="name@company.com — Enter to add"
                      value={attendeeDraft}
                      onChange={(e) => setAttendeeDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addAttendee(attendeeDraft);
                        }
                      }}
                      onBlur={() => addAttendee(attendeeDraft)}
                      className={inputCls}
                    />
                    <p className="text-[11px] text-[var(--text-5)]">
                      They receive the calendar invitation once the slot is agreed.
                    </p>
                  </div>

                  {/* Meet link */}
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-[var(--line)] px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={meetLink}
                      onChange={(e) => setMeetLink(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-[var(--line)]"
                    />
                    <Video className="h-3.5 w-3.5 text-[var(--text-5)]" />
                    <span className="text-xs text-[var(--text-2)]">Add a video-meeting link</span>
                  </label>

                  {/* The backend's own error, in full — toasts truncate. */}
                  {schedule.isError && (
                    <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5">
                      <p className="text-xs font-medium text-red-700">
                        {schedule.error.message}
                      </p>
                      {schedule.error.status === 404 && (
                        <p className="mt-1 text-[11px] leading-relaxed text-red-700/80">
                          This Pincer backend does not expose POST /api/voice/schedule yet — it
                          arrives with Sprint 6 T6.1.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {mode === 'now' && initiate.isError && (
                <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5">
                  <p className="text-xs font-medium text-red-700">{initiate.error.message}</p>
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-[var(--line-soft)] px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-2 text-xs font-medium text-[var(--text-4)] hover:bg-[var(--sand-deep)] hover:text-[var(--text-2)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit || pending}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-colors',
                  canSubmit && !pending
                    ? 'bg-[var(--ink)] text-[var(--on-ink)] hover:opacity-85'
                    : 'cursor-not-allowed bg-[var(--sand-deep)] text-[var(--text-5)]',
                )}
              >
                {mode === 'appointment' ? (
                  <CalendarCheck2 className="h-3.5 w-3.5" />
                ) : (
                  <PhoneOutgoing className="h-3.5 w-3.5" />
                )}
                {submitLabel}
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
