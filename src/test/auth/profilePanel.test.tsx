/**
 * The profile panel's password form against `PUT /api/identity/me/password`.
 * What is pinned here is what a person (and a password manager) sees — field
 * attributes, the copy for each way a change fails — and that a successful
 * change keeps this browser signed in with the pair the server answered.
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearAuth, getAuth, setAuth } from '@/lib/pincerClient';
import { useSession } from '@/stores/session';
import { Toaster } from '@/components/ui/toaster';
import { ProfilePanel } from '@/components/account/ProfilePanel';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const NEW_PAIR = { access_token: 'access-2', refresh_token: 'refresh-2', token_type: 'bearer', expires_in: 1800, pincer_user_id: 'alice' };

const fetchMock = vi.fn<typeof fetch>();

/** `change` answers the password change; nothing else is expected. */
function backend(change: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/identity/me/password') return change();
    return json({ detail: 'Not found' }, 404);
  });
}

function signIn(persist = false) {
  setAuth({ apiUrl: 'http://api.test', token: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 1800_000, userId: 'alice' }, { persist });
  useSession.getState().refresh();
  useSession.setState({ identity: { id: 'alice', displayName: 'Alice', email: 'alice@example.com' } });
}

function Host() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <ProfilePanel open={open} onOpenChange={setOpen} />
      <Toaster />
    </>
  );
}

const setup = () => userEvent.setup({ pointerEventsCheck: 0 });

async function fill(user: ReturnType<typeof setup>, current: string, next: string, confirm: string) {
  if (current) await user.type(screen.getByLabelText('Current password'), current);
  if (next) await user.type(screen.getByLabelText('New password'), next);
  if (confirm) await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Change password' }));
}

/** The alert a field points at through aria-describedby. */
function errorOf(label: string): HTMLElement | null {
  const field = screen.getByLabelText(label);
  if (field.getAttribute('aria-invalid') !== 'true') return null;
  const alert = document.getElementById(field.getAttribute('aria-describedby') ?? '');
  return alert?.getAttribute('role') === 'alert' ? alert : null;
}

beforeEach(() => {
  clearAuth();
  localStorage.clear();
  sessionStorage.clear();
  useSession.getState().logout();
  // The owner app is German-first; these assertions read the English copy.
  useSession.setState({ lastDisconnect: null, locale: 'en' });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  signIn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAuth();
});

describe('profile panel', () => {
  it('shows who is signed in', () => {
    render(<Host />);
    expect(screen.getByRole('dialog', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('falls back to the id while the name is unknown', () => {
    useSession.setState({ identity: { id: 'alice', displayName: null, email: null } });
    render(<Host />);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('offers fields a password manager understands', () => {
    render(<Host />);
    const current = screen.getByLabelText('Current password');
    expect(current).toHaveAttribute('type', 'password');
    expect(current).toHaveAttribute('autocomplete', 'current-password');
    for (const label of ['New password', 'Confirm new password']) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute('type', 'password');
      expect(field).toHaveAttribute('autocomplete', 'new-password');
    }
    const username = document.querySelector('input[name="username"]')!;
    expect(username).toHaveAttribute('autocomplete', 'username');
    expect(username).toHaveAttribute('readonly');
    expect(username).toHaveValue('alice@example.com');
    expect(username).not.toBeVisible();
  });

  it('asks for every field before calling the server', async () => {
    const user = setup();
    render(<Host />);
    await fill(user, '', '', '');
    for (const label of ['Current password', 'New password', 'Confirm new password']) {
      expect(errorOf(label)).toHaveTextContent('Please fill in this field.');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a new password that is too short', async () => {
    const user = setup();
    render(<Host />);
    await fill(user, 'old password', '1234567', '1234567');
    expect(errorOf('New password')).toHaveTextContent('The new password needs at least 8 characters.');
    expect(errorOf('Current password')).toBeNull();
    expect(errorOf('Confirm new password')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts characters the way the server does, not UTF-16 units', async () => {
    backend(() => json(NEW_PAIR));
    const user = setup();
    render(<Host />);
    // Four emoji are eight UTF-16 units, and four characters.
    await fill(user, 'old password', '😀😀😀😀', '😀😀😀😀');
    expect(errorOf('New password')).toHaveTextContent('The new password needs at least 8 characters.');
    expect(fetchMock).not.toHaveBeenCalled();

    // 129 emoji are 258 units, and well inside the 256 characters allowed.
    const long = '😀'.repeat(129);
    for (const label of ['New password', 'Confirm new password']) {
      await user.clear(screen.getByLabelText(label));
      await user.click(screen.getByLabelText(label));
      await user.paste(long);
    }
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ current_password: 'old password', new_password: long });
  });

  it('refuses a confirmation that differs', async () => {
    const user = setup();
    render(<Host />);
    await fill(user, 'old password', 'new password', 'new passwort');
    expect(errorOf('Confirm new password')).toHaveTextContent('The two new passwords do not match.');
    expect(errorOf('New password')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the current and the new password, and nothing else', async () => {
    backend(() => json(NEW_PAIR));
    const user = setup();
    render(<Host />);
    await fill(user, 'old password', 'new password', 'new password');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/api/identity/me/password');
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(init!.body as string)).toEqual({ current_password: 'old password', new_password: 'new password' });
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer access-1');
  });

  it('keeps a session-only tab signed in with the new pair, says so and closes', async () => {
    backend(() => json(NEW_PAIR));
    const user = setup();
    render(<Host />);
    await fill(user, 'old password', 'new password', 'new password');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Your password has been changed.')).toBeInTheDocument();
    expect(getAuth()).toMatchObject({ token: 'access-2', refreshToken: 'refresh-2', userId: 'alice' });
    expect(sessionStorage.getItem('pincer.web.auth')).toContain('refresh-2');
    expect(localStorage.getItem('pincer.web.auth')).toBeNull();
    expect(useSession.getState().connected).toBe(true);
  });

  it('keeps a remembered device remembered', async () => {
    signIn(true);
    backend(() => json(NEW_PAIR));
    const user = setup();
    render(<Host />);
    await fill(user, 'old password', 'new password', 'new password');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(localStorage.getItem('pincer.web.auth')).toContain('refresh-2');
    expect(sessionStorage.getItem('pincer.web.auth')).toBeNull();
    expect(useSession.getState().connected).toBe(true);
    expect(useSession.getState().remembered).toBe(true);
  });

  const oldSessionStays = () => {
    expect(getAuth()).toMatchObject({ token: 'access-1', refreshToken: 'refresh-1' });
    expect(useSession.getState().connected).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The form is usable again.
    expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled();
  };

  it('says the current password is wrong on that field', async () => {
    backend(() => json({ detail: 'Current password is incorrect' }, 403));
    const user = setup();
    render(<Host />);
    await fill(user, 'wrong password', 'new password', 'new password');
    await waitFor(() => expect(errorOf('Current password')).toHaveTextContent('The current password is incorrect.'));
    oldSessionStays();
  });

  it("shows the server's own sentence about the new password", async () => {
    backend(() => json({ detail: 'Password must be at least 8 characters' }, 422));
    const user = setup();
    render(<Host />);
    await fill(user, 'old password', 'new password', 'new password');
    await waitFor(() => expect(errorOf('New password')).toHaveTextContent('Password must be at least 8 characters'));
    oldSessionStays();
  });

  it('explains a lockout, with the wait only when the browser may read it', async () => {
    backend(() => json({ detail: 'Too many failed authentication attempts' }, 429));
    const user = setup();
    render(<Host />);
    await fill(user, 'wrong password', 'new password', 'new password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed attempts. Try again in a few minutes.');

    backend(() => json({ detail: 'Too many failed authentication attempts' }, 429, { 'Retry-After': '90' }));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many failed attempts. Try again in 2 min.'));
    oldSessionStays();
  });

  it('says so when the server cannot be reached', async () => {
    backend(() => Promise.reject(new TypeError('Failed to fetch')));
    const user = setup();
    render(<Host />);
    await fill(user, 'old password', 'new password', 'new password');
    expect(await screen.findByRole('alert')).toHaveTextContent('The server cannot be reached right now. Please try again.');
    oldSessionStays();
  });

  it('disables the button while the change is in the air', async () => {
    let answer!: (r: Response) => void;
    backend(() => new Promise<Response>((resolve) => (answer = resolve)));
    const user = setup();
    render(<Host />);
    await fill(user, 'old password', 'new password', 'new password');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving …' })).toBeDisabled());
    answer(json(NEW_PAIR));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('drops an answer that arrives after it was closed', async () => {
    let answer!: (r: Response) => void;
    backend(() => new Promise<Response>((resolve) => (answer = resolve)));
    const user = setup();
    const { rerender } = render(<ProfilePanel open onOpenChange={() => {}} />);
    await fill(user, 'wrong password', 'new password', 'new password');
    await waitFor(() => expect(answer).toBeDefined());
    rerender(<ProfilePanel open={false} onOpenChange={() => {}} />);
    rerender(<ProfilePanel open onOpenChange={() => {}} />);
    // Still in the air: a second change now would use the token the first revokes.
    expect(screen.getByRole('button', { name: 'Saving …' })).toBeDisabled();
    answer(json({ detail: 'Current password is incorrect' }, 403));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled());
    expect(errorOf('Current password')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not close a panel that was reopened while the change was in the air', async () => {
    let answer!: (r: Response) => void;
    backend(() => new Promise<Response>((resolve) => (answer = resolve)));
    const user = setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(<ProfilePanel open onOpenChange={onOpenChange} />);
    await fill(user, 'old password', 'new password', 'new password');
    await waitFor(() => expect(answer).toBeDefined());
    rerender(<ProfilePanel open={false} onOpenChange={onOpenChange} />);
    rerender(<ProfilePanel open onOpenChange={onOpenChange} />);
    answer(json(NEW_PAIR));
    await waitFor(() => expect(getAuth()).toMatchObject({ token: 'access-2' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('forgets what was typed when it closes', async () => {
    const user = setup();
    const { rerender } = render(<ProfilePanel open onOpenChange={() => {}} />);
    await user.type(screen.getByLabelText('Current password'), 'old password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(errorOf('New password')).not.toBeNull();
    rerender(<ProfilePanel open={false} onOpenChange={() => {}} />);
    rerender(<ProfilePanel open onOpenChange={() => {}} />);
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(errorOf('New password')).toBeNull();
  });
});
