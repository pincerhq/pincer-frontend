/**
 * A fake `/api/storage` for the Documents tests: `fetch` is answered from a
 * route table, so the real client (`request`, the hooks) runs end to end.
 */
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setAuth } from '@/lib/pincerClient';
import { useSession } from '@/stores/session';

export const API = 'http://api.test';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

/** `handle(call)` answers each request; every call is recorded in `calls`. */
export function fakeBackend(handle: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      params: url.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handle(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function signIn(role: 'owner' | null = 'owner') {
  setAuth({ apiUrl: API, token: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 1800_000, userId: 'alice' });
  useSession.getState().refresh();
  useSession.setState({ role });
}

export const testQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** `client` is shared across renders when given, as one app session's cache is. */
export function withProviders(ui: ReactNode, initial = '/company-brain/documents', client = testQueryClient()) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}
