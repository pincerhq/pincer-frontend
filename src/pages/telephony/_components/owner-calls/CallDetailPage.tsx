/**
 * /telephony/calls/:sid — the single place to read a call (FE2 §2).
 * Header → summary → tabs (accordion on phones). Everything the backend
 * knows about the call, in owner vocabulary; raw codes only under Details.
 */
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, PhoneIncoming, PhoneOutgoing, PhoneOutgoing as CallBackIcon } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { MaskedNumber } from "@/components/voice/MaskedNumber";
import CallActionsTimeline from "@/pages/telephony/_components/voice/CallActionsTimeline";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCallDetail, useContacts, useLiveCallDetail, type CallDetail } from "@/lib/api/voice";
import { contactIndex, contactNameFor, counterpartNumber, isLive, resultGroupOf, useHandledCalls } from "@/lib/api/owner/calls";
import { outcomeOf } from "@/pages/telephony/_lib/outcome";
import { languageNative } from "@/pages/telephony/_lib/voiceMeta";
import { formatClock, formatCurrency, formatDateTime } from "@/lib/format";
import { useCan, useSession } from "@/stores/session";
import { useVoiceT } from "@/i18n/voice";
import { ROUTES } from "@/pages/telephony/_lib/routes";
import { ResultChip } from "./ResultChip";
import OutcomeSummary from "./OutcomeSummary";
import TranscriptView from "./TranscriptView";
import AppointmentSummary from "./AppointmentSummary";
import BriefingSummary from "./BriefingSummary";
import OutboundDialog, { useOutboundAllowed } from "./OutboundDialog";
import { InfoTag } from "@/pages/telephony/_components/shared/InfoTag";
import ToolTimelineView from "./ToolTimelineView";

// The cost tracker bills in US dollars; a EUR figure is an FE2 API ask.
const COST_CURRENCY = "USD";

function useDetail(sid: string): { data: CallDetail | undefined; isLoading: boolean; isError: boolean } {
  const staticQ = useCallDetail(sid);
  const live = isLive(staticQ.data);
  const liveQ = useLiveCallDetail(live ? sid : null);
  return { data: live ? (liveQ.data ?? staticQ.data) : staticQ.data, isLoading: staticQ.isLoading, isError: staticQ.isError };
}

type TabKey = "transcript" | "appointment" | "actions" | "followups" | "briefing" | "details";

export default function CallDetailPage({ callSid }: { callSid: string }) {
  const t = useVoiceT("voice-calls");
  const tc = useVoiceT("voice-common");
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const founder = params.has("debug");
  const { data: call, isLoading, isError } = useDetail(callSid);
  const contacts = useContacts();
  const { isHandled, toggle } = useHandledCalls();
  const canCosts = useCan("view_costs");
  const outboundAllowed = useOutboundAllowed();
  const locale = useSession((s) => s.locale);
  const [callBack, setCallBack] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-5 sm:px-6">
        <Skeleton className="h-8 w-48 rounded-[10px]" />
        <Skeleton className="h-24 rounded-[14px]" />
        <Skeleton className="h-64 rounded-[14px]" />
      </div>
    );
  }
  if (isError || !call) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
        <Link to={ROUTES.CALLS} className="inline-flex items-center gap-1 text-sm text-[var(--text-2)] underline-offset-2 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("detail.back")}
        </Link>
        <p role="alert" className="mt-4 text-sm text-[var(--text-2)]">
          {t("detail.notFound")}
        </p>
      </div>
    );
  }

  const inbound = call.direction === "inbound";
  const name = contactNameFor(call, contactIndex(contacts.data));
  const number = counterpartNumber(call);
  const group = resultGroupOf(call);
  const outcome = outcomeOf(call);
  const handled = isHandled(call.call_sid);
  const purged = call.transcript.length === 0 && call.duration_seconds > 0 && !isLive(call);
  const cost = call.cost?.total_usd ?? call.cost_total_usd ?? null;
  const language = call.language ? languageNative(call.language) : null;

  const tabs: Array<{ key: TabKey; label: string; badge?: boolean; content: React.ReactNode }> = [
    { key: "transcript", label: t("detail.tabs.transcript"), content: <TranscriptView lines={call.transcript} purged={purged} /> },
    ...(call.appointment ? [{ key: "appointment" as const, label: t("detail.tabs.appointment"), content: <AppointmentSummary appointment={call.appointment} /> }] : []),
    {
      key: "actions",
      label: t("detail.tabs.actions"),
      content: (
        <div className="space-y-2">
          <ToolTimelineView timeline={call.tool_timeline} actions={call.actions} />
          {founder && call.actions.length > 0 && <CallActionsTimeline actions={call.actions} heading={false} />}
        </div>
      ),
    },
    ...(!inbound ? [{ key: "briefing" as const, label: t("detail.tabs.briefing"), content: <BriefingSummary call={call} /> }] : []),
    ...(founder
      ? [
          {
            key: "details" as const,
            label: t("detail.tabs.details"),
            content: (
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-[var(--text-3)]">{t("details.engine")}</dt>
                <dd className="font-mono text-xs">{(call as { engine?: string }).engine ?? t("details.none")}</dd>
                <dt className="text-[var(--text-3)]">{t("details.status")}</dt>
                <dd className="font-mono text-xs">{call.status}</dd>
                <dt className="text-[var(--text-3)]">{t("details.failureCode")}</dt>
                <dd className="font-mono text-xs">{call.failure_code || t("details.none")}</dd>
                <dt className="text-[var(--text-3)]">{t("details.method")}</dt>
                <dd className="font-mono text-xs">{call.method ?? t("details.none")}</dd>
                <dt className="text-[var(--text-3)]">{t("details.sid")}</dt>
                <dd className="font-mono text-xs">{call.call_sid}</dd>
              </dl>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 sm:px-6 md:px-8">
        <Link to={ROUTES.CALLS} className="inline-flex items-center gap-1 text-sm text-[var(--text-2)] underline-offset-2 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("detail.back")}
        </Link>

        <header className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
                {inbound ? <PhoneIncoming className="h-3.5 w-3.5" aria-hidden="true" /> : <PhoneOutgoing className="h-3.5 w-3.5" aria-hidden="true" />}
                {inbound ? t("detail.inbound") : t("detail.outbound")} · {formatDateTime(call.started_at, { locale })}
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]">{name ?? <MaskedNumber value={number} copy />}</h1>
              {name && (
                <p className="text-sm text-[var(--text-2)]">
                  <MaskedNumber value={number} copy />
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ResultChip group={group} failureCode={call.failure_code} />
              {language && <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--text-2)]">{language}</span>}
            </div>
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-[var(--text-3)]">{t("detail.duration")}</dt>
              <dd className="tabular-nums text-[var(--ink)]">{formatClock(call.duration_seconds)}</dd>
            </div>
            {canCosts && cost !== null && (
              <div className="flex gap-1.5">
                <dt className="text-[var(--text-3)]">{t("detail.cost")}</dt>
                <dd className="tabular-nums text-[var(--ink)]">{formatCurrency(cost, COST_CURRENCY, { locale })}</dd>
              </div>
            )}
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => toggle(call.call_sid)}
              aria-pressed={handled}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--sand)] aria-pressed:border-green-300 aria-pressed:bg-green-50 aria-pressed:text-green-800"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {handled ? t("detail.markOpen") : t("detail.markHandled")}
            </button>
            <InfoTag kind="local" label={t("detail.handledLocalTag")} title={t("detail.handledLocalHint")} />
            {outboundAllowed && (
              <button type="button" onClick={() => setCallBack(true)} className="inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--brand)] hover:bg-[var(--brand-hover)] px-3 py-1.5 text-sm text-[var(--on-brand)]">
                <CallBackIcon className="h-4 w-4" aria-hidden="true" />
                {t("detail.callBack")}
              </button>
            )}
          </div>
        </header>

        <OutcomeSummary outcome={outcome} />

        {isMobile ? (
          <Accordion type="multiple" defaultValue={["transcript"]} className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] px-4">
            {tabs.map((tab) => (
              <AccordionItem key={tab.key} value={tab.key}>
                <AccordionTrigger className="text-sm">{tab.label}</AccordionTrigger>
                <AccordionContent>{tab.content}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <Tabs defaultValue="transcript" className="rounded-[14px] border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
            <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key} className="rounded-[10px] border border-transparent px-3 py-1.5 text-sm data-[state=active]:border-[var(--line)] data-[state=active]:bg-[var(--sand)]">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((tab) => (
              <TabsContent key={tab.key} value={tab.key}>
                {tab.content}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {callBack && (
        <OutboundDialog
          onClose={() => {
            setCallBack(false);
            navigate(ROUTES.CALL(call.call_sid), { replace: true });
          }}
          initialMode="now"
          initialNumber={number}
          initialName={name ?? ""}
          initialPurpose={outcome?.task_result ? `${tc("app.section")}: ${outcome.task_result}` : ""}
          initialLanguage={call.language ?? ""}
          thread={call.thread_id && call.thread_subject ? { id: call.thread_id, subject: call.thread_subject } : undefined}
        />
      )}
    </div>
  );
}
