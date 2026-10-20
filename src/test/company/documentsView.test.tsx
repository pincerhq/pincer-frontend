/**
 * Company → Documents: the folder list from `/api/storage/list`, navigating it
 * through `?prefix=`, write controls only for those who may add knowledge,
 * protected rows that cannot be deleted or moved (nor anything moved into),
 * uploads and their replace prompt, and a delete that asks first. `fetch` is faked (storageBackend.tsx); uploads go through XHR,
 * so `uploadFile` is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import type { StorageListing } from '@/lib/api/storage';
import { fakeBackend, json, signIn, withProviders, type Call } from './storageBackend';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const uploadFile = vi.fn(async (_prefix: string, _file: File, _opts?: unknown) => ({}));
vi.mock('@/lib/api/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/storage')>();
  return { ...actual, uploadFile: (prefix: string, file: File, opts?: unknown) => uploadFile(prefix, file, opts) };
});

const { default: BrainDocumentsView } = await import('@/pages/company/_components/BrainDocumentsView');
const { useSession } = await import('@/stores/session');
const { clearAuth } = await import('@/lib/pincerClient');
const { ApiError } = await import('@/lib/api/client');

const file = (key: string, size: number, protectedFile = false) => ({
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  size,
  last_modified: '2026-10-01T10:00:00+00:00',
  content_type: 'application/octet-stream',
  protected: protectedFile,
});

const LISTINGS: Record<string, StorageListing> = {
  '': {
    prefix: '',
    folders: [
      { key: 'hr', name: 'hr', protected: false },
      { key: 'team', name: 'team', protected: true },
    ],
    files: [file('handbook.pdf', 2048)],
    next_cursor: null,
    truncated: false,
  },
  hr: { prefix: 'hr', folders: [], files: [file('hr/contract.docx', 10)], next_cursor: null, truncated: false },
};

/** `many` holds 120 files, served 50 at a time with the file name as cursor. */
const MANY = Array.from({ length: 120 }, (_, i) => file(`many/f${String(i).padStart(3, '0')}.txt`, 1));
function manyPage(cursor: string | null, limit: number): StorageListing {
  const start = cursor ? MANY.findIndex((f) => f.name === cursor) + 1 : 0;
  const files = MANY.slice(start, start + limit);
  const more = start + limit < MANY.length;
  return { prefix: 'many', folders: [], files, next_cursor: more ? files[files.length - 1].name : null, truncated: false };
}

const INFO = {
  backend: 's3',
  root: 's3://acme/',
  protected: ['team/skills'],
  presign_ttl: 900,
  max_text_bytes: 2097152,
  max_upload_bytes: 1024,
};

let calls: Call[];

function route(call: Call): Response {
  if (call.path === '/api/storage') return json(INFO);
  if (call.path === '/api/storage/list') {
    const prefix = call.params.get('prefix') ?? '';
    if (prefix === 'many') return json(manyPage(call.params.get('cursor'), Number(call.params.get('limit'))));
    return json(LISTINGS[prefix] ?? { prefix, folders: [], files: [], next_cursor: null, truncated: false });
  }
  if (call.path === '/api/storage/object' && call.method === 'DELETE') {
    const key = call.params.get('key') ?? call.params.get('prefix');
    return json({ key, kind: call.params.has('prefix') ? 'folder' : 'file' });
  }
  if (call.path === '/api/storage/presign') {
    return json({ url: `https://bucket.test/${call.params.get('key')}?X-Amz-Expires=900`, expires_at: '' });
  }
  return json({ detail: 'Not found' }, 404);
}

let location = '';
function LocationProbe() {
  location = useLocation().search;
  return null;
}

const renderView = (initial?: string) =>
  render(
    withProviders(
      <>
        <BrainDocumentsView />
        <LocationProbe />
      </>,
      initial,
    ),
  );

const setup = () => userEvent.setup({ pointerEventsCheck: 0 });
const listCalls = () => calls.filter((c) => c.path === '/api/storage/list').map((c) => c.params.get('prefix') ?? '');

beforeEach(() => {
  ({ calls } = fakeBackend(route));
  signIn('owner');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearAuth();
});

describe('Documents view', () => {
  it('lists the folders and files of the root, and names the root', async () => {
    renderView();
    expect(await screen.findAllByText('handbook.pdf')).not.toHaveLength(0);
    expect(screen.getAllByText('hr')).not.toHaveLength(0);
    expect(screen.getAllByText('2.0 KB')).not.toHaveLength(0);
    expect(await screen.findByTestId('storage-root')).toHaveTextContent('s3://acme/');
    expect(listCalls()).toEqual(['']);
  });

  it('opens a folder into the URL and walks back up with the breadcrumb', async () => {
    const user = setup();
    renderView();
    const [folder] = await screen.findAllByRole('button', { name: 'hr' });
    await user.click(folder);
    expect(await screen.findAllByText('contract.docx')).not.toHaveLength(0);
    expect(location).toBe('?prefix=hr');
    expect(listCalls()).toContain('hr');

    const crumbs = screen.getByRole('navigation', { name: 'Folder' });
    expect(within(crumbs).getByRole('button', { name: 'hr' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(crumbs).getByRole('button', { name: 'Documents' }));
    expect(await screen.findAllByText('handbook.pdf')).not.toHaveLength(0);
    expect(location).toBe('');
  });

  it('starts in the folder the URL names', async () => {
    renderView('/company-brain/documents?prefix=/hr/');
    expect(await screen.findAllByText('contract.docx')).not.toHaveLength(0);
  });

  it('shows the empty state for an empty folder', async () => {
    renderView('/company-brain/documents?prefix=empty');
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
  });

  it('hides every write control without add_knowledge', async () => {
    useSession.setState({ role: null });
    const user = setup();
    renderView();
    await screen.findAllByText('handbook.pdf');
    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new folder/i })).not.toBeInTheDocument();
    const [menu] = screen.getAllByRole('button', { name: 'Actions for handbook.pdf' });
    await user.click(menu);
    expect(await screen.findByRole('menuitem', { name: /download/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('marks protected rows and disables delete and move on them', async () => {
    const user = setup();
    renderView();
    expect((await screen.findAllByTestId('protected-team')).length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('protected-hr')).toHaveLength(0);

    const [menu] = screen.getAllByRole('button', { name: 'Actions for team' });
    await user.click(menu);
    expect(await screen.findByRole('menuitem', { name: /delete/i })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: /rename/i })).toHaveAttribute('aria-disabled', 'true');
  });

  it('deletes a folder by prefix, after asking', async () => {
    const user = setup();
    renderView();
    const [menu] = await screen.findAllByRole('button', { name: 'Actions for hr' });
    await user.click(menu);
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete hr?')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.params.get('prefix')).toBe('hr');
    expect(del.params.has('key')).toBe(false);
  });

  it('uploads picked files into the current folder', async () => {
    const user = setup();
    renderView('/company-brain/documents?prefix=hr');
    await screen.findAllByText('contract.docx');
    const picked = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await user.upload(screen.getByTestId('documents-file-input'), picked);
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect(uploadFile.mock.calls[0][0]).toBe('hr');
    expect(uploadFile.mock.calls[0][1]).toBe(picked);
  });

  it('downloads through a presigned attachment link', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    try {
      const user = setup();
      renderView();
      const [menu] = await screen.findAllByRole('button', { name: 'Actions for handbook.pdf' });
      await user.click(menu);
      await user.click(await screen.findByRole('menuitem', { name: /download/i }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://bucket.test/handbook.pdf?X-Amz-Expires=900'));
      const presign = calls.find((c) => c.path === '/api/storage/presign')!;
      expect(presign.params.get('disposition')).toBe('attachment');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('asks for pages of 50 and loads the next one when scrolled near the end', async () => {
    // jsdom has no layout: give the list a viewport and a scroll height.
    const scroller = (el: Element) => (el as HTMLElement).dataset?.testid === 'documents-scroller';
    const sizes = { scrollHeight: 3000, clientHeight: 600 };
    const restore = Object.entries(sizes).map(([prop, value]) => {
      const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get(this: HTMLElement) {
          return scroller(this) ? value : 0;
        },
      });
      // The real getters live on Element.prototype: dropping the override restores them.
      return () =>
        original
          ? Object.defineProperty(HTMLElement.prototype, prop, original)
          : delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    });
    try {
      renderView('/company-brain/documents?prefix=many');
      expect(await screen.findAllByText('f049.txt')).not.toHaveLength(0);
      expect(screen.queryAllByText('f050.txt')).toHaveLength(0);
      const manyCalls = () => calls.filter((c) => c.path === '/api/storage/list' && c.params.get('prefix') === 'many');
      expect(manyCalls()).toHaveLength(1);
      expect(manyCalls()[0].params.get('limit')).toBe('50');
      expect(manyCalls()[0].params.has('cursor')).toBe(false);

      // Scrolling that stays far from the end loads nothing.
      const el = screen.getByTestId('documents-scroller');
      el.scrollTop = 1000;
      fireEvent.scroll(el);
      expect(manyCalls()).toHaveLength(1);

      el.scrollTop = 2300;
      fireEvent.scroll(el);
      expect(await screen.findAllByText('f099.txt')).not.toHaveLength(0);
      expect(manyCalls()[1].params.get('cursor')).toBe('f049.txt');

      fireEvent.scroll(el);
      expect(await screen.findAllByText('f119.txt')).not.toHaveLength(0);
      // The last page has no cursor: more scrolling asks for nothing.
      fireEvent.scroll(el);
      await new Promise((r) => setTimeout(r, 20));
      expect(manyCalls()).toHaveLength(3);
    } finally {
      restore.forEach((undo) => undo());
    }
  });

  it('keeps loading pages while they do not fill the view', async () => {
    // jsdom's zero-height list never scrolls, like a tall screen with a short page.
    renderView('/company-brain/documents?prefix=many');
    expect(await screen.findAllByText('f119.txt')).not.toHaveLength(0);
  });

  it('refuses files over the upload limit before sending them', async () => {
    const user = setup();
    renderView('/company-brain/documents?prefix=hr');
    await screen.findAllByText('contract.docx');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/storage')).toBe(true));
    const big = new File(['x'.repeat(2048)], 'big.bin');
    const small = new File(['x'], 'small.bin');
    await user.upload(screen.getByTestId('documents-file-input'), [big, small]);
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect(uploadFile.mock.calls[0][1]).toBe(small);
    expect(toast.error).toHaveBeenCalledWith('big.bin is larger than 1.0 KB, the most one upload may be');
  });

  it('refuses a move into a protected prefix without asking the server', async () => {
    const user = setup();
    renderView();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/storage')).toBe(true));
    const [menu] = await screen.findAllByRole('button', { name: 'Actions for handbook.pdf' });
    await user.click(menu);
    await user.click(await screen.findByRole('menuitem', { name: /rename/i }));
    const target = await screen.findByLabelText('Path');
    await user.clear(target);
    await user.type(target, 'team/skills/handbook.pdf');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not move it', {
        description: 'team/skills/handbook.pdf is in a protected folder; nothing can be moved there.',
      }),
    );
    expect(calls.some((c) => c.path === '/api/storage/move')).toBe(false);
  });

  it('asks to replace on a 409, and reports a 409 on the replace instead of asking again', async () => {
    uploadFile.mockImplementation(async (_prefix, _file, opts) => {
      throw (opts as { overwrite?: boolean }).overwrite
        ? new ApiError('notes is a file, so notes/a.txt cannot be stored under it', 409)
        : new ApiError('notes.txt already exists', 409);
    });
    const user = setup();
    renderView('/company-brain/documents?prefix=hr');
    await screen.findAllByText('contract.docx');
    await user.upload(screen.getByTestId('documents-file-input'), new File(['hello'], 'notes.txt'));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('notes.txt already exists')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    expect(uploadFile.mock.calls[1][2]).toMatchObject({ overwrite: true });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('notes.txt could not be replaced', {
        description: 'notes is a file, so notes/a.txt cannot be stored under it',
      }),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
