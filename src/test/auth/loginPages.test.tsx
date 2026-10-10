/**
 * Both sign-in pages: the same name/email + password form against
 * `POST /api/auth/login`, each in its own shell. What is pinned here is what a
 * person (and a password manager) sees — field attributes, the copy for each
 * way a sign-in fails, and where a successful one lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { clearAuth, getAuth } from '@/lib/pincerClient';
import { useSession } from '@/stores/session';
import Login from '@/pages/Login';
import OwnerLoginPage from '@/pages/telephony/OwnerLoginPage';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const PAIR = { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer', expires_in: 1800, pincer_user_id: 'alice' };
const ME = { pincer_user_id: 'alice', display_name: 'Alice', email: 'alice@example.com' };

const fetchMock = vi.fn<typeof fetch>();

/** `login` answers the sign-in; /api/identity/me always knows Alice. */
function backend(login: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/auth/login') return login();
    if (path === '/api/identity/me') return json(ME);
    return json({ detail: 'Not found' }, 404);
  });
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

/** Render a login page at `url` (also in window.location, where returnTo is read). */
function renderAt(url: string, page: React.ReactNode) {
  window.history.pushState({}, '', url);
  const path = url.split('?')[0];
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={page} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const PAGES = [
  {
    name: '/login',
    url: '/login',
    page: <Login />,
    home: '/dashboard',
    identifier: 'Name or email',
    password: 'Password',
    submit: 'Sign in',
    invalid: 'Name/email or password is incorrect.',
    locked: 'Too many failed attempts. Try again in a few minutes.',
    lockedFor: 'Too many failed attempts. Try again in 2 min.',
    validation: 'Enter your name or email and your password.',
    unreachable: /cannot be reached/,
  },
  {
    name: '/telephony/login',
    url: '/telephony/login',
    page: <OwnerLoginPage />,
    home: '/telephony',
    identifier: 'Name or email',
    password: 'Password',
    submit: 'Sign in',
    invalid: 'Name/email or password is incorrect.',
    locked: 'Too many failed attempts. Try again in a few minutes.',
    lockedFor: 'Too many failed attempts. Try again in 2 min.',
    validation: 'Please check your name or email and your password.',
    unreachable: /cannot be reached/,
  },
] as const;

beforeEach(() => {
  clearAuth();
  localStorage.clear();
  sessionStorage.clear();
  useSession.getState().logout();
  // The owner app is German-first; these assertions read the English copy.
  useSession.setState({ lastDisconnect: null, locale: 'en' });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAuth();
  window.history.pushState({}, '', '/');
});

describe.each(PAGES)('sign-in at $name', (p) => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, identifier = 'alice', password = 'pw') => {
    await user.type(screen.getByLabelText(p.identifier), identifier);
    await user.type(screen.getByLabelText(p.password), password);
    await user.click(screen.getByRole('button', { name: p.submit }));
  };

  it('offers fields a password manager understands, and no token or server field', () => {
    renderAt(p.url, p.page);
    const identifier = screen.getByLabelText(p.identifier);
    expect(identifier).toHaveAttribute('name', 'username');
    expect(identifier).toHaveAttribute('autocomplete', 'username');
    expect(identifier).toHaveAttribute('autocapitalize', 'none');
    expect(identifier).toHaveAttribute('spellcheck', 'false');
    expect(identifier).toHaveAttribute('maxlength', '320');
    const password = screen.getByLabelText(p.password);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByText(/token|access key|server address|api url/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot password|reset password/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('signs in and lands on its home screen', async () => {
    backend(() => json(PAIR));
    const user = userEvent.setup();
    renderAt(p.url, p.page);
    await fill(user, 'Alice@Example.com', 'correct horse');
    expect(await screen.findByTestId('where')).toHaveTextContent(p.home);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ identifier: 'Alice@Example.com', password: 'correct horse' });
    expect(getAuth()).toMatchObject({ token: 'access-1', userId: 'alice' });
    expect(sessionStorage.getItem('pincer.web.auth')).toContain('access-1');
    expect(localStorage.getItem('pincer.web.auth')).toBeNull();
  });

  it('honours a safe returnTo', async () => {
    backend(() => json(PAIR));
    const user = userEvent.setup();
    renderAt(`${p.url}?returnTo=${encodeURIComponent('/notes/daily?x=1')}`, p.page);
    await fill(user);
    expect(await screen.findByTestId('where')).toHaveTextContent('/notes/daily?x=1');
  });

  it.each(['https://evil.example/', '//evil.example/', '/x?token=abc'])('ignores the unsafe returnTo %s', async (bad) => {
    backend(() => json(PAIR));
    const user = userEvent.setup();
    renderAt(`${p.url}?returnTo=${encodeURIComponent(bad)}`, p.page);
    await fill(user);
    expect(await screen.findByTestId('where')).toHaveTextContent(p.home);
  });

  it('says the same thing for a wrong name and a wrong password', async () => {
    backend(() => json({ error: 'invalid_credentials', detail: 'Invalid credentials' }, 401));
    const user = userEvent.setup();
    renderAt(p.url, p.page);
    await fill(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(p.invalid);
    // Both fields point at the one alert.
    for (const label of [p.identifier, p.password]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAttribute('aria-describedby', alert.id);
    }
    expect(getAuth()).toBeNull();
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
    // The form is usable again.
    expect(screen.getByRole('button', { name: p.submit })).toBeEnabled();
  });

  it('explains a lockout, with the wait only when the browser may read it', async () => {
    backend(() => json({ error: 'locked_out', detail: 'Too many failed authentication attempts' }, 429));
    const user = userEvent.setup();
    renderAt(p.url, p.page);
    await fill(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(p.locked);

    backend(() => json({ error: 'locked_out' }, 429, { 'Retry-After': '90' }));
    await user.click(screen.getByRole('button', { name: p.submit }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(p.lockedFor));
  });

  it('has its own words for a request the server could not read', async () => {
    backend(() => json({ detail: [{ loc: ['body', 'identifier'], msg: 'String should have at most 320 characters' }] }, 422));
    const user = userEvent.setup();
    renderAt(p.url, p.page);
    await fill(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(p.validation);
  });

  it('says so when the server cannot be reached', async () => {
    backend(() => Promise.reject(new TypeError('Failed to fetch')));
    const user = userEvent.setup();
    renderAt(p.url, p.page);
    await fill(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(p.unreachable);
  });

  it('disables the button while the sign-in is in the air', async () => {
    let answer!: (r: Response) => void;
    backend(() => new Promise<Response>((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderAt(p.url, p.page);
    await fill(user);
    await waitFor(() => expect(screen.getByRole('button', { name: /signing in|checking/i })).toBeDisabled());
    answer(json(PAIR));
    expect(await screen.findByTestId('where')).toBeInTheDocument();
  });
});

describe('/login extras', () => {
  it('shows no sign-up link in a default build', () => {
    renderAt('/login', <Login />);
    expect(screen.queryByRole('link', { name: /sign up|request access/i })).not.toBeInTheDocument();
  });

  it('sends someone who is already signed in straight on', async () => {
    backend(() => json(PAIR));
    await useSession.getState().login({ identifier: 'alice', password: 'pw' });
    renderAt('/login', <Login />);
    expect(await screen.findByTestId('where')).toHaveTextContent('/dashboard');
  });

  it('remembers the device only when asked', async () => {
    backend(() => json(PAIR));
    const user = userEvent.setup();
    renderAt('/login', <Login />);
    await user.click(screen.getByLabelText('Remember me'));
    await user.type(screen.getByLabelText('Name or email'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByTestId('where');
    expect(localStorage.getItem('pincer.web.auth')).toContain('access-1');
    expect(sessionStorage.getItem('pincer.web.auth')).toBeNull();
  });
});

describe('/telephony/login extras', () => {
  it('asks for both fields before calling the server', async () => {
    const user = userEvent.setup();
    renderAt('/telephony/login', <OwnerLoginPage />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter your name or email and your password.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the session expired after it was lost', () => {
    useSession.setState({ lastDisconnect: 'unauthorized' });
    renderAt('/telephony/login', <OwnerLoginPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired. Please sign in again.');
  });
});
