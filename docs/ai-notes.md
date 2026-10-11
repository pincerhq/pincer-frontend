# AI-Native Notes (frontend, mocked)

Notes is a sibling module to **Docs** and **Calendar** inside the same 3days.ai shell. Capture-first, lighter than Docs, with cross-module wiki-links and a backlink graph. Like Docs, it is fully client-side and AI is mocked.

## Run it

```bash
npm install
npm run dev
# → http://localhost:8080/notes
```

First visit seeds 15 example notes across 2 notebooks (Work, Personal), with cross-links into seeded docs.

## Demo path (≈3 min)

1. **Open Notes** from the right-rail Apps bar (next to Calendar/Docs). Land on `/notes` with the 3-pane layout: notebooks/tags/smart views on the left, note list in the middle, editor on the right.
2. **Quick capture from anywhere.** Press `Cmd/Ctrl+Shift+N` from any page in the platform. The floating composer opens. Type "Met with Jules — push back on auto-tagging UX, suggest 3+ keyword threshold" and press `Cmd/Ctrl+Enter` (or click "Save & open"). The note saves and you land in it.
3. **Wiki-link to a doc.** In any note, type `[[` — the autocomplete shows all your notes, docs, and (mock) calendar events. Pick "PRD — Inline AI commands" → a chip-style link is inserted. The doc-side outgoing link is recorded in the notes store, and the new note shows up under the target's backlinks.
4. **Tag inline.** Type `#research` mid-paragraph. The tag chip renders inline; the tag now appears in the left sidebar and counts the note. Click the chip to filter.
5. **Set a reminder.** Click the bell icon in the editor toolbar (or type `/remind` and pick from the slash menu) → enter a time. The reminder chip appears under the title with a "Mirrored to Calendar" badge. The reminder also gets a `calendarEventId` recorded — Calendar can read this when the calendar-side panel ships (data layer is wired).
6. **Extract tasks.** Open a meeting note and highlight a paragraph. The bubble menu offers exactly three AI actions — **Extract tasks**, **Extract decisions**, **Ask…** — with no submenu. Click *Extract tasks*: the icon becomes a spinner in place, the menu stays open, and the task list is inserted **after** the selection, never replacing it. One `Cmd+Z` restores the document exactly.
7. **Ask across notes.** Press `Cmd/Ctrl+J` (or run *Ask across your notes* from the palette). The panel opens on the right. Choose a scope — *This note* / *This notebook* / *Everything* — and ask "What did I decide about diff-accept this week?". A progress line appears immediately, the answer streams in, citation chips render underneath, and clicking one opens the source note scrolled to the cited passage. Under every answer, permanently, is the provider, model and region it was computed in. Press **Stop** mid-answer: what arrived stays on screen, marked *incomplete*, with **Ask again** offered — there is no reconnect.

   *Both steps run identically against Anthropic EU and a local Ollama; the
   footer is what tells them apart, which is the parity gate Sprint 3 opened.*
8. **Graph view.** Sidebar → **Graph**. SVG force-directed layout of notes-as-nodes and wiki-links-as-edges. Filter by tag. Click a node to open.
9. **Daily note.** Sidebar → **Today**. Auto-creates today's daily note with a template (date + intent + tasks + notes), or opens it if it already exists.

## Architecture

Notes mirrors the Docs file layout (already aligned with Calendar):

```
src/pages/notes/
  NotesHome.tsx          ← 3-pane layout (sidebar / list / editor) + AI sidebar
  NotesDaily.tsx         ← /notes/daily — ensures + redirects to today's note
  NotesGraph.tsx         ← /notes/graph — SVG force-directed graph
  NotesTrash.tsx         ← /notes/trash
  _components/
    shared/NotesLayout.tsx
    sidebar/NotesSidebar.tsx          ← notebooks, tags, smart views, navigation
    list/NotesList.tsx                ← filtered/sorted list with task rollup chips
    list/NotesListToolbar.tsx         ← search + sort + filter
    editor/
      NoteEditor.tsx                  ← TipTap host (300 ms autosave, AI tag suggestions)
      NoteEditorTopBar.tsx
      NoteSuggestedTags.tsx           ← AI auto-tag chip strip
      NoteTagsRow.tsx
      NoteRemindersRow.tsx
      NoteBacklinksPanel.tsx
      NoteBubbleMenu.tsx              ← Extract tasks/decisions + standard presets
      NoteSlashMenu.tsx               ← /remind, /tag, [[ helpers, normal blocks
      WikiLinkAutocomplete.tsx        ← [[ overlay across notes/docs/events
    ai/NotesAiSidebar.tsx             ← Q&A over (note + linked + recent) with citations
    quick-capture/QuickCapture.tsx    ← global Cmd+Shift+N floating composer
  _hooks/
    use-notes-store.ts                ← Zustand: CRUD, tags, links, reminders, daily note
    use-notes-ui-store.ts             ← selection / sort / filter / sidebar state
  _lib/
    types.ts
    storage.ts                        ← idb-keyval (separate dbs); re-exports docs storage
    seed.ts                           ← 15 notes, 2 notebooks, cross-links into docs
    backlinks.ts                      ← deriveTitle/Snippet, computeBacklinks, extractInlineTags
    extensions/
      wikiLink.tsx                    ← inline node, [[label]] chip with route per type
      inlineTag.tsx                   ← inline node for #tag
      reminder.tsx                    ← block node for reminders
```

### Reuse from Docs (the integration story)

| Docs primitive | Reused as-is in Notes |
| --- | --- |
| `pages/docs/_lib/mockAi.ts` | Same module — *extended* with `extractTasks`, `extractDecisions`, `suggestTags`, `suggestLinks`, `answerOverNotes`. |
| `pages/docs/_lib/storage.ts` | Re-exported via `pages/notes/_lib/storage.ts` (`newId`, `docsStorage`); Notes adds three IDB stores of its own. |
| `pages/docs/_lib/extensions/ghostText.ts` | Same TipTap extension. |
| `pages/docs/_lib/export.ts` | `toMarkdown` powers the per-note `.md` export. |
| `pages/docs/_hooks/use-docs-settings-store.ts` | Same settings (font, page width, mock failure rate, ghost text). |
| `components/dashboard/AppSidebar` + `SidebarProvider` + `SidebarInset` | Identical platform shell. |

### Routes (added to existing `App.tsx`)

| Path | Component |
| --- | --- |
| `/notes` | NotesHome (auto-selects most recent note) |
| `/notes/:id` | NotesHome |
| `/notes/notebook/:id` | NotesHome (filtered) |
| `/notes/tag/:tag` | NotesHome (filtered) |
| `/notes/daily` | NotesDaily → redirects to today's note |
| `/notes/graph` | NotesGraph |
| `/notes/trash` | NotesTrash |

All wrapped in `ProtectedRoute` to match the rest of the platform.

### Cross-module touchpoints (what's wired)

- **Notes → Docs**: every note's outgoing `links` can include doc targets. The `[[` autocomplete pulls from `useDocsStore` for live suggestions. Wiki-link chips route to `/docs/:id`. Backlinks panel surfaces both directions.
- **Notes → Calendar**: every reminder is created with a `calendarEventId` (mock) — the data shape Calendar can consume to render an "Attached notes" panel and a tentative event chip. The current Calendar UI does not yet render this surface (deferred); see "Deferred" below.
- **Calendar → Notes**: the wiki-link autocomplete includes mock event candidates so the link UX is visible end-to-end.
- **Quick capture is platform-global**: mounted in `App.tsx`. `Cmd/Ctrl+Shift+N` works inside Docs, Calendar, or anywhere else.
- **PlatformAppsBar**: the Notes tile is now active (was `comingSoon`), routing to `/notes`.

### Deferred / would-need calendar repo touch

- **Calendar-side "Attached notes" panel.** Notes already produce `calendarEventId` mirrors and a `links: { type: 'event' }` shape. To complete the round trip the `CalendarPage` (or the event detail dialog) would need a small read-only panel that calls `useNotesStore` and filters by `links.targetId === event.id`. This is a ~30-line addition; keeping it out of this pass to avoid touching the calendar module without explicit scope.
- **Global command palette `Cmd+K` "New note"/"Open daily" actions.** The platform's existing palette would need a small additional source. Not modified here.
- **Global search** rolling notes into the existing search results. Same reason.

## AI (FE-5 — no mock remains)

Everything AI in /notes goes through `src/pages/notes/_lib/aiClient.ts`, which
talks to the Notes service. There is no mock behind it and no path back to one:
`src/test/notes/aiGates.test.ts` fails the build if any file under
`src/pages/notes` so much as names the old Docs mock module.

```ts
extractTasks(text, signal)                        // -> Task[]
extractDecisions(text, signal)                    // -> Decision[]
suggestTags(content, existingTags, signal)        // -> string[]
suggestLinks(noteId, candidates, signal)          // -> LinkSuggestion[]
answerOverNotes(question, notes, opts)            // AsyncIterable<{chunk, citations?, meta?}>
agentChat(message, sessionId?, signal)            // AsyncIterable<AgentEvent>
continueAgentTurn(sessionId, signal)              // resume after an approval
```

**AI exists in exactly two places** and a CI gate (A17) keeps it that way:

1. `NoteBubbleMenu` — three actions on a text selection.
2. The ask panel — `Cmd+J`, two tabs (Agent behind `VITE_NOTES_AGENT_CHAT=1`, set at container start).

Everything else may *render* AI output; nothing else may *invoke* it. Streaming
is one implementation — `_lib/sse.ts`, `fetch` + a manual reader, never
`EventSource` — and A3 asserts no second one appears. Chunks are applied per
animation frame (`_lib/rafBatch.ts`), not per chunk.

**Approvals.** Every agent write stops at a `PendingApproval` rendered by one
`ApprovalCard` on three surfaces — the agent transcript, the notifications bell,
and a banner on the affected note — all reading one store slice
(`_hooks/use-approvals-store.ts`), polled every 30 s and paused on a hidden tab.
A 409 `stale_base` refuses the write and says why. There is no "remember my
choice", deliberately.

**Confidentiality.** Provider, model and region sit under every answer;
a local-only workspace shows a permanent pill in the rail; Settings → AI carries
the spend chart, the budget bar and the full `agent_actions` log with CSV export.

Backend contracts this depends on that BE-4 has not shipped yet are listed in
`~/Desktop/notes-backend-gaps-fe5.md`; each one degrades visibly rather than
silently.

## State + persistence

- **`useNotesStore`**: notes dict, notebooks dict, CRUD, pinning (capped at 5), tags, link add/remove, reminder add/dismiss, suggested-tag accept/dismiss, daily-note resolver.
- **`useNotesUiStore`**: selection, sort, filter, view mode, AI sidebar open, quick-capture open, smart-view selection.
- **Persistence**: `idb-keyval` with three separate databases — `ai-notes-notes`, `ai-notes-notebooks`, `ai-notes-meta` — same constraint as Docs (multi-store-per-DB upgrade collisions in idb-keyval).
- **Backlinks** derived (not stored), recomputed on read in `_lib/backlinks.ts`.
- **Inline tags**: every save re-extracts `#tag` patterns from the body and merges them into the note's `tags` array.

## Acceptance status

- [x] Notes appears in the global apps bar; landing on `/notes` shows seed data.
- [x] Notes UI uses the platform shell, design tokens, shadcn primitives — same chrome as Docs.
- [x] `Cmd/Ctrl+Shift+N` opens quick capture from anywhere.
- [x] Create / edit / tag / pin / move-to-notebook / delete / restore — all persist.
- [x] Wiki-links resolve to notes, docs, and (mock) events; backlinks panel populates.
- [x] AI surfaces wired to shared `mockAi.ts` (inline command via bubble menu, selection presets including Extract tasks/decisions, sidebar Q&A over notes, auto-tag chip strip).
- [x] Reminders write a mock `calendarEventId` (calendar consumes from the notes store).
- [x] Daily note auto-creates and uses the template.
- [x] Graph view renders, is filterable, opens notes on click.
- [x] Markdown export from the editor toolbar.
- [x] No new design tokens, no forked primitives, no duplicated AI module.
- [x] Vitest covers `useNotesStore` (CRUD, tags, pinning cap, links, reminders, daily, smart views), backlink computation + tag extraction + title derivation, and the new mock AI methods. **30 new tests, 68 total across the platform**.

## Stretch (not implemented)

- Bulk export of all notes as a zip
- Markdown paste cleanup via mock AI
- Voice-to-note via Web Speech API
- Live link suggestion strip while typing (the data layer exists; UI deferred)
- Templates beyond daily

## Keyboard shortcuts (Notes-specific additions on top of Docs')

- `Cmd/Ctrl + Shift + N` — Quick capture (global, anywhere in the platform)
- `Cmd/Ctrl + J` — Toggle the ask panel (was `Cmd/Ctrl + Shift + I` before FE-5)
- `Cmd/Ctrl + Enter` (in quick capture) — Save & open the note
- `[[` — Wiki-link autocomplete
- `#word` — Inline tag
- `/` — Slash menu (with `/remind` for reminders)
