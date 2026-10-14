import { lazy, Suspense } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import '@/i18n/voice';
import TelephonyLayout from '@/pages/telephony/_components/shared/TelephonyLayout';
import ViewSkeleton from '@/pages/telephony/_components/shared/ViewSkeleton';
import VoiceAuthGuard from '@/pages/telephony/_components/shared/VoiceAuthGuard';
import ViewErrorBoundary from '@/pages/telephony/_components/shared/ViewErrorBoundary';
import TelephonyMiniRail from '@/pages/telephony/_components/sidebar/TelephonyMiniRail';
import MobileTabBar from '@/pages/telephony/_components/sidebar/MobileTabBar';
import { useSession } from '@/stores/session';
import StatusBanner from '@/pages/telephony/_components/shared/StatusBanner';
import { ROUTES, } from '@/pages/telephony/_lib/routes';

import { queryClient } from '@/lib/queryClient';

// FE10 §1 performance: every view is its own chunk; the shell stays small.
//
// The list is short by design: a view is mounted here only when the backend
// actually serves what it reads. Screens whose endpoints do not exist on the
// server (Einrichtung, Wissen, Regeln, Berichte, Kampagnen, Nachfass,
// Integrationen, Datenschutz, Vertrauen, Werkzeuge, Team, Vorlagen, Widget,
// Rufnummern, Nutzung, Protokoll, Aufmerksamkeit) were removed rather than
// left to render demo data or a permanent error state.
const OverviewView = lazy(() => import('@/pages/telephony/_components/overview/OverviewView'));
const CallsListView = lazy(() => import('@/pages/telephony/_components/owner-calls/CallsListView'));
const CallDetailPage = lazy(() => import('@/pages/telephony/_components/owner-calls/CallDetailPage'));
const VoicePage = lazy(() => import('@/pages/telephony/_components/voice/VoicePage'));
const LiveView = lazy(() => import('@/pages/telephony/_components/voice/LiveView'));
const PendingApprovalView = lazy(() => import('@/pages/telephony/_components/voice/PendingApprovalView'));
const PlannedCallsView = lazy(() => import('@/pages/telephony/_components/voice/PlannedCallsView'));
const MessagesView = lazy(() => import('@/pages/telephony/_components/voice/MessagesView'));
const ThreadDetailView = lazy(() => import('@/pages/telephony/_components/threads/ThreadDetailView'));
const PoliciesView = lazy(() => import('@/pages/telephony/_components/policies/PoliciesView'));
const VoiceSettingsView = lazy(() => import('@/pages/telephony/_components/settings/VoiceSettingsView'));
const ChatPage = lazy(() => import('@/pages/Chat'));

// FE1 PR-4: the owner web chat, mounted as-is (it brings the platform shell).

export default function TelephonyHome() {
  const tenantKey = useSession((s) => s.tenantId ?? 'single');
  const location = useLocation();
  const params = useParams<{ callSid?: string; threadId?: string }>();
  const path = location.pathname;


  // Assistent: the existing web chat page renders its own platform shell, so
  // it is mounted outside the telephony layout rather than nested inside it.
  if (path === ROUTES.ASSISTANT) {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-[var(--text-5)]" />}>
        <ChatPage />
      </Suspense>
    );
  }
  if (path === ROUTES.OVERVIEW_ALIAS) return <Navigate to={ROUTES.HOME} replace />;

  const renderContent = () => {
    // A single matter, end to end (S14 §3) — the centerpiece of the history.
    if (params.threadId) return <ThreadDetailView threadId={params.threadId} />;

    // One call, end to end — the owner's detail page (FE2 §2).
    if (params.callSid) return <CallDetailPage callSid={params.callSid} />;

    // Messages: the receptionist's inbox (S12 §11) — real rows, no demo data.
    if (path === ROUTES.MESSAGES) return <MessagesView />;

    // Live: real active-call monitor with expandable call detail.
    if (path === ROUTES.CALLS_LIVE) return <LiveView />;

    // Pending Approval: gates the agent parks mid-call, from /approvals.
    if (path === ROUTES.CALLS_PENDING) return <PendingApprovalView />;

    // Planned: server-side scheduled calls.
    if (path === ROUTES.PLANNED) return <PlannedCallsView />;

    // Policies: the do-not-call list is real CRUD and the consent facts are
    // read from the server.
    if (path === ROUTES.POLICIES) return <PoliciesView />;

    // Settings: the server's own status plus the one setting its API accepts.
    if (path === ROUTES.SETTINGS) return <VoiceSettingsView />;

    // Übersicht (FE1): the owner's home screen.
    if (path === ROUTES.HOME) return <OverviewView />;
    // Anrufe (FE2): the owner's history.
    if (path === ROUTES.CALLS) return <CallsListView />;

    // /telephony/calls/ops: the operator-flavoured voice page (threads, latency, cost).
    return <VoicePage />;
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TelephonyLayout key={tenantKey}>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <TelephonyMiniRail />
          <div className="owner-app-touch flex min-h-0 flex-1 flex-col overflow-hidden pb-16 md:pb-0">
            <StatusBanner />
            <ViewErrorBoundary key={path}>
              <VoiceAuthGuard>
                <Suspense fallback={<ViewSkeleton />}>{renderContent()}</Suspense>
              </VoiceAuthGuard>
            </ViewErrorBoundary>
          </div>
          <MobileTabBar />
        </div>
      </TelephonyLayout>
    </QueryClientProvider>
  );
}
