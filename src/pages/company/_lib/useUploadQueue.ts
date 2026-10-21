/**
 * Documents → uploads: one file at a time with progress, a replace prompt for
 * files that already exist, and a cancel. Leaving the view cancels what is
 * still running, and a dropped folder still being read is never sent.
 *
 * A run ends in one toast that names every file that failed: the app's toaster
 * shows a single toast at a time (TOAST_LIMIT = 1), so a toast per failure
 * would leave only the last one on screen.
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api/client';
import { invalidateStorage, uploadFile } from '@/lib/api/storage';
import { useDocumentsT } from '@/pages/company/_lib/i18n';
import { errorText, formatSize } from '@/pages/company/_lib/storageFiles';
import { droppedItems, type UploadItem } from '@/pages/company/_lib/uploadItems';

export interface UploadProgress {
  name: string;
  index: number;
  count: number;
  loaded: number;
  total: number;
}

/** Files that already exist, and the folder they were uploaded into. */
export interface UploadConflicts {
  prefix: string;
  items: UploadItem[];
}

interface Failure {
  path: string;
  reason: string;
}

/** One line per failed file, for a toast description. */
function failureList(failed: Failure[]): ReactNode {
  return createElement(
    'ul',
    { className: 'mt-1 space-y-0.5' },
    failed.map((f, i) => createElement('li', { key: i, className: 'break-words' }, `${f.path}: ${f.reason}`)),
  );
}

/** False once the view has unmounted. */
const isAlive = (life: RefObject<AbortController | null>) => !!life.current && !life.current.signal.aborted;

export function useUploadQueue(prefix: string, maxBytes: number | null | undefined) {
  const t = useDocumentsT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [conflicts, setConflicts] = useState<UploadConflicts | null>(null);
  // The running upload; a ref, so a drop during it is seen at once.
  const running = useRef<AbortController | null>(null);
  // Aborted when the view unmounts: stops a folder walk and refuses a late upload.
  const life = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => {
      controller.abort();
      running.current?.abort();
    };
  }, []);

  const upload = useCallback(
    async (picked: UploadItem[], { into = prefix, overwrite = false } = {}) => {
      if (!isAlive(life) || picked.length === 0) return;
      if (running.current) {
        toast({ title: t('toast.uploadBusy'), description: t('toast.uploadBusyBody'), variant: 'destructive' });
        return;
      }
      // The server refuses these with a 413 anyway; say so before sending megabytes.
      const tooLarge = maxBytes ? picked.filter((item) => item.file.size > maxBytes) : [];
      const failed: Failure[] = tooLarge.map((item) => ({
        path: item.path,
        reason: t('toast.tooLarge', { max: formatSize(maxBytes) }),
      }));
      const items = picked.filter((item) => !tooLarge.includes(item));

      const controller = new AbortController();
      const { signal } = controller;
      const clashes: UploadItem[] = [];
      let done = 0;
      if (items.length > 0) running.current = controller;
      try {
        for (const [index, item] of items.entries()) {
          if (signal.aborted) break;
          setProgress({ name: item.path, index, count: items.length, loaded: 0, total: item.file.size });
          try {
            await uploadFile(into, item.file, {
              path: item.path,
              overwrite,
              signal,
              onProgress: (loaded, total) => setProgress((p) => (p ? { ...p, loaded, total } : p)),
            });
            done += 1;
          } catch (err) {
            if (signal.aborted) break;
            // A first 409 asks to replace. One on the replace itself is not a clash a
            // retry resolves (a file stands where a folder is needed, or the other way
            // round); the server's sentence says which.
            if (err instanceof ApiError && err.status === 409 && !overwrite) clashes.push(item);
            else failed.push({ path: item.path, reason: errorText(err) });
          }
        }
      } finally {
        if (running.current === controller) running.current = null;
        if (done > 0) void invalidateStorage(queryClient);
        if (isAlive(life)) {
          setProgress(null);
          const uploaded = done > 0 ? t('toast.uploaded', { count: done }) : null;
          if (signal.aborted) {
            toast({
              title: t('toast.uploadCancelled'),
              description: failed.length > 0 ? failureList(failed) : (uploaded ?? undefined),
              variant: failed.length > 0 ? 'destructive' : undefined,
            });
          } else if (failed.length > 0) {
            toast({
              title: uploaded
                ? t('toast.uploadedWithFailures', { count: failed.length, uploaded })
                : t('toast.uploadFailures', { count: failed.length }),
              description: failureList(failed),
              variant: 'destructive',
            });
          } else if (uploaded) {
            toast({ title: uploaded });
          }
          if (!signal.aborted && clashes.length > 0) setConflicts({ prefix: into, items: clashes });
        }
      }
    },
    [prefix, maxBytes, queryClient, t, toast],
  );

  /**
   * Upload what was dropped, dropped folders walked. Must be called during the
   * drop event: the entries are read before it returns. Leaving the view stops
   * the walk, and nothing is sent.
   */
  const uploadDropped = useCallback(
    (transfer: DataTransfer) => {
      if (running.current) {
        toast({ title: t('toast.uploadBusy'), description: t('toast.uploadBusyBody'), variant: 'destructive' });
        return;
      }
      const signal = life.current?.signal;
      droppedItems(transfer, signal).then(
        (items) => upload(items),
        (err) => {
          if (signal?.aborted) return;
          toast({ title: t('toast.dropFailed'), description: errorText(err), variant: 'destructive' });
        },
      );
    },
    [t, toast, upload],
  );

  /** Stop the running upload: the file in flight is aborted and the rest are not sent. */
  const cancel = useCallback(() => running.current?.abort(), []);

  /** Upload the clashing files again, replacing, into the folder they were meant for. */
  const replace = useCallback(() => {
    if (!conflicts) return;
    setConflicts(null);
    void upload(conflicts.items, { into: conflicts.prefix, overwrite: true });
  }, [conflicts, upload]);

  const keep = useCallback(() => setConflicts(null), []);

  return { progress, conflicts, upload, uploadDropped, cancel, replace, keep };
}
