/**
 * The route guard: the session store decides, and the redirect goes to the
 * login that belongs to the path, carrying where to come back to.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import { clearAuth, setAuth } from '@/lib/pincerClient';
import { useSession } from '@/stores/session';

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/login" element={<Where />} />
        <Route path="/telephony/login" element={<Where />} />
        <Route path="*" element={<ProtectedRoute><p>secret screen</p></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearAuth();
  localStorage.clear();
  sessionStorage.clear();
  useSession.getState().refresh();
});

describe('ProtectedRoute', () => {
  it.each([
    ['/dashboard', '/login?returnTo=%2Fdashboard'],
    ['/notes/daily?x=1', '/login?returnTo=%2Fnotes%2Fdaily%3Fx%3D1'],
    ['/telephony', '/telephony/login?returnTo=%2Ftelephony'],
    ['/telephony/calls/CA-1', '/telephony/login?returnTo=%2Ftelephony%2Fcalls%2FCA-1'],
  ])('sends a signed-out visitor from %s to %s', (from, to) => {
    renderAt(from);
    expect(screen.getByTestId('where')).toHaveTextContent(to);
    expect(screen.queryByText('secret screen')).not.toBeInTheDocument();
  });

  it('does not pass a path carrying a credential on as returnTo', () => {
    renderAt('/dashboard?token=abc');
    expect(screen.getByTestId('where').textContent).toBe('/login');
  });

  it('is not fooled by the old browser-side flag', () => {
    localStorage.setItem('isAuthenticated', 'true');
    sessionStorage.setItem('isAuthenticated', 'true');
    renderAt('/dashboard');
    expect(screen.getByTestId('where')).toHaveTextContent('/login');
  });

  it('lands on the login (no loop) with a session record from before per-identity sign-in', () => {
    localStorage.setItem('pincer.web.auth', JSON.stringify({ apiUrl: 'http://api.test', token: 'shared-token' }));
    useSession.getState().refresh();
    renderAt('/dashboard');
    expect(screen.getByTestId('where')).toHaveTextContent('/login?returnTo=%2Fdashboard');
    expect(localStorage.getItem('pincer.web.auth')).toBeNull();
  });

  it('renders the screen for a signed-in session and reacts when it ends', async () => {
    setAuth({ apiUrl: 'http://api.test', token: 'a', refreshToken: 'r', expiresAt: Date.now() + 600_000, userId: 'alice' }, { persist: false });
    useSession.getState().refresh();
    renderAt('/dashboard');
    expect(screen.getByText('secret screen')).toBeInTheDocument();
    useSession.getState().disconnect('unauthorized');
    expect(await screen.findByTestId('where')).toHaveTextContent('/login?returnTo=%2Fdashboard');
  });
});
