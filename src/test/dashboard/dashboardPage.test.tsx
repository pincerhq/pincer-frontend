/**
 * Smoke test for the dashboard page itself: the sections are wired into the
 * page in order, including the board someone composes with the ＋ dialog.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return { ...actual, isConnected: () => false, getAuth: () => null };
});

const { default: Dashboard } = await import('@/pages/Dashboard');

describe('dashboard page', () => {
  it('renders every section, board included', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getByText('3days.dashboard')).toBeInTheDocument();
    for (const section of ['Today', 'Activity', 'Spend', 'Your agent', 'Dashboards']) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /^add a dashboard$/i })).toBeInTheDocument();
    // Voice is the dashboard the board starts with.
    expect(screen.getByRole('button', { name: /^Move Voice/i })).toBeInTheDocument();
  });

  it('offers no Deploy Agent entry points', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /deploy agent/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/create ai worker/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deploy a new agent/i)).not.toBeInTheDocument();
  });

  it.each([
    [/open chat/i, '/chat', 'chat page'],
    [/voice calls/i, '/telephony', 'telephony page'],
  ])('quick action %s navigates to %s', async (name, path, landing) => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path={path} element={<p>{landing}</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByText(landing)).toBeInTheDocument();
  });
});
