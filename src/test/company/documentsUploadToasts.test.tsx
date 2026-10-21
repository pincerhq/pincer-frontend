/**
 * Documents → upload reports, through the app's real toaster. It shows one
 * toast at a time (TOAST_LIMIT = 1), so a run must end in a single toast that
 * still names every file that failed: a toast per failure, or a success toast
 * after them, would leave only the last one on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components/ui/toaster';
import { fakeBackend, json, signIn, withProviders } from './storageBackend';

const uploadFile = vi.fn<(prefix: string, file: File) => Promise<unknown>>();
vi.mock('@/lib/api/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/storage')>();
  return { ...actual, uploadFile: (prefix: string, file: File) => uploadFile(prefix, file) };
});

const { default: BrainDocumentsView } = await import('@/pages/company/_components/BrainDocumentsView');
const { clearAuth } = await import('@/lib/pincerClient');
const { ApiError } = await import('@/lib/api/client');

beforeEach(() => {
  fakeBackend((call) => {
    if (call.path === '/api/storage') {
      return json({ backend: 's3', root: 's3://acme/', protected: [], presign_ttl: 900, max_upload_bytes: 1024 });
    }
    if (call.path === '/api/storage/list') return json({ prefix: '', folders: [], files: [], next_cursor: null, truncated: false });
    return json({ detail: 'Not found' }, 404);
  });
  signIn('owner');
  uploadFile.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAuth();
});

describe('Documents upload toasts', () => {
  it('keeps every failure of a run on screen, after the files that did upload', async () => {
    uploadFile.mockImplementation(async (_prefix, file) => {
      if (file.name === 'broken.txt') throw new ApiError('Storage is unavailable', 500);
      return {};
    });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      withProviders(
        <>
          <BrainDocumentsView />
          <Toaster />
        </>,
      ),
    );
    await screen.findByText('No documents yet');
    await waitFor(() => expect(screen.getByTestId('storage-root')).toBeInTheDocument());

    await user.upload(screen.getByTestId('documents-file-input'), [
      new File(['a'], 'first.txt'),
      new File(['x'.repeat(2048)], 'huge.bin'),
      new File(['b'], 'broken.txt'),
      new File(['c'], 'last.txt'),
    ]);

    expect(await screen.findByText('Uploaded 2 files; 2 could not be uploaded')).toBeInTheDocument();
    expect(screen.getByText('huge.bin: larger than 1.0 KB, the most one upload may be')).toBeInTheDocument();
    expect(screen.getByText('broken.txt: Storage is unavailable')).toBeInTheDocument();
    expect(uploadFile).toHaveBeenCalledTimes(3);
  });
});
