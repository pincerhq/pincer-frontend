/**
 * The composer's demo agent roster (Emma, Aria, Felix, Maya) only inserted
 * "@Name" text — there are no such agents behind it — so it is gone: no picker,
 * no "Demo roster" label, no names in the page or in its source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities')>();
  return {
    ...actual,
    useHealth: () => ({ status: 'success', data: { status: 'ok' }, isError: false, isSuccess: true, fetchStatus: 'idle', dataUpdatedAt: Date.now(), errorUpdatedAt: 0 }),
  };
});

vi.mock('@/lib/pincerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pincerClient')>();
  return {
    ...actual,
    isConnected: () => true,
    getAuth: () => ({ apiUrl: 'http://pincer.test', token: 't', refreshToken: 'r', expiresAt: Date.now() + 60_000, userId: 'alice' }),
    fetchLatestConversation: async () => null,
  };
});

vi.mock('@/lib/api/conversations', () => ({
  listConversations: async () => ({ conversations: [], limit: 20, offset: 0 }),
}));

const { default: Chat } = await import('@/pages/Chat');

const ROSTER = /\b(Emma|Aria|Felix|Maya)\b|Demo roster/;

describe('chat without the demo agent roster', () => {
  it('renders no agent picker and no roster names', () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Chat />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /mention an agent/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(ROSTER);
  });

  it('the Chat source no longer carries the roster', () => {
    const src = readFileSync(path.resolve(__dirname, '../../pages/Chat.tsx'), 'utf8');
    expect(src).not.toMatch(ROSTER);
    expect(src).not.toMatch(/\bAGENTS\b|pickAgent|showAgentMenu/);
  });
});
