# FE-BINDING — where every FE-spec concept lives in this repo

Filled in FE0 (2026-09-06). A later sprint spec that says "the API client" or "route constants" means the path in the right column. Change a binding only through an ADR.

| Concept in FE specs | Bound path / name |
|---|---|
| App entry / router | `src/App.tsx` (flat `<Routes>`); owner-app routes registered from `TELEPHONY_STATIC_PATHS` |
| Owner-app entry (view switch) | `src/pages/telephony/TelephonyHome.tsx` |
| Route constants | `src/pages/telephony/_lib/routes.ts` — `ROUTES.HOME` (= Übersicht), `ROUTES.LOGIN`, `ROUTES.ASSISTANT`, `ROUTES.CALLS`, `ROUTES.CALL(sid)`, `ROUTES.SETTINGS_PROFILE`, …; `OWNER_SURFACES` (placeholder rows), `TELEPHONY_STATIC_PATHS` |
| Layout shell (desktop rail / mobile tabs) | `src/pages/telephony/_components/shared/TelephonyLayout.tsx` (platform sidebar + inset) · `_components/sidebar/TelephonyMiniRail.tsx` (desktop, ≥ md) · `_components/sidebar/MobileTabBar.tsx` (bottom tabs + "Mehr" sheet, < md) · nav model `_components/sidebar/telephonyNav.tsx` (`NAV_GROUPS`, `PRIMARY_ITEMS`, `SETUP_ITEM` submenu, `useVisibleNavGroups`, `isNavItemActive`); rail collapses (`voice.rail.collapsed`) |
| Login page | `src/pages/telephony/OwnerLoginPage.tsx` at `ROUTES.LOGIN` (`/telephony/login`, outside ProtectedRoute): name or email + password — see `login.md` |
| Auth guard | `src/components/ProtectedRoute.tsx` reads `useSession().connected`; signed out → `/telephony/login?returnTo=` for `/telephony*`, else `/login?returnTo=`. `VoiceAuthGuard.tsx` inside the owner shell is a second line behind it |
| Status banner | `src/pages/telephony/_components/shared/StatusBanner.tsx` (`useBannerState`: checking / offline / sip / inactive / active) |
| Übersicht | `src/pages/telephony/_components/overview/OverviewView.tsx` + `TodayCard`, `ActiveCallsCard`, `AttentionCard`, `StatusCard`, `CostsCard`, `ResidencyChip`, `ComputedBadge` |
| Anrufe | `src/pages/telephony/_components/owner-calls/*` (`CallsListView`, `CallDetailPage`, `TranscriptView`, `AttentionView`, `ResultChip`, `IntentChip`, `CallFiltersBar`, `LiveCallsSection`, `CsvExportButton`, `OutcomeSummary`, `AppointmentSummary`, `BriefingSummary`, `OutboundDialog`) · data `src/lib/api/owner/calls.ts` — see `calls.md` |
| Einrichtung › Profil | `src/pages/telephony/_components/settings/profile/*` (`ProfileEditorView`, sections, `LockedDisclosure`, `DiffView`) · data/schema `src/lib/api/owner/profile.ts` — see `setup-profile.md` |
| Einrichtung › Telefonie | `src/pages/telephony/_components/settings/telephony/*` (`TelephonySettingsView`, `NumbersList`, `ModeDecision`, `ForwardingGuide`, `SelfTestPanel`, `SipStatusCard`, `TestCallChecklist`) · data `src/lib/api/owner/telephony.ts` · guides `src/content/telephony-guides.ts` — see `telephony.md` |
| Einrichtungsassistent | `src/pages/telephony/_components/setup/*` (`SetupWizardView`, `WizardShell` + `StepNav`, `ProfileSteps`, `StepTelephony` + `PurchaseNumberPanel`, `StepCalendar` + `GoogleConnectButton`/`Ms365DeviceCodePanel`/`CalendarSelect`, `StepKnowledge`, `StepTestCall` + `useTestCallWatcher`, `StepGoLive` + `GoLiveChecklist`/`SuccessScreen`) · state machine & C2 hooks `src/lib/api/owner/setup.ts` · shared form `settings/profile/useProfileForm.ts` — see `setup-wizard.md` |
| Wissen | `src/pages/telephony/_components/knowledge/*` (`KnowledgeView`, `SourcesTable`, `AddWebsiteDialog`, `UploadDropzone`, `ExcludedChunksPanel`, `TestConsole` + `SourceChip`, `UnansweredList`) · data `src/lib/api/owner/knowledge.ts` — see `knowledge.md` |
| Anliegen-Regeln | `src/pages/telephony/_components/rules/*` (`RulesView`, `RuleEditor`, `DryRunConsole`, `RulePackPicker`) · data `src/lib/api/owner/rules.ts` — see `rules.md` |
| Datenschutz | `src/pages/telephony/_components/privacy/*` (`PrivacyView`, `ResidencySection`, `SubprocessorSection`, `RetentionSection`, `ConsentSection`, `SubjectRightsSection`, `EvidenceSection` + `EvidenceButton`, `DocumentsSection`) · data `src/lib/api/owner/privacy.ts` — see `privacy.md` |
| Vertrauen | `src/pages/telephony/_components/trust/*` (`TrustView`, `ClaimCard`) — see `trust.md` |
| Werkzeuge | `src/pages/telephony/_components/settings/tools/*` (`ToolsView`, `ToolRow`, `TierChip`, `WhyNotDialog`, `ToolTimelineView`) · data `src/lib/api/owner/tools.ts` · labels `src/content/tool-labels.ts` — see `tools.md` |
| Nachfass-Nachrichten | `src/pages/telephony/_components/followups/*` · data `src/lib/api/owner/followups.ts` — see `followups.md` |
| Integrationen | `src/pages/telephony/_components/integrations/*` · data `src/lib/api/owner/integrations.ts` — see `integrations.md` |
| Live-Ereignisse (SSE) | `src/lib/api/owner/events.ts` (`useEventStream`, `useLiveInterval`, `EVENT_KEYS`) — see `integrations.md` |
| Berichte & Kennzahlen | `src/pages/telephony/_components/reports/*` · data `src/lib/api/owner/reports.ts` — see `reports.md` |
| Aufmerksamkeit (Queue) | `src/pages/telephony/_components/attention/AttentionQueueView.tsx` · data `src/lib/api/owner/attention.ts` — see `attention.md` |
| Kampagnen | `src/pages/telephony/_components/campaigns/*` · data `src/lib/api/owner/campaigns.ts` — see `campaigns.md` |
| Team & Rollen | `src/pages/telephony/_components/settings/team/*` · data `src/lib/api/owner/team.ts` · store `src/stores/session.ts` — see `team.md` |
| Branchenvorlagen | `src/pages/telephony/_components/settings/templates/TemplatesView.tsx` · data `src/lib/api/owner/templates.ts` · content `src/content/templates.ts` — see `templates.md` |
| Website-Widget | `src/pages/telephony/_components/settings/widget/WidgetView.tsx` · data `src/lib/api/owner/widget.ts` · bundle `packages/widget/` → `public/w.js` — see `widget.md` |
| Was ist neu / Noch nicht | `src/pages/telephony/_components/whatsnew/WhatsNewView.tsx` · `src/content/{changelog,not-yet}.ts` · flags `src/lib/features.ts` — see `feature-flags.md`, `docs/decisions/GA-v2-frontend.md` |
| Website-Autoprofil | `settings/profile/AutoprofileReview.tsx`, `AutoprofileBanner.tsx` · data `src/lib/api/owner/autoprofile.ts` |
| Sprint badge | `src/pages/telephony/_components/owner/SprintBadge.tsx` (`<SprintBadge sprint hint/>`, counted per usage) |
| MaskedNumber | `src/components/voice/MaskedNumber.tsx` (hover / focus / long-press reveal and copy, role-gated) |
| Role gating | `can()` / `useCan()` / `canRole()` in `src/stores/session.ts` (`OwnerAction`, `ROLE_ACTIONS`) |
| User menu | `src/pages/telephony/_components/sidebar/UserMenu.tsx` (language DE/EN, logout; `useLogout`) |
| Per-route error boundary | `src/pages/telephony/_components/shared/ViewErrorBoundary.tsx` |
| API client | `src/lib/api/client.ts` — `api.get/post/put/patch/del`, `request()`, `publicRequest()`, `ApiError` (`code` = the auth layer's `error`), `onUnauthorized` (session lost), `qs()`; `src/lib/api/auth.ts` — `authApi.login/logout/me`, `loginErrorKind`; token refresh lives in `authedFetch` (`src/lib/pincerClient.ts`); `apiFetch` in `voice.ts` is an alias |
| Tenant header | `src/lib/api/tenant.ts` (`X-Tenant-Id` only when set) |
| Generated types | `src/lib/api/generated/schema.d.ts` (+ `openapi.json` snapshot); `Schema<"CallSummary">` via `client.ts` |
| Contract lock & scripts | `api-contract.lock` · `scripts/gen-api.mjs` (`npm run gen:api`) · `scripts/check-api.mjs` (`npm run check:api`) · `scripts/api-contract-lib.mjs` |
| Query hooks folder | `src/lib/api/voice.ts` (voice endpoints, one file) · `src/lib/api/owner/<feature>.ts` for owner-app features (`overview.ts`: today stats, attention, residency, doctor, costs, calendar, telephony facts · `calls.ts`: owner history/detail vocabulary, filters, transcript, CSV) |
| Session store | `src/stores/session.ts` — `useSession` (`connected`, `remembered`, `apiUrl`, `tenantId`, `role`, `userId`, `locale`, `returnTo`, `identity`, `login({identifier, password, remember})`, `logout()`), `defaultApiUrl`, `resolveReturnTo`, `resolveVoiceLocale`, `safeReturnTo` |
| i18n init + namespaces | `src/i18n/index.ts` (platform) · `src/i18n/voice.ts` (owner app: `useVoiceT(ns)`, `voiceT`, `intlLocale`, `VOICE_NAMESPACES`) · `src/i18n/locales/{de,en}/voice/{common,nav,placeholders,auth,overview}.json`; one file per feature |
| i18n lint & check | `eslint.config.js` (`OWNER_APP_FILES`, `i18next/no-literal-string`) · `scripts/i18n-check.mjs` (`npm run i18n:check`) |
| UI primitives | `src/components/ui/*` (shadcn) + `empty-state.tsx`, `data-table.tsx` (FE0) — see `components.md` |
| `MockBadge` | `src/components/voice/MockedBadge.tsx` — `MockedBadge`, `MockedSection`, `MockedRouteBanner` (`data-mock="true"`); placeholder view `_components/owner/OwnerPlaceholderView.tsx` |
| Formatters | `src/lib/format.ts` — `formatDate/Time/DateTime/Relative`, `formatDuration/Clock`, `formatCurrency/Number/Percent`, `maskPhone`, `formatPhone` |
| Feature flags from backend | `src/lib/capabilities.ts` — `useCapabilities()` (`caps`, `isOff(key)`), `capabilitiesFromStatus`, `useHealth()` |
| Polling cadences | `src/lib/constants.ts` (`REFETCH_INTERVALS`) — extend, do not inline numbers |
| Test setup | `src/test/setup.ts` (vitest) · `src/test/voice/*` (owner-app unit tests) · `e2e/` (Playwright: `smoke.spec.ts`, `a11y.spec.ts`, `helpers.ts`) · `playwright.config.ts` |
| Mock counter | `scripts/count-mocks.mjs` (`npm run count-mocks`, `--update`, `--summary`) · `mock-count.lock` |
| Bundle report | `scripts/bundle-report.mjs` (owner chunk ≤ 250 KB gz) |
| CI | `.github/workflows/frontend-ci.yml` — jobs `quality`, `contract`, `e2e`, `bundle`; `npm run ci:voice` runs the local equivalent (`lint:voice`, `type-check:voice`, `test`, `i18n:check`, `count-mocks`, `check:api`) |
| Docs | `docs/app/` (this folder) · `docs/voice-app.md` (feature-level inventory, updated per sprint) |
| API asks | `~/Desktop/BACKEND-<sprint>-api-asks.md` (backend work is never done from this repo) |
