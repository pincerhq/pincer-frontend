/**
 * SIGNUP_ALLOWED is read from the runtime config: without it /signup does not exist and
 * nothing links to it; with it the page is a request-access form, because the
 * API has no registration endpoint to create an account with.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

async function renderApp(url: string, flag?: string) {
  vi.resetModules();
  if (flag !== undefined) window.__ENV__ = { SIGNUP_ALLOWED: flag };
  window.history.pushState({}, '', url);
  const { default: App } = await import('@/App');
  return render(<App />);
}

afterEach(() => {
  delete window.__ENV__;
  window.history.pushState({}, '', '/');
});

describe('signup gate', () => {
  it('answers /signup with the 404 page by default', async () => {
    await renderApp('/signup');
    expect(await screen.findByRole('heading', { name: 'Page Not Found' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /request access/i })).not.toBeInTheDocument();
  });

  it.each(['false', '1', 'TRUE', ''])('stays off for SIGNUP_ALLOWED=%j', async (value) => {
    await renderApp('/login', value);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /request access/i })).not.toBeInTheDocument();
  });

  it('links to it from the login when enabled', async () => {
    await renderApp('/login', 'true');
    expect(await screen.findByRole('link', { name: /request access/i })).toHaveAttribute('href', '/signup');
  });

  it('is a request-access form when enabled: no password, no account created', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await renderApp('/signup', 'true');
    expect(await screen.findByRole('heading', { name: 'Request access' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('First name'), 'Bob');
    await user.type(screen.getByLabelText('Last name'), 'Baker');
    await user.type(screen.getByLabelText('Work email'), 'bob@example.com');
    await user.type(screen.getByLabelText('Company name'), 'Baker GmbH');
    await user.click(screen.getByRole('button', { name: 'Send access request' }));

    expect(await screen.findByText(/an administrator will create your account/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('isAuthenticated')).toBeNull();
    expect(localStorage.getItem('pincer.web.auth')).toBeNull();
    vi.unstubAllGlobals();
  });
});
