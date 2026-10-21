/**
 * Documents → uploads: one file at a time with progress, a replace prompt for
 * files that already exist, and a cancel. Leaving the view cancels what is
 * still running.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api/client';
import { invalidateStorage, uploadFile } from '@/lib/api/storage';
import { useDocumentsT } from '@/pages/company/_lib/i18n';
import { errorText, formatSize } from '@/pages/company/_lib/storageFiles';
import type { UploadItem } from '@/pages/company/_lib/uploadItems';

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

export function useUploadQueue(prefix: string, maxBytes: number | null | undefined) {
  const t = useDocumentsT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [conflicts, setConflicts] = useState<UploadConflicts | null>(null);
  // The running upload; a ref, so a drop during it is seen at once.
  const running = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.abort();
    };
  }, []);

  const upload = useCallback(
    async (picked: UploadItem[], { into = prefix, overwrite = false } = {}) => {
      if (picked.length === 0) return;
      if (running.current) {
        toast({ title: t('toast.uploadBusy'), description: t('toast.uploadBusyBody'), variant: 'destructive' });
        return;
      }
      // The server refuses these with a 413 anyway; say so before sending megabytes.
      const tooLarge = maxBytes ? picked.filter((item) => item.file.size > maxBytes) : [];
      for (const item of tooLarge) {
        toast({ title: t('toast.tooLarge', { name: item.path, max: formatSize(maxBytes) }), variant: 'destructive' });
      }
      const items = picked.filter((item) => !tooLarge.includes(item));
      if (items.length === 0) return;

      const controller = new AbortController();
      running.current = controller;
      const { signal } = controller;
      const clashes: UploadItem[] = [];
      let done = 0;
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
            // retry resolves (a file stands where a folder is needed, or the other way round).
            if (err instanceof ApiError && err.status === 409 && !overwrite) clashes.push(item);
            else if (err instanceof ApiError && err.status === 409) {
              toast({
                title: t('toast.uploadFolderConflict', { name: item.path }),
                description: errorText(err),
                variant: 'destructive',
              });
            } else {
              toast({ title: t('toast.uploadFailed', { name: item.path }), description: errorText(err), variant: 'destructive' });
            }
          }
        }
      } finally {
        running.current = null;
        if (done > 0) void invalidateStorage(queryClient);
        if (mounted.current) {
          setProgress(null);
          if (signal.aborted) {
            toast({ title: t('toast.uploadCancelled'), description: done > 0 ? t('toast.uploaded', { count: done }) : undefined });
          } else {
            if (done > 0) toast({ title: t('toast.uploaded', { count: done }) });
            if (clashes.length > 0) setConflicts({ prefix: into, items: clashes });
          }
        }
      }
    },
    [prefix, maxBytes, queryClient, t, toast],
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

  return { progress, conflicts, upload, cancel, replace, keep };
}
