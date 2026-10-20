/**
 * Documents → the file dialog: images from a presigned inline link, text that
 * is read-only until Edit and saved with its etag, the 409 a stale save gets,
 * and a markdown preview that stays off until it is asked for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StorageFile } from '@/lib/api/storage';
import { clearAuth } from '@/lib/pincerClient';
import StorageFileDialog from '@/pages/company/_components/StorageFileDialog';
import { fileKind } from '@/pages/company/_lib/storageFiles';
import { API, fakeBackend, json, signIn, withProviders, type Call } from './storageBackend';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const entry = (key: string, content_type: string, size = 100): StorageFile => ({
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  size,
  last_modified: '2026-10-01T10:00:00+00:00',
  content_type,
  protected: false,
});

const TEXTS: Record<string, { content: string; etag: string }> = {
  'notes/plan.txt': { content: 'first draft', etag: 'etag-1' },
  'notes/readme.md': { content: '# Heading\n\nSome *text*.', etag: 'etag-md' },
};

let calls: Call[];
let saveResponse: (call: Call) => Response;

function route(call: Call): Response {
  if (call.path === '/api/storage/text' && call.method === 'GET') {
    const key = call.params.get('key')!;
    const text = TEXTS[key];
    return text ? json({ key, ...text, size: text.content.length }) : json({ detail: 'No such file' }, 404);
  }
  if (call.path === '/api/storage/text' && call.method === 'PUT') return saveResponse(call);
  if (call.path === '/api/storage/presign') {
    const key = call.params.get('key')!;
    // A local root answers with a path on the API; a cloud root with an absolute URL.
    const url = key.startsWith('local/')
      ? `/api/storage/signed/token-for-${call.params.get('disposition')}`
      : `https://bucket.test/${key}?X-Amz-Expires=900&disposition=${call.params.get('disposition')}`;
    return json({ url, expires_at: '2026-10-18T16:23:36+00:00' });
  }
  if (call.path === '/api/storage/list') return json({ prefix: '', folders: [], files: [], truncated: false });
  return json({ detail: 'Not found' }, 404);
}

const setup = () => userEvent.setup({ pointerEventsCheck: 0 });
const onClose = vi.fn();
const renderDialog = (file: StorageFile, canWrite = true) =>
  render(withProviders(<StorageFileDialog file={file} onClose={onClose} canWrite={canWrite} />));

beforeEach(() => {
  ({ calls } = fakeBackend(route));
  saveResponse = (call) => {
    const body = call.body as { key: string; content: string };
    return json({ key: body.key, etag: 'etag-2', size: body.content.length });
  };
  signIn('owner');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearAuth();
});

describe('fileKind', () => {
  it('classifies by extension, then content type, and sends big text to download', () => {
    expect(fileKind({ name: 'a.PNG', content_type: '', size: 1 })).toBe('image');
    expect(fileKind({ name: 'a.md', content_type: 'text/markdown', size: 1 })).toBe('markdown');
    expect(fileKind({ name: 'a.yaml', content_type: 'application/octet-stream', size: 1 })).toBe('text');
    expect(fileKind({ name: 'noext', content_type: 'text/plain', size: 1 })).toBe('text');
    expect(fileKind({ name: 'a.pdf', content_type: 'application/pdf', size: 1 })).toBe('other');
    expect(fileKind({ name: 'big.log', content_type: 'text/plain', size: 3 * 1024 * 1024 })).toBe('other');
  });
});

describe('StorageFileDialog', () => {
  it('previews an image from a presigned inline link', async () => {
    renderDialog(entry('img/logo.png', 'image/png'));
    const img = await screen.findByRole('img', { name: 'logo.png' });
    expect(img).toHaveAttribute('src', 'https://bucket.test/img/logo.png?X-Amz-Expires=900&disposition=inline');
    expect(calls.filter((c) => c.path === '/api/storage/text')).toHaveLength(0);
  });

  it('resolves a local root link against the API', async () => {
    renderDialog(entry('local/photo.jpg', 'image/jpeg'));
    const img = await screen.findByRole('img', { name: 'photo.jpg' });
    expect(img).toHaveAttribute('src', `${API}/api/storage/signed/token-for-inline`);
  });

  it('shows text read-only, then edits and saves it with the etag', async () => {
    const user = setup();
    renderDialog(entry('notes/plan.txt', 'text/plain'));
    expect(await screen.findByTestId('text-content')).toHaveTextContent('first draft');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const editor = screen.getByRole('textbox', { name: 'File content' });
    await user.clear(editor);
    await user.type(editor, 'second draft');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('text-content')).toHaveTextContent('second draft'));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({ key: 'notes/plan.txt', content: 'second draft', etag: 'etag-1' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('reports a file changed on the server, and overwrites only when asked', async () => {
    saveResponse = (call) =>
      (call.body as { etag: string | null }).etag
        ? json({ detail: 'notes/plan.txt changed on the server since it was opened' }, 409)
        : json({ key: 'notes/plan.txt', etag: 'etag-3', size: 4 });
    const user = setup();
    renderDialog(entry('notes/plan.txt', 'text/plain'));
    await user.click(await screen.findByRole('button', { name: /edit/i }));
    await user.type(screen.getByRole('textbox', { name: 'File content' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/changed on the server since you opened it/i);
    // Still editing: nothing was lost.
    expect(screen.getByRole('textbox', { name: 'File content' })).toHaveValue('first draft!');

    await user.click(within(alert).getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => (c.body as { etag: string | null }).etag)).toEqual(['etag-1', null]);
  });

  it('keeps the markdown preview off until it is toggled', async () => {
    const user = setup();
    renderDialog(entry('notes/readme.md', 'text/markdown'));
    expect(await screen.findByTestId('text-content')).toHaveTextContent('# Heading');
    expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /preview/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    const preview = await screen.findByTestId('markdown-preview');
    expect(within(preview).getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    expect(screen.queryByTestId('text-content')).not.toBeInTheDocument();

    // While editing, the preview follows the draft, side by side.
    await user.click(screen.getByRole('button', { name: /edit/i }));
    const editor = screen.getByRole('textbox', { name: 'File content' });
    await user.clear(editor);
    await user.type(editor, '## Changed');
    expect(within(screen.getByTestId('markdown-preview')).getByRole('heading', { name: 'Changed' })).toBeInTheDocument();
  });

  it('does not render raw HTML in markdown', async () => {
    TEXTS['notes/html.md'] = { content: 'before <b data-testid="raw">bold</b> after', etag: 'e' };
    const user = setup();
    renderDialog(entry('notes/html.md', 'text/markdown'));
    await screen.findByTestId('text-content');
    await user.click(screen.getByRole('button', { name: /preview/i }));
    await screen.findByTestId('markdown-preview');
    expect(screen.queryByTestId('raw')).not.toBeInTheDocument();
  });

  it('asks before throwing away unsaved edits', async () => {
    const user = setup();
    renderDialog(entry('notes/plan.txt', 'text/plain'));
    await user.click(await screen.findByRole('button', { name: /edit/i }));
    await user.type(screen.getByRole('textbox', { name: 'File content' }), ' more');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Discard unsaved changes?')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Discard' }));
    expect(await screen.findByTestId('text-content')).toHaveTextContent('first draft');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers no Edit without write access', async () => {
    renderDialog(entry('notes/plan.txt', 'text/plain'), false);
    await screen.findByTestId('text-content');
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('offers download and a new tab for files it cannot preview', async () => {
    renderDialog(entry('docs/report.pdf', 'application/pdf'));
    expect(await screen.findByText(/no preview/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    const tab = await screen.findByRole('link', { name: /open in new tab/i });
    expect(tab).toHaveAttribute('href', 'https://bucket.test/docs/report.pdf?X-Amz-Expires=900&disposition=inline');
    expect(tab).toHaveAttribute('target', '_blank');
  });
});
