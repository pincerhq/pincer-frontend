# Notes: wiring `/notes` to the `notes_app` service

`src/pages/notes/` used to be a pure client-side mock persisting to `idb-keyval`
and calling the Docs mock AI. It now talks to the standalone Notes service in
`~/Desktop/pincer_extensions/notes_app` over HTTP. This is the operator's guide
to that seam; `docs/ai-notes.md` still describes the product surface.

## Running it

```bash
# backend
cd ~/Desktop/pincer_extensions/notes_app/backend
make install && make up && make migrate && make dev     # :8000

# frontend
cd ~/Desktop/3D_frontend
echo 'VITE_NOTES_API_URL=http://localhost:8000' >> .env.local
npm run dev
```

Then open `/notes`. If nothing loads, the list panel says why rather than showing
an empty workspace — the two usual causes are an unset `VITE_NOTES_API_URL` and
no signed-in Pincer session.

`VITE_NOTES_API_URL` and `VITE_NOTES_TOKEN` are set at container start (in dev:
`.env.local`), not baked into the build — see the README's Environment section.

Seed a workspace with `POST /v1/dev/seed` (owner role, 404 in production). The
client no longer seeds anything.

## Auth

Per **ADR 0001** there is no Zitadel. The Notes service expects a bearer token
plus the per-browser UUID sent as `X-Pincer-User`, and rejects a request missing
either. `src/auth/apiFetch.ts` is the only place that knows this.

Token resolution order:

1. `VITE_NOTES_TOKEN`, if set — for deployments where the Notes service has its
   own token.
2. The signed-in Pincer session's access token (`pincer.web.auth`), renewed
   through `ensureFreshAuth()` before each request so it is never sent expired.

**Open question for the Notes service owner.** ADR 0001 was written when Pincer
had one shared bearer token. Pincer now issues a per-identity JWT that expires
after minutes. Whether `notes_app` validates that JWT has not been confirmed
from this repository. If it does not, every Notes request without
`VITE_NOTES_TOKEN` answers 401 (Notes shows its own dialog; the Pincer session
is not ended by it).

Still pilot-grade: `X-Pincer-User` is client-asserted, and any XSS in this app
exfiltrates the session's tokens. **Not** §203-grade for client data.

The browser-side `VITE_AUTH_EMAIL` / `VITE_AUTH_PASSWORD` login and the
`localStorage.isAuthenticated` flag are gone (see `docs/app/login.md`). Rotate
anything real that was ever in `.env.local`, and the old shared Pincer token.

## Files

| File | Role |
|---|---|
| `src/auth/apiFetch.ts` | Credentialed fetch; base URL; the "why can't I reach it" message |
| `_lib/api-types.ts` | **Generated** from `backend/openapi.json`. Never edit by hand |
| `_lib/apiClient.ts` | Typed client; error mapping; `listAll` cursor following |
| `_lib/aiClient.ts` | The five `mockAi` functions, the answer stream, the agent turn protocol |
| `_hooks/use-notes-store.ts` | Optimistic store over the client. Public API unchanged from the mock era |
| `_hooks/use-notes-tags.ts` | `GET /v1/tags`, replacing the old local `deriveTags()` |
| `_lib/storage.ts` | Façade only. Re-exports `newId`/`docsStorage` and clears the legacy IndexedDB stores once |
| `_lib/backlinks.ts` | Local title/snippet/tag derivation only — the backlink computation moved to the server |
| `_lib/commands.ts` | **The action registry.** One array; the palette, the key handler and the `?` sheet all read it |
| `_lib/editorBridge.ts` | The open editor, published to the palette and the unload handler |
| `_lib/errors.ts` | `NotesApiError.code` → a sentence, plus the copyable `requestId` |
| `_lib/exportNote.ts` | Server-rendered Markdown download, shared by the top bar and the palette |
| `_hooks/use-note-autosave.ts` | Debounce, flush, checkpoint and the truthful save state |
| `_hooks/use-notes-commands.ts` | Assembles the command context; `useGlobalShortcuts()` binds the registry |
| `@/lib/legacyNotesIdb.ts` | Outside the module on purpose — see gate F13 below |
| `_hooks/use-outcomes-store.ts` | Outcomes (BE-1): proposals, confirmation, completion, the roll-up |
| `_lib/outcomes.ts` | Due buckets, date formatting, the low-confidence threshold — pure |
| `_lib/extensions/sourceHighlight.ts` | Finds and lights up an outcome's source sentence |
| `_components/editor/NoteProposalCard.tsx` | The confirmation surface |
| `NotesOpenItems.tsx` | `/notes/open` — I owe / promised to me / unconfirmed |
| `@/lib/notesProposalDismissals.ts` | "Not now", per note version — outside the module for the same reason |
| `NotesSearch.tsx` | `/notes/search` — the one search page |
| `_lib/highlight.ts` | Parses `ts_headline` markers into text segments. Never injects |
| `_lib/queryDsl.ts` | Builds BE-2 query clauses; the only place that composes them |
| `NotesMatter.tsx` | `/notes/matter/{key}` — six sections, one request |
| `_lib/prepareMeeting.ts` | Turns a matter view into a note you can write in |
| `_hooks/use-saved-views-store.ts` | Standing queries; `_components/views/ViewBuilder.tsx` edits them |

## Regenerating the client after a schema change

```bash
cd ~/Desktop/pincer_extensions/notes_app/backend && make openapi
cd ../frontend && npx openapi-typescript ../backend/openapi.json -o ./api-types.ts
cp api-types.ts ~/Desktop/3D_frontend/src/pages/notes/_lib/api-types.ts
```

CI should run both and fail on a diff, so a schema change and its client land in
the same PR (gate F1). There is no CI configuration in this repo yet, so the
regeneration itself is still a manual step — that is the gap, not a solved
problem. What *is* enforced today, by `src/test/notes/gates.test.ts`, is that the
file still carries its generator banner and that almost nothing imports it
directly.

Two other gates run with the test suite:

- **F13** — `src/pages/notes/` contains no reference to `idb-keyval`, no
  `localStorage.setItem`, and no client-side seed module. The one-time cleanup of
  the mock era's IndexedDB rows lives in `@/lib/legacyNotesIdb` precisely so this
  gate can be absolute.
- **F16** — every `<button>` in the module is either a registry command or
  carries a written exemption.
- **O11** — no component derives a status count from outcome rows, and the badge
  and tab counts read `summary`.
- **§5** — none of the task-manager concepts appears as a field.
- **S1** — one module calls `/v1/search`, one place composes DSL clauses, and no
  second search input exists.
- **S7** — no `dangerouslySetInnerHTML`, no `innerHTML` assignment.

## The keyboard shell

`Cmd/Ctrl+K` opens the command palette, and every action in /notes is one entry
in `_lib/commands.ts`. That is enforced rather than intended: a `<button>` under
`src/pages/notes/` must carry `data-command="<id>"` or a
`data-command-exempt="<reason>"`, and `src/test/notes/commandCoverage.test.ts`
fails the build otherwise. The `?` sheet and the key bindings are generated from
the same array, so a shortcut cannot be documented and unbound, or bound and
undocumented.

Bindings: `Cmd+N` new note, `Cmd+D` today, `Cmd+S` explicit flush with a
confirmation, `Cmd+Shift+N` quick capture, `Cmd+Shift+I` the AI panel, `Cmd+K`
palette, `?` shortcuts, and — inside the editor only — `Esc` back to the list and
`Cmd+Enter` a new note quoting the selection. Escape and `Cmd+Enter` are scoped
to the document because everywhere else they already mean "close this dialog"
and "submit this form".

Adding an action means adding it to the registry. It does not mean adding it to
the palette: the palette has no list of its own.

## Outcomes (BE-1)

A task or a decision is a row, not a sentence someone pasted into a document.
Four things about the seam are worth knowing before touching it:

- **`proposed` is not an obligation.** Extraction creates rows the user has not
  agreed to. They appear in the note's proposal card and in Open Items →
  Unconfirmed, and in nothing else. `confirm-batch` is what makes them real, and
  it carries the user's inline edits in the same request — a patch-then-confirm
  per row is four round trips and the 30-second goal is gone.
- **The anchor is the trust mechanism.** Every outcome carries the verbatim
  sentence it came from. Hovering a proposal lights that sentence up in the
  document; clicking a confirmed one scrolls to it. The search is by text, not by
  offset, and normalises whitespace and case exactly as the backend's
  hallucination gate does — so a quote the server accepted is a quote the UI can
  find. When it cannot be found, nothing is highlighted and nothing is scrolled:
  `anchor.state === 'orphaned'` renders as "the source text has changed", because
  jumping to a plausible-but-different sentence is worse than admitting the link
  is gone.
- **Counts are the server's** (gate O11). The sidebar's overdue badge is
  `summary.mine.overdue`; the Open Items tab counts are `summary.mine.open`,
  `summary.theirs.open` and `summary.unconfirmed`; the matter chips are
  `summary.byTag`. Every mutation re-fetches the summary rather than adjusting a
  local number. The one tally that is not the server's is the note-list row hint
  ("3 open"), because there is no per-note count endpoint to ask — it is a hint
  on a row and never a number anyone acts on, and it lives in the store next to
  the comment saying so.
- **Due buckets are calendar days, not milliseconds.** `now + 7 * 86_400_000` is
  wrong twice a year; `outcomes.ts` uses `setDate`/`setHours`, and the test suite
  pins `TZ=Europe/Berlin` so the DST case is actually exercised rather than
  silently skipped on a UTC CI box.

Extraction is triggered two ways: explicitly, through the palette's
`note.extract`, and automatically by the server on the note's first idle period
after a version checkpoint. The editor re-reads a note's outcomes 3 s and 30 s
after a checkpoint so the proposals are waiting when the user looks up; the
frontend never triggers the automatic run itself.

**What Open Items deliberately is not** (FE-2 §5): no priorities, projects,
sub-tasks, dependencies, recurrence, assignees-as-users, board or Gantt. An
outcome has text, a person as free text, a due date and a status. A gate in
`src/test/notes/outcomeGates.test.ts` fails the build if any of those words shows
up as a field. The honest answer for a firm that needs a task manager is that
they should keep theirs, and we make sure the obligation is captured and
traceable.

## Retrieval (BE-2)

**One search, one filter language.** `Cmd+K` is the only way in. The palette is a
quick switcher over titles held in memory; the moment the query stops looking
like a switch — a second `Cmd+K`, fifteen characters, or picking "Search every
note" — it hands the string to `/notes/search`, which is the only page that calls
`/v1/search`. The list panel's own search box is **gone**: it filtered the loaded
page while the palette asked the server, and two boxes that disagree is worse
than either. `src/test/notes/searchGates.test.ts` fails the build if a second one
reappears, or if a third module starts composing DSL clauses.

- **Snippets are parsed, never injected.** `ts_headline` returns note content with
  `<b>…</b>` around the matches — everything else in that string is whatever the
  user typed. `_lib/highlight.ts` splits it into text segments and the component
  renders them as React text nodes. There is no `dangerouslySetInnerHTML` and no
  `innerHTML` assignment anywhere in the module, and that is a gate, not a
  convention (S7). If the backend ever changes `StartSel`/`StopSel`, change the
  parser in the same PR.
- **Empty is never empty.** BE-2 retries a query that matched nothing with the
  semantic leg alone and sets `closest`. Those render under "Similar matches"
  with a sentence saying why. The genuinely-nothing state only appears when the
  fallback was empty too.
- **Mode is hidden.** Hybrid runs by default; the exact/semantic toggle is behind
  "Options". "Keyword or semantic?" is not a question anyone can answer about a
  sentence they half-remember.
- **Filter chips carry no counts.** `SearchOut` has no facets — see
  `~/Desktop/notes-backend-gaps-fe3.md` §1. The chips narrow correctly by adding
  a DSL clause; a count computed here would be a count of the page pretending to
  be a count of the corpus.

**The matter page** (`/notes/matter/{key}`) assembles from one request and renders
six sections in a fixed order, with no customization: open obligations, recent
decisions, summary, notes, documents, upcoming. The summary is **third**, not
first — the factual sections are more trustworthy, and when the summary is absent
(AI off, budget spent, generation failed) the page shows nothing in its place: no
spinner, no banner, no apology. A firm that never switches AI on gets the whole
value of the page. "Prepare for a meeting" is what makes it a workflow rather
than a dashboard: it creates a note tagged with the matter, pre-filled with the
open obligations as real task items and the last five decisions as context.

Matters are a **projection**, not an entity. BE-2 promotes any tag or notebook
with three notes and one outcome, so the sidebar fills itself for tags the user
already had. Nothing to configure (S13).

**Saved views** are standing queries over the same DSL, including semantic
clauses — which is why a view keeps finding notes written after it was saved. The
primary way one is created is the **"Save this search" button on the results
page**, storing exactly the query the page just ran. The builder is for editing:
stacked rows, an AND/OR switch, and a debounced-and-aborted preview count. There
is no query-builder library, because eleven clause types is smaller than any
library's API and a library would happily compose queries the closed schema
rejects.

## Behaviour worth knowing before changing the store

- **Optimistic, then reconciled.** Every mutation applies locally, calls, and
  replaces the local note with the response. The server's `version` is the
  `baseVersion` of the next patch, so it must be stored — dropping it turns every
  save into a 409.
- **One PATCH per note in flight.** Patches are serialised per note id.
  Two concurrent patches from the same base version means the second one 409s.
- **409 replaces, it does not merge.** `VersionConflictError` carries the server
  note; it wins and the user is told (ADR 0002).
- **Checkpoints.** The 300 ms autosave coalesces; editor blur and leaving the
  note force `checkpoint=true`, which writes a version row. Without that a
  session ending mid-debounce leaves nothing restorable.
- **Loading is paginated, in two movements.** `load()` fetches one keyset page
  (50) and paints. A background pass then follows `nextCursor` to exhaustion and
  finally pulls the trash, and the list's `IntersectionObserver` sentinel can
  pull pages ahead of it through the same cursor — one in-flight page at a time,
  shared, so the two cannot both advance it and leave a hole. Pages merge by id
  and never overwrite a note already held, which is why a note edited mid-scroll
  cannot be clobbered by an older page and cannot appear twice.

  The corpus still arrives in full, because the smart-view predicates, tag counts
  and client-side sorting are computed over `notes` as a complete map — a list
  that became one page would make those views quietly lie. What changed in FE-1
  is that first paint no longer waits for it. `whenCorpusLoaded()` awaits the
  background pass; `fullyLoaded` reports it. Free-text search is the one filter
  that goes to the server, for German FTS.
- **Leaving is safe, and says so.** The 300 ms autosave coalesces; blur, route
  change and `Cmd+S` flush with `checkpoint=true` **unconditionally** — not
  guarded on "is anything dirty", because the coalescing window means the last
  autosave may have left no version row and the flush is what makes the live
  document restorable. Restating an unchanged note is a server-side no-op.
  `beforeunload` sends a `keepalive` PATCH; `navigator.sendBeacon` cannot be used
  because it only issues POST and cannot set `Authorization` or `X-Pincer-User`.
  There are no "unsaved changes" dialogs — in an app that autosaves, that prompt
  is a lie.

- **The save indicator only reports what the server confirmed.** It says *when*
  ("Saved 3s ago"), seeded from the note's `updatedAt` so a freshly opened note
  is not claiming a save this session never made. The failure state says "Not
  saved" and offers a retry holding the exact document that failed.

- **401/403 is a dialog, not a toast and never a silent retry.** `apiClient`
  raises `onSessionExpired`, `NotesSessionDialog` renders it, and `errors.ts`
  suppresses the toast underneath. Everything else toasts a sentence with a
  copyable `requestId`; a 429 reports its `Retry-After` in seconds.

- **Trash is emptied wholesale.** There is no per-note purge —
  `DELETE /v1/notes/{id}` is the soft delete, `DELETE /v1/trash` is the purge. The
  per-row "Delete forever" button is gone because the operation behind it does
  not exist.

## Local data from the mock build

The old `ai-notes-notes` / `ai-notes-notebooks` / `ai-notes-meta` IndexedDB
stores are **cleared once** on first run of this build
(`clearLegacyNotesStores()`, flagged in `localStorage` under
`notes:legacy-idb-cleared:v1`).

They are not migrated. Local notes have `note_…` ids and wikiLink chips embed
those ids inside the document JSON, while server notes are UUIDs; adopting the
old rows would mean rewriting every chip's `targetId`, and getting that half
right silently orphans links. A wipe plus `POST /v1/dev/seed` is the honest
trade. Anything a user had in a browser is gone — say so before deploying.

## Deliberate departures from the sprint specs

- **The notification bell and the AI usage panel live in the notes rail**, not in
  the platform dashboard header and not under the platform `/settings` page. The
  notifications the endpoint returns are note reminders, and the platform shell
  is outside this app's boundary. Moving either up a level is a one-import change.
- **`runPreset` (improve / shorten / summarize) still calls the Docs mock.**
  There is no `/v1/ai/preset` on the Notes backend. Cutting the presets would take
  working actions away from the user; routing them through Pincer separately would
  put those calls outside the Notes service's budget and audit trail. This is the
  only mocked AI call left in `/notes`.
- **Foreground tag suggestions were kept.** The server auto-tags too, but as a
  worker cron every five minutes behind a ten-minute debounce. The editor asks
  directly so suggestions feel like a response to typing, gated on a 200-char
  delta to match the server's own `autotag_min_delta_chars` — every call spends
  real budget now, which the mock did not.
- **The AI settings panel shows the last model used, not the configured one.**
  No endpoint exposes the tenant's AI configuration; `/v1/me` returns identity and
  roles only. "What actually ran" is the honest thing to show. See the backend
  task list.

## Not done, and why

- **Attachment upload.** Sprint 5 §2.2 describes a presigned upload for the
  TipTap image node, but there is no `/v1/attachments/presign` in the backend's
  OpenAPI document. The image node still takes a URL.
- **`Idempotency-Key` on note creation.** The service honours the header, but its
  CORS `allow_headers` list does not include it, so sending it from a browser
  fails the preflight. Create is therefore not retry-safe from the frontend.
- **CI schema-drift check.** No CI configuration exists in this repo.

Both backend-side items are written up in `~/Desktop/NOTES-BACKEND-TASKS.md`.

## Simplicity baseline — create and write

Recorded here as the number every later sprint is measured against. Adding a
step to this flow is a regression, whatever else the sprint bought.

| | Count | What they are |
|---|---|---|
| Keystrokes to a ready caret | 1 | `Cmd+N`. The mouse path is one click on **Create note** |
| Decisions demanded | 0 | No notebook picker, no title prompt, no type chooser. Filing is optional forever |
| Concepts to understand | 1 | "A note." Notebooks, tags, dailies and links are all optional and all discoverable later |
| Dialogs on the path | 0 | Including on the way out: there are no unsaved-changes prompts |
| Actions needed to keep the work | 0 | Autosave plus flush. `Cmd+S` exists because people press it, not because it is required |

`src/test/notes/commands.test.ts` asserts the zero-decision claim directly (F17):
`note.new` creates, selects and navigates, and must not touch any of the
context's question-asking members.

## Simplicity, after FE-2

FE-1's baseline was the create-and-write flow. FE-2 adds one: from a finished
meeting note to confirmed obligations. Measured against the 900-word German
fixture in `src/test/notes/fixtures/germanMeeting.ts`
(`src/test/notes/thirtySeconds.test.tsx`):

| | Count | What they are |
|---|---|---|
| Actions, everything correct | 1 | Read the card, press **Confirm 4**. Pre-checked is what buys this |
| Actions, one date to fix | 4 | Untick one, clear the date, type it, confirm |
| Requests | 1 | `confirm-batch`, edits included. Plus one summary refresh |
| Dialogs | 0 | Editing is inline; the card is in the note, not over it |
| Decisions demanded | 0 | The default set is already chosen; the user overrides it or does not |
| Concepts added | 2 | "Suggestion" and "obligation". Not: priority, project, sub-task, dependency |
| Keyboard path | same cost | `j`/`k`, space, enter — no mouse, no extra step |

The create-and-write baseline from FE-1 is unchanged: still one keystroke and
zero decisions. Nothing in this sprint was added to that path.

**What is not measured:** seconds. jsdom has no rendering, no network latency and
no human, so a stopwatch there would produce a number that looks like evidence
and is not. The action and request counts above are what determine the elapsed
time and they are measured; the timed run against a browser is still owed.

## Simplicity, after FE-3

The question FE-3 adds: from a half-remembered fragment to the note, and from a
client's name to knowing where things stand.

| | Count | What they are |
|---|---|---|
| Fragment → the note | 3 | `Cmd+K`, type the fragment, `Enter` on a result. The palette's own list answers first if the note is recent |
| Fragment → full search | 1 extra | A second `Cmd+K`, or Enter on "Search every note". The typed text and the caret come with it |
| Client name → where we stand | 2 | `Cmd+K`, pick the matter. Six sections, one request, no scrolling between notes |
| Matter → a prepared note | 1 | "Prepare for a meeting". Obligations arrive as checkboxes |
| Search → a saved view | 1 | "Save this search". The builder is for editing, not creating |
| Search boxes to choose between | 0 | There is one, and a gate keeps it that way |
| Decisions demanded to make retrieval work | 0 | No filing, no mode choice, no matter setup |

The FE-1 and FE-2 baselines are unchanged: creating a note is still one keystroke
and zero decisions, and confirming a note's obligations is still one action when
the model got it right.

**What is not measured:** the 10-second fragment goal (S3). It needs the labelled
fixture set built from the pilot firm's real half-memories, which BE-2's own Q5
and Q6 are blocked on as well. Nothing about retrieval *quality* is claimed here.
