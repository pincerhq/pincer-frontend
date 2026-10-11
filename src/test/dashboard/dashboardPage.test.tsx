/**
 * Smoke test for the dashboard page itself: the sections are wired into the
 * page in order, including the board someone composes with the ＋ dialog.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
});
