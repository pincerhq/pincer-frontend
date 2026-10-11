# Voice app (`/telephony`) — real data and the mock contract

The Voice page is the telephony app's default screen and runs on **real data**
from `/api/voice/*` on the connected Pincer backend (`src/lib/pincerClient.ts`
owns the token; `src/lib/api/voice.ts` owns the types and hooks). Nothing on it
is demo data unless it is wearing a badge.

## The contract

> Real data or a visible `MOCK` badge — with the reason, and the follow-up that
> will replace it.

Badged surfaces stay on the page rather than being hidden: an operator needs to
know the capability is planned, and a reviewer needs to see what is not wired
yet. `src/components/voice/MockedBadge.tsx` provides the three variants
(`MockedBadge`, `MockedSection`, `MockedRouteBanner`); the two containers carry
`data-mock="true"` so the inventory is countable from the DOM and from a grep.

**The count is pinned by a test** — `src/test/voice/mockInventory.test.ts`.
De-mocking something is a deliberate edit to that list, so a badge can neither
linger on a real feature nor quietly vanish from a fake one.

## Mock inventory

| Section | State | Why |
|---|---|---|
| Call history, active calls, transcripts, actions | **real** | `/api/voice/calls`, `/active`, `/calls/{sid}` |
| Outbound call | **real** | `POST /api/voice/calls` |
| Appointment scheduling | **real** | `POST /api/voice/schedule` (Sprint 6 T6.1) |
| Per-call cost | **real** — badge removed in v2 | `call_costs` (Sprint 9 T9.1) |
| Turn latency | **real** | `TURN_LATENCY` events (Sprint 5 T5.1) |
| Outcome / failure code | **real** | Sprint 3 T3.1, Sprint 9 T9.3 |
| Daily limit · quiet hours · opt-out list | **real** (read-only) | Sprint 8 T8.3 |
| Agent call summary | **real** | `/api/chat/message` under an isolated summarizer identity |
| Live listen-in | **player built, backend pending** | Renders only where `/api/voice/active` reports `listen_available` — no fork, no button |
| Sentiment & talk ratio | **real** — badge removed in S16 | Per-call `analytics` (speech ms, interruptions, sentiment + rationale) |
| Call controls (mute/hold/transfer) | `MOCK` | Inert — needs the media proxy plus a control endpoint |
| Do-not-call list | **real** — CRUD | `GET/POST/DELETE /api/voice/do-not-call` |
| Voice turn model | **real** — writable | `GET/PUT /api/voice/config` |
| Hard limits · retention · approval mode | `MOCK` | Real server settings, but no endpoint reports or accepts them — defaults shown with their env vars |
| Scheduled calls | **real** — CRUD | `GET/POST/DELETE /api/voice/calls/scheduled` (S17) |
| Call queue · locally planned calls | `MOCK` | No call-queue endpoint; entries persist in `localStorage` |
| Follow-up task · call tag | `MOCK` | No task/tag endpoints; persisted in `localStorage` |

## Degrading gracefully

Every field v2 added is optional on the wire. Against a backend that predates
them the page renders exactly the v1 table — columns, chips, filters and panels
appear per-field, the moment data for them starts arriving. Consequences worth
knowing:

- Filter dropdowns are built from the loaded history, so they only ever offer
  outcomes, failure codes and languages that actually occur. No dead options.
- Sorting by latency or cost sinks rows that have no value to the bottom in both
  directions — an unpriced call is not the cheapest call.
- The cost total in the stats strip is labelled with how many rows it covers
  when some are unpriced, so a partial sum never reads as the whole bill.
- A failed calendar write is never rendered as a booked appointment. See
  `AppointmentPanel` and `src/test/voice/appointmentPanel.test.tsx`.

## Files

| File | Role |
|---|---|
| `src/lib/api/voice.ts` | Types + TanStack Query hooks for every `/api/voice/*` call |
| `_components/voice/VoicePage.tsx` | The page: header, active calls, history table, detail rail |
| `_components/voice/StartCallModal.tsx` | Composer — Schedule appointment / Free-form call / Queue |
| `_components/voice/AppointmentPanel.tsx` | Candidates, agreed slot, status timeline, retries |
| `_components/voice/LatencyPanel.tsx` | Per-turn STT / LLM-TTFT / TTS bars against the Sprint 5 targets |
| `_components/voice/CallOutcomePanel.tsx` | Outcome card + follow-up toolbox |
| `_components/voice/LimitsStrip.tsx` | Daily limit, quiet hours, read-only opt-out list |
| `_components/voice/CallChips.tsx` | Language flag, outcome/latency chips, cost, appointment marks |
| `_lib/voiceMeta.ts` | Language table, language-switch parsing, outcome taxonomy, formatting |

## v3 — in-call tools (S11) and the receptionist (S12)

Two operational surfaces were added, both near-real-time.

**Live approvals.** A `user`-mode tool call parks server-side and the dashboard
decides it *while the caller is on hold* (S11 default timeout: 25s). The card is
mounted at the app root, not on the Voice page, because the owner is almost
never on /telephony when it fires. Delivery is SSE-first
(`/api/approvals/stream`, event `voice_approval`) with a 3s poll of
`/api/voice/approvals/pending` as the fallback — the fallback is what makes a
dead stream slow rather than silent. The countdown is computed from the
server's `expires_at` on every tick: a card that renders late shows the time
that is actually left, not a fresh window.

**Receptionist.** Profile, inbound stats and blocklist on the Voice page; the
messages the receptionist took at `/telephony/messages`, with the unread count
in the rail. Open/closed is evaluated in the *business's* timezone (the profile
carries an IANA zone) — never the browser's.

Both degrade to nothing: no endpoint, no surface. The receptionist panel says
"not configured" on a 404 rather than rendering empty numbers.

| File | Role |
|---|---|
| `src/components/voice/VoiceApprovalHost.tsx` | Root-mounted stack of live approval cards + the sound preference |
| `src/components/voice/ApprovalCard.tsx` | One approval: countdown ring, args preview, approve/deny, terminal states |
| `_components/voice/MessagesView.tsx` | Messages inbox — list, drawer, mark-read, callback prefill |
| `_components/voice/ReceptionistPanel.tsx` | Business profile, inbound stats strip, blocklist |
| `_components/voice/PolicyPanel.tsx` | Read-only resolved tool policy (Settings → Voice) |
| `_components/voice/CallActionsTimeline.tsx` | Actions v2: tier/mode chips, deny reasons, autonomy disclosure |
| `src/lib/sse.ts` | The app-level `text/event-stream` reader |

Deny-reason codes map to sentences in **both UI languages** in `_lib/voiceMeta.ts`;
an unmapped code renders as the raw code rather than a wrong sentence.

Open backend asks live in `~/Desktop/BACKEND-voice-v3.md` (this task),
`~/Desktop/BACKEND-voice-v2.md` and `~/Desktop/BACKEND-voice-call-history.md`.

## v4 — call threads (S14)

History is read as **matters**, not calls. A thread is one subject: every call
about it in order, the rolling summary the backend keeps, and what each side
promised. `/telephony/calls` opens on the Threads view (the flat table is one
toggle away and remembers the choice); a thread opens at
`/telephony/threads/{id}`.

The thread detail is the centrepiece: an inline-editable subject, the status
chip with **only** the transitions the API accepts (`open→resolved`,
`resolved→open|closed`, `closed→` nothing — an invalid button is never
rendered), the rolling summary with its final state line emphasised, the
commitments table (expired first, done struck through, read-only — they are
extracted from the calls), and the call timeline. Each timeline entry carries a
glyph for *why* the call is in the thread: ● first call, ↻ retry, ➕ follow-up,
⇠ inbound match, ✎ assigned by hand. The ⇠ tooltip discloses that the match is
a heuristic, because reassigning it is the correction path.

Expanding an entry renders the same call detail the Voice page uses — one
`CallDetailBody`, no second transcript renderer. A call whose transcript
retention removed says so and stays in the timeline; it is never an error.

Threads are additive everywhere else: a 🧵 column and a "threadless only"
filter in the flat table, a breadcrumb plus ←/→ navigation in the call detail,
a 🧵 chip on inbox rows whose call-back carries the thread, one context line on
the mid-call approval card, and an amber count of open threads with expired
commitments on the All Calls nav row.

| File | Role |
|---|---|
| `_components/threads/ThreadsView.tsx` | The threads list — status filters, server-side search, past-due toggle |
| `_components/threads/ThreadDetailView.tsx` | One matter: header, summary, commitments, call timeline, follow-up |
| `_components/threads/ThreadBits.tsx` | Thread chip, status chip, attach glyph, commitments table |
| `_components/threads/ThreadManageModals.tsx` | Assign a call · merge a thread (two-step, irreversible) |
| `_components/voice/CallDetailBody.tsx` | The shared call detail: appointment, latency, transcript, actions |
| `_lib/threadMeta.ts` | Status machine mirror, attach-kind meaning, commitment ordering, date phrasing |

The API is merged. Its wire shapes differ from the ones this was drafted
against (`thread_id` not `id`, `primary_number` not `contact_number`,
`open_commitments` on both list and detail, thread calls as stubs), so
`lib/api/voice.ts` translates them once in `toThread` / `toThreadDetail`
rather than spreading the difference across nine components. The delta table
is in `~/Desktop/BACKEND-voice-threads.md`. A backend that predates the
endpoints answers 404 and the list says so as absence, not as an error.

## v5 — call briefings

The purpose someone types **is** the agent's briefing, word for word, and the
app now proves it end to end.

**Writing it.** The composer's Purpose/Topic field mirrors the server's own
gate (`pincer.voice.briefing`): 10 characters for a free-form task, 3 for an
appointment topic, 2,000 as the ceiling. Below the minimum the Call button is
disabled and the field shows the server's sentence — in English it is
byte-identical to the 422 the API would answer with. A paste over the ceiling
keeps the head and says so in a toast; it never drops a tail silently. The
counter appears at 1,500. A paste of 300+ characters flashes the border, so a
long briefing is visibly landed. Three do/don't examples sit under the field —
illustration only: nothing beyond length is ever blocked. On success the toast
confirms the size that went with the call ("briefing sent (312 chars)"), and a
422 lands on the field with focus, not in a toast.

**Seeing it.** Active-call rows show `briefing_task_preview` — what the backend
holds, not what a form once submitted. The call detail opens with a Briefing
panel: the task verbatim with its line breaks, the source it came from, a copy
button, and an adherence line built from data that already exists — the
extracted `task_result` in green, its absence on a completed call in amber, and
no judgement at all on a call that never happened. The `[BRIEFING]` system line
in the transcript renders as a divider that expands, never as something
someone said. A call from before briefings existed says so.

**Not blaming the user.** `failure_code=briefing_lost` reads "briefing lost
(system)" with a tooltip stating it is a system error and to retry.

**Prefills.** A thread follow-up seeds the purpose with the subject and the
oldest open commitment; an inbox call-back seeds it with the caller and the
matter. Both are editable and count toward validation — the point is that the
commonest reason to paste a purpose is gone.

| File | Role |
|---|---|
| `_lib/briefing.ts` | The server's rules mirrored: limits, messages (de/en), clamping, stubs |
| `_components/voice/BriefingPanel.tsx` | The verification surface: task verbatim, source, copy, adherence |
| `_components/voice/StartCallModal.tsx` | `PurposeField`: counter, paste flash, hints, 422-on-the-field |
| `components/ui/textarea.tsx` | `AutoTextarea` — grows to 50 vh, then scrolls; drag still wins |

## v6 — sentiment & talk ratio (S16)

Two numbers per call, and a rule about how to say them: analytics **describe
the call, never the person**. The phrasing is "Caller seemed frustrated",
never "is"; there are no emoji faces anywhere (a face is a judgement, and it
does not travel across cultures); and a call with no reading says which kind
of nothing it is — "Call too short to assess", "Not assessed", "No speech to
analyze" — rather than defaulting to Neutral, which would be a verdict nobody
made.

The call detail gains a **How the call went** panel: a stacked talk-time bar
(agent · caller · muted silence) whose segments are rounded by largest
remainder so they sum to exactly 100, interruptions when there were any, and
the sentiment chip with its **rationale on screen** — a bare label invites
trust it has not earned. On the ConversationRelay engine the numbers are
inferred from text length, so every percentage carries a `≈` whose tooltip
says exactly that and what would make it exact. When retention has taken the
transcript, the chip stays and the rationale line says why it is gone.

The history table gains a sentiment dot (empty cell, never a grey dot, for
calls with no reading), a 40 px agent-share bar, and a sentiment multi-select
that includes "not assessed". The list endpoint has no sentiment filter, so
the menu says it filters the calls loaded so far rather than implying it
searched the server. The receptionist strip gains the window's distribution,
withheld below five assessed calls — "33% negative" out of three is a sentence
that sounds like a trend and is not.

Sentiment is post-call only. Nothing on the live surfaces — active calls,
listen-in, the approval card — shows it, and nothing should: the agent is not
watching anyone's mood in real time.

| File | Role |
|---|---|
| `components/voice/analytics/sentimentCopy.ts` | Every string and colour, de/en — the single source |
| `components/voice/analytics/AnalyticsPanel.tsx` | The call-detail card: talk row + sentiment row |
| `components/voice/analytics/TalkRatioBar.tsx` | Stacked bar, silence, interruptions, the `≈` mark |
| `components/voice/analytics/SentimentChip.tsx` | Dot + label + trajectory + the rationale line |
| `components/voice/analytics/SentimentDot.tsx` | The compact mark, reused by history and thread timelines |
| `components/voice/analytics/talkMath.ts` | Largest-remainder rounding and clock formatting |

**One badge is left**, not zero: live listen-in still needs call audio in a
browser and there is no endpoint or media proxy for it. The inventory test
pins the count at one and would fail the moment the badge is removed without
the feature — which is the point of the file.

## v7 — live listen-in (S15, frontend half)

The owner can listen to a call while it happens. Listen-only by construction:
the server subscribes the browser to a receive-only Twilio media fork, so
there is no path from this UI into the call — no whisper, no barge-in, no
record button, and no playback of calls that already ended.

The 🎧 control sits on the active-call row (Voice page and Live view) and
appears **only** where `/api/voice/active` reports `listen_available`. Clicking
it is the user gesture the browser requires; nothing ever starts playing on
its own. The session opens a WSS to `/api/voice/listen/{call_sid}` carrying
the bearer in `Sec-WebSocket-Protocol` rather than a query string, decodes
Twilio's base64 μ-law frames in the browser, and feeds two AudioWorklet jitter
buffers — one per track — behind their own gain nodes, so muting the agent
while the caller keeps playing is a gain change rather than a re-plumb. The
buffer holds 300 ms and drops the oldest audio past a second: a listener who
falls behind wants the live call, not a backlog.

Failure states are the interesting half: the listener cap closes with 4001 and
says "listener limit reached" without retrying into it; an unexplained drop is
retried exactly once, silently, and then becomes an error rather than a
reconnect loop; the call ending says so and collapses the panel after three
seconds.

| File | Role |
|---|---|
| `components/voice/listen/ListenIn.tsx` | The control, the panel, per-track meters and mutes |
| `components/voice/listen/listenClient.ts` | The socket and its state machine — no audio, no React |
| `components/voice/listen/audioSink.ts` | AudioWorklet jitter buffers, per-track gain, levels |
| `components/voice/listen/mulaw.ts` | G.711 μ-law → Float32, built from the definition |

**The backend half is not merged** (config, TwiML fork, `MonitorHub`, both
sockets, the audit row and the announce gate). The contract the player was
built against — including the WebSocket auth decision the spec leaves open —
is in `~/Desktop/BACKEND-voice-listen-in.md`.

With the placeholder gone, **no section on the Voice page carries a MOCK badge
any more**. That means nothing on the page pretends — not that everything is
built. The inventory test now pins zero badges *and* asserts the listen player
is gated on `listen_available`, so a placeholder cannot come back without its
badge.

## v8 — scheduled calls (S17)

"Call them in 20 minutes" is a thing people ask for, and the composer could
only take a date. It now takes a lead time — 5 / 15 / 30 minutes, 1 or 2
hours, or an exact datetime — and the call is really placed: the backend
stores it as a one-off schedule whose action dispatches to
`pincer.voice.scheduled_calls`, which calls `make_phone_call` when it comes
due. That means a scheduled call meets the same do-not-call list, quiet hours
and daily caps as one placed by hand, and the panel says so before you commit.

Minutes go over the wire **as minutes**: the server does the arithmetic
against its own clock, so a form left open does not drift the moment. An exact
time goes as a naive local string plus the browser's IANA zone, so "09:15"
means 09:15 where the person typing it is. The number and the briefing are
validated when the schedule is written, not at fire time — a call refused at
23:10 with nobody watching is exactly the failure worth avoiding — and a 422
lands on the purpose field the same way an immediate call's does.

The Planned screen lists the server's pending calls with their lead time
("in 1 h 40 min") and cancels them on the server. Call **queues** on that page
are still local demo data: no endpoint places a series of calls, and the route
banner now says which half is which.

Backend, for once, in the same pass: `voice/scheduled_calls.py`, the
`voice_call` entry in `tasks/actors.py`, three routes in `api/voice.py`
declared above `/calls/{call_sid}`, and `tests/test_voice_scheduled_calls.py`.


## v9 — Block I foundation (FE0)

The voice app is now the **3days.ai owner app** (Block I). FE0 added no owner
feature; it bound the foundation every FE sprint builds on — see
`docs/app/FE0-audit.md`, `docs/app/FE-ADR-004-stack-binding.md` and
`docs/app/FE-BINDING.md` for the decisions and paths.

What changed on this page's terms: `apiFetch` is now an alias of the typed
client in `src/lib/api/client.ts` (same behaviour, plus 422 field mapping,
a 204 that no longer reads as "no endpoint", and a 401 that logs the session
out and returns you to the view you were in). Types are generated from the
backend's OpenAPI document and pinned to a backend commit in
`api-contract.lock`; `npm run check:api` fails on drift. The rail is German by
default and translated (`voice-nav`), hides items the backend reports off, and
is joined by bottom tabs under `md`. Every owner surface from the ownership
matrix that does not exist yet is mounted as a badged placeholder naming its
sprint — sixteen `data-mock` usages, pinned in `mock-count.lock`, and that
number may only go down.

## v10 — owner login, shell & Übersicht (FE1)

The home screen a pilot looks at every morning. `/telephony` is now the
**Übersicht**: Heute (counts), Jetzt (live calls with a ticking duration and
masked numbers), Braucht Sie (up to five items), Status (number, mode,
calendar, residency chip, one-line check) and Kosten heute (one number,
hidden when the cost API is not exposed). Two cards wear a
"berechnet im Browser" badge because the server has no `stats` or
`needs_attention` endpoint yet — the numbers are counted in the browser from
today's loaded calls and messages, in the business's time zone, and the badge
says so. No engine names or latency figures reach the page; `?debug` reveals
them for founders.

Owners sign in at `/telephony/login` (`docs/app/login.md`) with their name or
email and password; "Dieses Gerät merken" is off by default. The shell gained the final
navigation (Übersicht · Anrufe · Aufmerksamkeit · Wissen · Berichte · Kampagnen
· Einrichtung ▸ … · Assistent · Vertrauen, with Betrieb and Erweitert for the
operator views), a collapsible rail, four bottom tabs, a persistent status
banner (active / not active / server unreachable after two failed health polls
/ SIP lost) and a user menu with DE/EN and logout. `Assistent` mounts the
existing web chat as-is. Numbers render through `MaskedNumber` everywhere on the
new surfaces: masked in lists, revealable and copyable for the owner role.

| File | Role |
|---|---|
| `src/pages/telephony/OwnerLoginPage.tsx` | Name/email + password sign-in, remember-device |
| `src/stores/session.ts` | `login/logout`, `identity`, `can()` role gating |
| `_components/shared/StatusBanner.tsx` | The one-line banner and its state machine |
| `_components/overview/*` | The five cards and the badge they share |
| `src/lib/api/owner/overview.ts` | Today stats, attention list, residency/doctor/costs/calendar readers |
| `components/voice/MaskedNumber.tsx` | Masked by default, owner reveal, role-gated copy |

## v11 — Anrufe for owners (FE2)

`/telephony/calls` is now the owner's history and `/telephony/calls/:sid` the
single place to read a call; the operator voice page moved to
`/telephony/calls/ops` (Erweitert › Betriebsansicht Anrufe) unchanged. The
owner surfaces translate every backend state into one **Ergebnis** chip
(`resultGroupOf`), resolve contact names, mask numbers everywhere, keep the
filters in the URL without PII, and render the transcript as speech lines
plus timeline events with client-side number masking — the full view waits
for the server's audited reveal. Aufmerksamkeit is the inbox with the real
mark-read endpoint. Details in `docs/app/calls.md`; asks in
`~/Desktop/BACKEND-FE2-api-asks.md`.

| File | Role |
|---|---|
| `src/lib/api/owner/calls.ts` | Result/intent mapping, contacts, PII-free filters, transcript parser, CSV, local handled state |
| `_components/owner-calls/CallsListView.tsx` | History: live section, filters, DataTable, export |
| `_components/owner-calls/CallDetailPage.tsx` | Header, summary, tabs/accordion, call-back |
| `_components/owner-calls/TranscriptView.tsx` | Verlauf: owner labels, events, masking, search |
| `_components/owner-calls/AttentionView.tsx` | Inbox v1.5 with mark-read and derived call items |
| `_components/owner/SprintBadge.tsx` | The badge that names its unblocking sprint |

## v12 — Einrichtung: Unternehmensprofil & Telefonie (FE3)

Two editors under Einrichtung. `/telephony/settings/profile` is the business
profile — eight sections, autosave, a diff before "Aktivieren", versions with
restore, an hours grid that knows Bundesland holidays, a greeting whose AI
disclosure is a locked block, a voice picker and a hearable preview.
`/telephony/settings/telephony` is the number: mode decision, provider guides
with the reception number filled in, a self-test that reports a lost
caller-ID honestly, SIP status, and the test-call checklist FE4 reuses. The
backend routes both pages bind to (C1 profiles, B1 numbers/self-test, A3
voices) are not in the pinned contract; each page says so with one banner
and never fakes persistence. See `docs/app/setup-profile.md`,
`docs/app/telephony.md`, `~/Desktop/BACKEND-FE3-api-asks.md`.

## v13 — Einrichtungsassistent (FE4)

`/telephony/setup/*` walks an owner from industry to go-live in ten steps that
render the FE3 sections on one shared form — a sequence over the same data,
re-enterable from Einrichtung. Progress lives on the server (C2) or, until
then, in this browser with a badge; "Am Computer fortsetzen" hands the step
over to a magic link. Telefonie is a decision tree into the FE3 self-test, a
SIP profile with its required fields, or a badged purchase panel. Kalender &
Konten does Google OAuth in the browser and Microsoft 365 by device code, then
picks the booking calendar. Testanruf watches the live call and ticks what it
can verify. Go-live shows doctor-gated checks — RED blocks, AMBER needs a
signature — and ends in a success screen with the disclosure sentence.
Details in `docs/app/setup-wizard.md`; backend tasks in
`~/Desktop/BACKEND-FE4-api-asks.md`.

## v14 — bound to C1/C2/B1 as shipped

The profile editor, the telephony page and the wizard now talk to the real
routes: profiles with versions (autosave = inactive version, activate = the
version goes live), the server's fixed disclosure sentence and hash, hours
as `"08:00-12:00"` strings, the B1 self-test via `POST …/selftest` and a
status poll with the carrier hint, SIP providers/accounts/status, regulatory
bundles for number purchase, numeric C2 setup steps with server-side gates,
Google OAuth through the JSON start URL and the `/setup?step=4&google=ok`
return route, MS365 device code by flow id, and the doctor-based go-live
report. Six badges went with it (profile and setup local fallbacks, purchase,
SIP, computed go-live, two banners); what remains is documented in
`~/Desktop/BACKEND-FE4-api-asks.md`.

## v15 — Wissen, Autoprofil, Anliegen-Regeln (FE5)

`/telephony/knowledge` shows what the assistant knows: sources with owner
statuses and per-chunk (never bulk) release of sensitive content, website
and file intake with progress, a test console that answers as the caller
would hear it with source chips and a three-state confidence, and the
unanswered questions that become answers in one click.
`/telephony/rules` builds deterministic rules from keyword chips — no
pattern for owners — with the exact spoken sentence, a dry-run that asks the
backend engine, and industry packs added disabled. The profile editor gains
the Website-Autoprofil banner and a review page that applies only what the
owner marks. D1/D2 are not on the backend yet; each page says so once.
`docs/app/knowledge.md`, `docs/app/rules.md`, `~/Desktop/BACKEND-FE5-api-asks.md`.

## v16 — Wissen & Regeln bound to D1/D2 as shipped

Sources, upload, recrawl, the chunk list, retrieval search, unanswered
questions and the FAQ flywheel run on D1's routes; rules, reorder, the
engine's dry-run and packs on D2's; the autoprofile job, status and apply on
D2's. Three page banners went (badge count 25). What the backend does not do
yet — a generated spoken answer in the console, per-chunk release, pause,
ignore, hit counts, pack install disabled, evidence excerpts — is in
`~/Desktop/BACKEND-FE5-api-asks.md`.

## v17 — Datenschutz & Vertrauen (FE6)

`/telephony/settings/privacy` shows what A2 proves: the residency manifest
per leg (red rows never hidden, mode `none` as an amber banner here and on
the Übersicht), subprocessors derived from it, the recording/consent facts,
the evidence ZIP per call (also on every call detail), and the mode
one-pager from `/api/voice/compliance`. Retention, subject export, erasure
(preview + typed confirmation), export per period and the other documents
are wired to the routes named in `~/Desktop/BACKEND-FE6-api-asks.md` and
wear an A4 badge until they answer. `/telephony/trust` renders claims only
with evidence — otherwise "Nachweis folgt" — and browser-computed 30-day
numbers. Two placeholders went; eleven honest badges came (lock 37): the
trust page is by design a list of what is proven and what is not yet.
`check:api` drift in this session is the stale process on :8080 (104 paths,
no D1/D2 routes) — the snapshot (120 paths) matches the working tree.

## v18 — Werkzeuge, Nachfass, Integrationen, Live-Ereignisse (FE7)

`/telephony/settings/tools` binds E1 as it exists: the tool-policy list with
owner names from a curated map, tiers in owner words, X rows without a
switch, "Nur mit Freigabe" as `approval_override: user`, and the per-profile
opt-in written as a new activated profile version. The call detail's
Aktionen tab lost its badge (tool timeline in owner words). Nachfass and
Integrationen are built against the routes agreed with E2/E3 and show one
banner each while those do not exist; the opt-out count, consent mode and
connected accounts are real. The event-stream client replaces polling
whenever `/api/events/stream` answers and falls back silently otherwise.
Three placeholders went; the badges are the two banners, the Nachfass tab
(now naming E2), the CRM cards and the recipes card (lock 42).
Asks in `~/Desktop/BACKEND-FE7-api-asks.md`.

## v19 — Berichte, Aufmerksamkeit, Kampagnen (FE8)

`/telephony/reports` renders G2's report when it exists and otherwise a
browser-computed one with every number marked "geschätzt"; delivery
preferences and the KPI tiles follow the same rule (the disclosure rate is
never invented). `/telephony/attention` is now the queue: server rows from
G2 when available, otherwise the computed items with the real message
"Erledigt" and a browser-local one for calls (timestamped now, feeding the
time-to-callback KPI), filters, bulk, j/k/e, no-show buttons. Kampagnen
(behind the capability flag) walks F1's wizard against the agreed routes
with one banner; the legal-basis gate, the scrub screen and the read-only
caller ID hold without the server. Two placeholders went; the badges that
came are the G2 queue hint, the report/KPI computed badges, the delivery
and archive badges, the F2 reminders and the F1 banner. Asks in
`~/Desktop/BACKEND-FE8-api-asks.md`.

## v20 — Team & Rollen, Branchenvorlagen, Website-Widget (FE9)

Auth Phase 2 binds C3 as shipped: role and tenant come from `/api/status`
(`/api/auth/session` is tried first), staff see no settings, admins get the
"Im Auftrag von" banner, the tenant switcher clears every cache and remounts
the shell, members and once-shown tokens run on `/api/tenants/{id}`. Seven
vertical packs apply as a draft through the FE3 diff with their rules
disabled. The widget is a real 7.6 KB (gz) vanilla bundle in
`packages/widget` with a size gate in CI; its settings page waits for G3
behind one banner while preview and embed snippet work from the local
build. The last two placeholders went. Asks in
`~/Desktop/BACKEND-FE9-api-asks.md`.

## v21 — GA v2 frontend gate (FE10), app 1.0.0

Zero mock badges in the owner app: what the backend serves is real, what it
does not serve is hidden behind declared or probed capability flags and
listed on the new "Was ist neu / Noch nicht" page. Fact chips replace the
computed badges. Every view is a lazy chunk (owner app 74.5 KB gz initial;
the platform shell's entry chunk was cut from 567.7 to 227.8 KB gz on
2026-09-08 by lazy-loading its pages, closing that gate's dated exception). New gates in CI: GA scenario, mobile 390 px with 44 px touch
targets, privacy-network, roles, network flake + seeded 500, bundle budget,
widget size. The gate document with evidence and dated exceptions is
`docs/decisions/GA-v2-frontend.md`.
