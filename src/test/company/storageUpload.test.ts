/**
 * `uploadFile` goes through XHR (for progress), not `authedFetch`, so it
 * handles a 401 the way `authedFetch` does itself: `token_expired` refreshes
 * and retries once; `invalid_token`, a rejected refresh or a second 401 ends
 * the session; a 401 without an auth code or an unreachable refresh does not.
 * Error bodies read like every other API error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { uploadFile } from '@/lib/api/storage';
import { clearAuth, getAuth, onAuthLost } from '@/lib/pincerClient';
import { fakeBackend, json, signIn, type Call } from './storageBackend';

/** What each XHR answers, in order. */
let answers: Array<{ status: number; body: unknown }>;
/** The Authorization header and the multipart filename of each XHR sent. */
let sent: Array<{ authorization: string | undefined; filename: string }>;

class FakeXhr {
  status = 0;
  responseText = '';
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private headers: Record<string, string> = {};
  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  abort() {}
  send(form: FormData) {
    const file = form.get('files') as File;
    sent.push({ authorization: this.headers.authorization, filename: file.name });
    const answer = answers.shift() ?? { status: 500, body: null };
    this.status = answer.status;
    this.responseText = JSON.stringify(answer.body);
    queueMicrotask(() => this.onload?.());
  }
}

let refreshCalls: Call[];
let refreshAnswer: () => Response;

const stored = { key: 'hr/notes.txt', name: 'notes.txt', size: 5, last_modified: null, content_type: 'text/plain', protected: false };
const file = () => new File(['hello'], 'notes.txt');

beforeEach(() => {
  answers = [];
  sent = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  ({ calls: refreshCalls } = fakeBackend((call) => (call.path === '/api/auth/refresh' ? refreshAnswer() : json({}, 404))));
  refreshAnswer = () =>
    json({ access_token: 'fresh', refresh_token: 'refresh-2', token_type: 'bearer', expires_in: 1800, pincer_user_id: 'alice' });
  signIn('owner');
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAuth();
});

describe('uploadFile', () => {
  it('stores the file under its path, subfolders included', async () => {
    answers = [{ status: 201, body: { files: [stored] } }];
    await expect(uploadFile('hr', file(), { path: 'reports/2026/notes.txt' })).resolves.toEqual(stored);
    expect(sent[0].filename).toBe('reports/2026/notes.txt');
  });

  it('refreshes an expired token and retries once with the new one', async () => {
    answers = [
      { status: 401, body: { error: 'token_expired' } },
      { status: 201, body: { files: [stored] } },
    ];
    await expect(uploadFile('hr', file())).resolves.toEqual(stored);
    expect(refreshCalls).toHaveLength(1);
    expect(sent.map((s) => s.authorization)).toEqual(['Bearer access', 'Bearer fresh']);
    expect(getAuth()?.token).toBe('fresh');
  });

  it('ends the session on invalid_token', async () => {
    const lost = vi.fn();
    const off = onAuthLost(lost);
    answers = [{ status: 401, body: { error: 'invalid_token' } }];
    await expect(uploadFile('hr', file())).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
    expect(getAuth()).toBeNull();
    expect(lost).toHaveBeenCalledTimes(1);
    off();
  });

  it('ends the session on a second 401 after the refresh', async () => {
    answers = [
      { status: 401, body: { error: 'token_expired' } },
      { status: 401, body: { error: 'token_expired' } },
    ];
    await expect(uploadFile('hr', file())).rejects.toBeInstanceOf(ApiError);
    expect(sent).toHaveLength(2);
    expect(getAuth()).toBeNull();
  });

  it('ends the session when the refresh is rejected, without retrying', async () => {
    refreshAnswer = () => json({ detail: 'refresh token revoked' }, 401);
    answers = [{ status: 401, body: { error: 'token_expired' } }];
    await expect(uploadFile('hr', file())).rejects.toMatchObject({ status: 401 });
    expect(sent).toHaveLength(1);
    expect(getAuth()).toBeNull();
  });

  it('keeps the session when the refresh cannot be reached, or on a 401 without an auth code', async () => {
    refreshAnswer = () => json({ detail: 'down' }, 503);
    answers = [{ status: 401, body: { error: 'token_expired' } }];
    await expect(uploadFile('hr', file())).rejects.toMatchObject({ status: 401 });
    expect(getAuth()?.token).toBe('access');

    answers = [{ status: 401, body: { detail: 'Not allowed here' } }];
    await expect(uploadFile('hr', file())).rejects.toMatchObject({ status: 401, message: 'Not allowed here' });
    expect(getAuth()?.token).toBe('access');
  });

  it('reads a validation error like any other API error', async () => {
    answers = [
      { status: 422, body: { detail: [{ loc: ['query', 'prefix'], msg: 'String should have at most 1024 characters' }] } },
    ];
    const err = await uploadFile('hr', file()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('String should have at most 1024 characters');
    expect((err as ApiError).fields).toEqual({ prefix: 'String should have at most 1024 characters' });
  });
});
