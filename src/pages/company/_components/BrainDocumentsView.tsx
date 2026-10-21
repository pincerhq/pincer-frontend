/**
 * Documents — the storage root Pincer serves at /api/storage (a local
 * directory or a bucket), browsed folder by folder. REAL: every call goes to
 * the Pincer API; the browser never holds storage credentials.
 *
 * The folder is in the URL (`?prefix=`), so a folder can be linked and the
 * back button walks back up. A folder arrives a page at a time; scrolling
 * near the end of the list loads the next page. Clicking a file opens it in StorageFileDialog
 * (preview, and editing for text). Changing anything needs `add_knowledge`.
 * Files and whole folders upload by picker or drag and drop (useUploadQueue).
 *
 * The skills directory is protected when it lives under the root: it, its
 * contents and the folders above it show a lock, and cannot be deleted or
 * moved. The server enforces the same rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FileText, FolderPlus, FolderUp, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import {
  parentOf,
  presign,
  storageKeys,
  useStorageInfo,
  useStorageList,
  type StorageFile,
} from '@/lib/api/storage';
import { isConnected } from '@/lib/pincerClient';
import { useCan } from '@/stores/session';
import DocumentsTable, { type DocumentRow } from '@/pages/company/_components/DocumentsTable';
import {
  DeleteDialog,
  MoveDialog,
  NewFolderDialog,
  ReplaceDialog,
} from '@/pages/company/_components/DocumentsDialogs';
import StorageFileDialog from '@/pages/company/_components/StorageFileDialog';
import { useDocumentsT } from '@/pages/company/_lib/i18n';
import { errorText } from '@/pages/company/_lib/storageFiles';
import { droppedItems, pickedItems } from '@/pages/company/_lib/uploadItems';
import { useUploadQueue } from '@/pages/company/_lib/useUploadQueue';
import { cn } from '@/lib/utils';

/** Load the next page once the list is scrolled this close (px) to its end. */
const LOAD_MORE_THRESHOLD_PX = 240;

/** A clean folder key ("" for the root); slashes at either end are dropped. */
function normalizePrefix(raw: string | null): string {
  return (raw ?? '').replace(/^\/+|\/+$/g, '');
}

export default function BrainDocumentsView() {
  const t = useDocumentsT();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const prefix = normalizePrefix(params.get('prefix'));
  const canWrite = useCan('add_knowledge');
  const connected = isConnected();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const [dragging, setDragging] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [moving, setMoving] = useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const [opened, setOpened] = useState<StorageFile | null>(null);

  const info = useStorageInfo();
  const listing = useStorageList(prefix);
  const uploads = useUploadQueue(prefix, info.data?.max_upload_bytes);
  const { progress } = uploads;

  const pages = listing.data?.pages;
  const rows = useMemo<DocumentRow[]>(
    () =>
      (pages ?? []).flatMap((page) => [
        ...page.folders.map<DocumentRow>((f) => ({ kind: 'folder', ...f })),
        ...page.files.map<DocumentRow>((f) => ({ kind: 'file', ...f })),
      ]),
    [pages],
  );
  const truncated = pages?.[pages.length - 1]?.truncated ?? false;

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = listing;
  /** Fetch the next page when the list is scrolled near its end, or does not fill the view yet. */
  const loadMoreIfNearEnd = useCallback(() => {
    const el = scroller.current;
    // After a failed page, only the retry button asks again: scrolling would hammer a broken server.
    if (!el || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_THRESHOLD_PX) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  // A page that leaves no room to scroll would otherwise never get a scroll event.
  useEffect(() => {
    loadMoreIfNearEnd();
  }, [pages, loadMoreIfNearEnd]);

  const openFolder = (key: string) => setParams(key ? { prefix: key } : {});
  const refresh = () => queryClient.invalidateQueries({ queryKey: storageKeys.listAll });

  const download = async (row: DocumentRow) => {
    try {
      const { url } = await presign(row.key, 'attachment');
      window.location.assign(url);
    } catch (err) {
      toast({ title: t('toast.downloadFailed', { name: row.name }), description: errorText(err), variant: 'destructive' });
    }
  };

  // ── drag and drop ──────────────────────────────────────────────────

  const onDragOver = (e: DragEvent) => {
    if (!canWrite || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    // While an upload runs, the overlay does not invite a drop that would be refused.
    setDragging(!progress);
  };
  const onDragLeave = (e: DragEvent) => {
    // Moving between children fires leave on the one left; only leaving the view ends the drag.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!canWrite) return;
    e.preventDefault();
    setDragging(false);
    droppedItems(e.dataTransfer).then(
      (items) => uploads.upload(items),
      (err) => toast({ title: t('toast.dropFailed'), description: errorText(err), variant: 'destructive' }),
    );
  };

  // ── view ───────────────────────────────────────────────────────────

  const crumbs = prefix
    .split('/')
    .filter(Boolean)
    .map((segment, i, all) => ({ label: segment, key: all.slice(0, i + 1).join('/') }));

  const percent = progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
  const here = prefix || t('title');
  const crumbClass = (current: boolean) =>
    cn(
      'rounded-[6px] px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25',
      current ? 'font-semibold text-[var(--ink)]' : 'text-[var(--text-3)]',
    );

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] px-6 pb-5 pt-5">
        <div>
          <p className="plat-crumb mb-1.5 text-[12px] text-[var(--text-4)]">{t('eyebrow')}</p>
          <h1 className="text-[26px] leading-tight text-[var(--ink)]">{t('title')}</h1>
          {info.data && (
            <p className="mt-1 truncate font-mono text-[12px] text-[var(--text-4)]" data-testid="storage-root">
              {info.data.root}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                data-testid="documents-file-input"
                onChange={(e) => {
                  const items = pickedItems(e.target.files ?? []);
                  e.target.value = '';
                  void uploads.upload(items);
                }}
              />
              <input
                // A folder picker; `webkitdirectory` is not in React's input attributes.
                ref={(el) => {
                  folderInput.current = el;
                  el?.setAttribute('webkitdirectory', '');
                }}
                type="file"
                hidden
                data-testid="documents-folder-input"
                onChange={(e) => {
                  const items = pickedItems(e.target.files ?? []);
                  e.target.value = '';
                  void uploads.upload(items);
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={!connected || progress !== null}
                className="plat-btn h-9 px-4 disabled:cursor-not-allowed"
              >
                {progress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {t('actions.upload')}
              </button>
              <button
                type="button"
                onClick={() => folderInput.current?.click()}
                disabled={!connected || progress !== null}
                className="plat-btn-ghost h-9 px-3 disabled:cursor-not-allowed"
              >
                <FolderUp className="h-3.5 w-3.5" />
                {t('actions.uploadFolder')}
              </button>
              <button
                type="button"
                onClick={() => setNewFolderOpen(true)}
                disabled={!connected}
                className="plat-btn-ghost h-9 px-3 disabled:cursor-not-allowed"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t('actions.newFolder')}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!connected || listing.isFetching}
            aria-label={t('actions.refresh')}
            className="plat-btn-ghost h-9 px-3 disabled:cursor-not-allowed"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', listing.isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      <nav aria-label={t('breadcrumbs')} className="flex flex-wrap items-center gap-1 px-6 pt-4 text-[13px]">
        <button
          type="button"
          onClick={() => openFolder('')}
          aria-current={crumbs.length === 0 ? 'page' : undefined}
          className={crumbClass(crumbs.length === 0)}
        >
          {t('title')}
        </button>
        {crumbs.map((crumb, i) => (
          <span key={crumb.key} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-[var(--text-5)]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => openFolder(crumb.key)}
              aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              className={crumbClass(i === crumbs.length - 1)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      {progress && (
        <div className="mx-6 mt-3 rounded-[12px] border border-[var(--line-soft)] bg-[color:var(--paper)] px-4 py-2.5" role="status">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-2)]">
            <span className="truncate">
              {progress.count > 1
                ? t('upload.progressMany', { name: progress.name, index: progress.index + 1, count: progress.count })
                : t('upload.progress', { name: progress.name })}
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{percent}%</span>
              <button
                type="button"
                onClick={uploads.cancel}
                aria-label={t('actions.cancelUpload')}
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-3)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--sand)]">
            <div className="h-full bg-[var(--ink)] transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      <div
        ref={scroller}
        onScroll={loadMoreIfNearEnd}
        className="flex-1 overflow-y-auto p-6"
        data-testid="documents-scroller"
      >
        {!connected ? (
          <EmptyState icon={FileText} title={t('empty.notConnected')} description={t('empty.notConnectedBody')} />
        ) : listing.isPending ? (
          <div className="flex items-center justify-center py-16 text-sm text-[var(--text-4)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : !listing.data ? (
          // Only when nothing loaded: a failed next page keeps the rows already shown (below).
          <EmptyState
            icon={FileText}
            title={t('empty.loadFailed')}
            description={errorText(listing.error)}
            action={
              <button type="button" onClick={() => void listing.refetch()} className="plat-btn h-9 px-4">
                {t('actions.retry')}
              </button>
            }
          />
        ) : (
          <>
            <DocumentsTable
              rows={rows}
              canWrite={canWrite}
              onOpenFolder={openFolder}
              onOpenFile={setOpened}
              onDownload={(row) => void download(row)}
              onMove={setMoving}
              onDelete={setDeleting}
              emptyState={
                <EmptyState
                  icon={FileText}
                  title={prefix ? t('empty.folder') : t('empty.root')}
                  description={canWrite ? t('empty.uploadHint') : t('empty.readOnly')}
                />
              }
            />
            {isFetchingNextPage && (
              <div className="flex items-center justify-center py-4 text-sm text-[var(--text-4)]" role="status">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadingMore')}
              </div>
            )}
            {isFetchNextPageError && !isFetchingNextPage && (
              <div className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm text-[var(--text-3)]" role="alert">
                <span>
                  {t('loadMoreFailed')} {errorText(listing.error)}
                </span>
                <button type="button" onClick={() => void fetchNextPage()} className="plat-btn-ghost h-8 px-3 text-xs">
                  {t('actions.retry')}
                </button>
              </div>
            )}
            {truncated && !hasNextPage && (
              <p className="mt-4 text-center text-xs text-[var(--text-4)]">{t('truncated')}</p>
            )}
          </>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[16px] border-2 border-dashed border-[var(--ink)]/40 bg-[color-mix(in_srgb,var(--paper)_80%,transparent)]">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
            <Upload className="h-4 w-4" /> {t('upload.drop', { folder: here })}
          </p>
        </div>
      )}

      <StorageFileDialog file={opened} onClose={() => setOpened(null)} canWrite={canWrite} />
      <NewFolderDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} prefix={prefix} here={here} />
      <MoveDialog
        row={moving}
        onClose={() => setMoving(null)}
        protectedPrefixes={info.data?.protected}
        onMoved={(from) => {
          // A folder moved away from under the current view: follow it up.
          if (prefix === from.key || prefix.startsWith(`${from.key}/`)) openFolder(parentOf(from.key));
        }}
      />
      <DeleteDialog row={deleting} onClose={() => setDeleting(null)} />
      <ReplaceDialog conflicts={uploads.conflicts} onKeep={uploads.keep} onReplace={uploads.replace} />
    </div>
  );
}
