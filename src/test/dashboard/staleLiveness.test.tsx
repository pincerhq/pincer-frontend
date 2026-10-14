/**
 * react-query keeps the last successful `data` when a refetch fails. For
 * liveness that is a lie: a stopped agent would keep showing "Running", its
 * channels "on", and a finished call "on the line". Once the poll fails the
 * dashboard says it cannot tell, instead of repeating the last answer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const STALE_STATUS = {
  data: { agent_running: true, version: '0.8.0', channels: { telegram: true, web: true } },
  isError: true,
  status: 'error',
};

vi.mock('@/lib/api/dashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/dashboard')>();
  return { ...actual, useAgentStatus: () => STALE_STATUS };
});

vi.mock('@/lib/api/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/voice')>();
  return {
    ...actual,
    useActiveCalls: () => ({ data: [{ call_sid: 'CA1' }], isError: true, status: 'error' }),
    useVoiceStatus: () => ({ data: { active_call_count: 1, engine: 'x', language: 'en', consent_mode: 'none' }, isError: true, status: 'error' }),
  };
});

const { default: Dashboard } = await import('@/pages/Dashboard');
const { AgentDetail } = await import('@/components/dashboard/dashboardDetails');
const { VoiceWidget } = await import('@/components/dashboard/widgets/VoiceWidgets');
const { QueryClientProvider } = await import('@tanstack/react-query');
const { queryClient } = await import('@/lib/queryClient');

describe('stale liveness on the dashboard', () => {
  it('the agent card does not say Running, or show channels on, once status polling fails', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.queryByText('on')).not.toBeInTheDocument();
    expect(screen.getByText('Not reachable')).toBeInTheDocument();
  });

  it('the agent detail does not say Running once status polling fails', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AgentDetail />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ online/)).not.toBeInTheDocument();
  });

  it('the voice widget does not report a call on the line once the poll fails', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <VoiceWidget />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('on the line')).not.toBeInTheDocument();
  });
});
