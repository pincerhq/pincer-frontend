/**
 * Documents — the storage root Pincer serves at /api/storage (a local
 * directory or a bucket), browsed folder by folder. REAL: every call goes to
 * the Pincer API; the browser never holds storage credentials.
 *
 * The folder is in the URL (`?prefix=`), so a folder can be linked and the
 * back button walks back up. A folder arrives a page at a time; scrolling
 * near the end of the list loads the next page. Clicking a file opens it in StorageFileDialog
 * (preview, and editing for text). Changing anything needs `add_knowledge`.
 *
 * The skills directory is protected when it lives under the root: it, its
 * contents and the folders above it show a lock, and cannot be deleted or
 * moved. The server enforces the same rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronRight,
  Download,
  Eye,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api/client';
import {
  isProtectedKey,
  parentOf,
  presign,
  uploadFile,
  useDelete,
  useMkdir,
  useMove,
  useStorageInfo,
  useStorageList,
  type StorageFile,
} from '@/lib/api/storage';
import { isConnected } from '@/lib/pincerClient';
import { useCan } from '@/stores/session';
import { useQueryClient } from '@tanstack/react-query';
import { brainQueryKeys } from '@/pages/company/_lib/brainKeys';
import { useDocumentsT } from '@/pages/company/_lib/i18n';
import StorageFileDialog from '@/pages/company/_components/StorageFileDialog';
import { formatSize } from '@/pages/company/_lib/storageFiles';
import { cn } from '@/lib/utils';

type Row =
  | { kind: 'folder'; key: string; name: string; protected: boolean }
  | ({ kind: 'file' } & StorageFile);

/** A clean folder key ("" for the root); slashes at either end are dropped. */
function normalizePrefix(raw: string | null): string {
  return (raw ?? '').replace(/^\/+|\/+$/g, '');
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const byName = (a: Row, b: Row) =>
  a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true });

const join = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);

/** Load the next page once the list is scrolled this close (px) to its end. */
const LOAD_MORE_THRESHOLD_PX = 240;

interface UploadProgress {
  name: string;
  index: number;
  count: number;
  loaded: number;
  total: number;
}

export default function BrainDocumentsView() {
  const t = useDocumentsT();
  const [params, setParams] = useSearchParams();
  const prefix = normalizePrefix(params.get('prefix'));
  const canWrite = useCan('add_knowledge');
  const connected = isConnected();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [conflicts, setConflicts] = useState<File[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [moving, setMoving] = useState<Row | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [opened, setOpened] = useState<StorageFile | null>(null);

  const info = useStorageInfo();
  const listing = useStorageList(prefix);
  const mkdir = useMkdir();
  const move = useMove();
  const remove = useDelete();

  const pages = listing.data?.pages;
  const rows = useMemo<Row[]>(
    () =>
      (pages ?? []).flatMap((page) => [
        ...page.folders.map<Row>((f) => ({ kind: 'folder', ...f })),
        ...page.files.map<Row>((f) => ({ kind: 'file', ...f })),
      ]),
    [pages],
  );
  const truncated = pages?.[pages.length - 1]?.truncated ?? false;

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = listing;
  /** Fetch the next page when the list is scrolled near its end, or does not fill the view yet. */
  const loadMoreIfNearEnd = useCallback(() => {
    const el = scroller.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_THRESHOLD_PX) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // A page that leaves no room to scroll would otherwise never get a scroll event.
  useEffect(() => {
    loadMoreIfNearEnd();
  }, [pages, loadMoreIfNearEnd]);

  const openFolder = (key: string) => setParams(key ? { prefix: key } : {});
  const refresh = () => queryClient.invalidateQueries({ queryKey: brainQueryKeys.documentsAll });

  // ── actions ────────────────────────────────────────────────────────

  const upload = async (picked: File[], overwrite = false) => {
    if (!canWrite || picked.length === 0 || progress) return;
    // The server refuses these with a 413 anyway; say so before sending megabytes.
    const maxBytes = info.data?.max_upload_bytes;
    const files = maxBytes ? picked.filter((f) => f.size <= maxBytes) : picked;
    for (const file of picked) {
      if (!files.includes(file)) {
        toast.error(t('toast.tooLarge', { name: file.name, max: formatSize(maxBytes) }));
      }
    }
    if (files.length === 0) return;
    const clashes: File[] = [];
    let done = 0;
    try {
      for (const [index, file] of files.entries()) {
        setProgress({ name: file.name, index, count: files.length, loaded: 0, total: file.size });
        try {
          await uploadFile(prefix, file, {
            overwrite,
            onProgress: (loaded, total) => setProgress((p) => (p ? { ...p, loaded, total } : p)),
          });
          done += 1;
        } catch (err) {
          // A first 409 asks to replace. One on the replace itself is not a clash a
          // retry resolves (a file stands where a folder is needed, or the other way round).
          if (err instanceof ApiError && err.status === 409 && !overwrite) clashes.push(file);
          else if (err instanceof ApiError && err.status === 409) {
            toast.error(t('toast.uploadFolderConflict', { name: file.name }), { description: errorText(err) });
          } else toast.error(t('toast.uploadFailed', { name: file.name }), { description: errorText(err) });
        }
      }
    } finally {
      setProgress(null);
      if (done > 0) {
        toast.success(t('toast.uploaded', { count: done }));
        void refresh();
      }
      setConflicts(clashes);
    }
  };

  const download = async (row: Row) => {
    try {
      const { url } = await presign(row.key, 'attachment');
      window.location.assign(url);
    } catch (err) {
      toast.error(t('toast.downloadFailed', { name: row.name }), { description: errorText(err) });
    }
  };

  const submitFolder = (e: FormEvent) => {
    e.preventDefault();
    const name = folderName.trim().replace(/^\/+|\/+$/g, '');
    if (!name) return;
    mkdir.mutate(join(prefix, name), {
      onSuccess: () => {
        toast.success(t('toast.folderCreated', { name }));
        setNewFolderOpen(false);
        setFolderName('');
      },
      onError: (err) => toast.error(t('toast.folderFailed'), { description: errorText(err) }),
    });
  };

  const startMove = (row: Row) => {
    setMoving(row);
    setMoveTarget(row.key);
  };

  const submitMove = (e: FormEvent) => {
    e.preventDefault();
    if (!moving) return;
    const target = moveTarget.trim().replace(/^\/+|\/+$/g, '');
    if (!target || target === moving.key) return;
    // The server refuses it (403); say so without the round trip.
    if (info.data && isProtectedKey(target, info.data.protected)) {
      toast.error(t('toast.moveFailed'), { description: t('toast.moveProtected', { to: target }) });
      return;
    }
    move.mutate(
      { from: moving.key, to: target },
      {
        onSuccess: () => {
          toast.success(t('toast.moved', { to: target }));
          setMoving(null);
          // A folder moved away from under the current view: follow it up.
          if (prefix === moving.key || prefix.startsWith(`${moving.key}/`)) openFolder(parentOf(moving.key));
        },
        // The server names the problem: the target exists or holds the source (409), a protected key (403).
        onError: (err) => toast.error(t('toast.moveFailed'), { description: errorText(err) }),
      },
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const row = deleting;
    remove.mutate(
      { key: row.key, folder: row.kind === 'folder' },
      {
        onSuccess: () => {
          toast.success(t('toast.deleted', { name: row.name }));
          setDeleting(null);
        },
        onError: (err) => toast.error(t('toast.deleteFailed'), { description: errorText(err) }),
      },
    );
  };

  // ── drag and drop ──────────────────────────────────────────────────

  const onDragOver = (e: DragEvent) => {
    if (!canWrite || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDrop = (e: DragEvent) => {
    if (!canWrite) return;
    e.preventDefault();
    setDragging(false);
    void upload(Array.from(e.dataTransfer.files));
  };

  // ── table ──────────────────────────────────────────────────────────

  const lock = (row: Row) =>
    row.protected ? (
      <Lock
        className="h-3.5 w-3.5 shrink-0 text-[var(--text-4)]"
        aria-label={t('protected')}
        data-testid={`protected-${row.key}`}
      />
    ) : null;

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      primary: true,
      sort: byName,
      cell: (row) => (
        <button
          type="button"
          onClick={() => (row.kind === 'folder' ? openFolder(row.key) : setOpened(row))}
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-[6px] text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25',
            row.kind === 'folder' ? 'font-medium text-[var(--ink)]' : 'text-[var(--text-1)]',
          )}
        >
          {row.kind === 'folder' ? (
            <Folder className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
          ) : (
            <FileIcon className="h-4 w-4 shrink-0 text-[var(--text-4)]" aria-hidden="true" />
          )}
          <span className="truncate">{row.name}</span>
          {lock(row)}
        </button>
      ),
    },
    {
      key: 'size',
      header: t('columns.size'),
      align: 'right',
      className: 'w-28',
      sort: (a, b) => (a.kind === 'file' ? (a.size ?? 0) : -1) - (b.kind === 'file' ? (b.size ?? 0) : -1),
      cell: (row) => (row.kind === 'file' ? formatSize(row.size) : '—'),
    },
    {
      key: 'modified',
      header: t('columns.modified'),
      className: 'w-48',
      sort: (a, b) =>
        (a.kind === 'file' && a.last_modified ? Date.parse(a.last_modified) : 0) -
        (b.kind === 'file' && b.last_modified ? Date.parse(b.last_modified) : 0),
      cell: (row) =>
        row.kind === 'file' && row.last_modified ? new Date(row.last_modified).toLocaleString() : '—',
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('actions.menu', { name: row.name })}
              className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--text-3)] hover:bg-[rgba(20,22,26,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.kind === 'folder' ? (
              <DropdownMenuItem onSelect={() => openFolder(row.key)}>
                <Folder className="mr-2 h-4 w-4" /> {t('actions.open')}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => setOpened(row)}>
                  <Eye className="mr-2 h-4 w-4" /> {t('actions.open')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void download(row)}>
                  <Download className="mr-2 h-4 w-4" /> {t('actions.download')}
                </DropdownMenuItem>
              </>
            )}
            {canWrite && (
              <>
                <DropdownMenuItem disabled={row.protected} onSelect={() => startMove(row)}>
                  <Pencil className="mr-2 h-4 w-4" /> {t('actions.move')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={row.protected}
                  onSelect={() => setDeleting(row)}
                  className="text-red-600 focus:text-red-700"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> {t('actions.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const crumbs = prefix
    .split('/')
    .filter(Boolean)
    .map((segment, i, all) => ({ label: segment, key: all.slice(0, i + 1).join('/') }));

  const percent = progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
  const here = prefix || t('title');

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
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
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  void upload(files);
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
          className={cn(
            'rounded-[6px] px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25',
            crumbs.length === 0 ? 'font-semibold text-[var(--ink)]' : 'text-[var(--text-3)]',
          )}
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
              className={cn(
                'rounded-[6px] px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25',
                i === crumbs.length - 1 ? 'font-semibold text-[var(--ink)]' : 'text-[var(--text-3)]',
              )}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      {progress && (
        <div className="mx-6 mt-3 rounded-[12px] border border-[var(--line-soft)] bg-white px-4 py-2.5" role="status">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-2)]">
            <span className="truncate">
              {progress.count > 1
                ? t('upload.progressMany', { name: progress.name, index: progress.index + 1, count: progress.count })
                : t('upload.progress', { name: progress.name })}
            </span>
            <span className="tabular-nums">{percent}%</span>
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
        ) : listing.isError ? (
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
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(row) => `${row.kind}:${row.key}`}
              labels={{ empty: t('empty.folder'), sortBy: (column) => t('sortBy', { column }) }}
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
            {truncated && !hasNextPage && (
              <p className="mt-4 text-center text-xs text-[var(--text-4)]">{t('truncated')}</p>
            )}
          </>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[16px] border-2 border-dashed border-[var(--ink)]/40 bg-white/80">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
            <Upload className="h-4 w-4" /> {t('upload.drop', { folder: here })}
          </p>
        </div>
      )}

      <StorageFileDialog file={opened} onClose={() => setOpened(null)} canWrite={canWrite} />

      {/* New folder */}
      <Dialog open={newFolderOpen} onOpenChange={(open) => !mkdir.isPending && setNewFolderOpen(open)}>
        <DialogContent className="plat rounded-[14px] border-[var(--line)]">
          <form onSubmit={submitFolder}>
            <DialogHeader>
              <DialogTitle>{t('newFolder.title')}</DialogTitle>
              <DialogDescription>{t('newFolder.in', { folder: here })}</DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-1.5">
              <Label htmlFor="documents-folder-name">{t('newFolder.name')}</Label>
              <Input
                id="documents-folder-name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setNewFolderOpen(false)} className="plat-btn-ghost h-9 justify-center px-4">
                {t('actions.cancel')}
              </button>
              <button
                type="submit"
                disabled={!folderName.trim() || mkdir.isPending}
                className="plat-btn h-9 justify-center px-4 disabled:cursor-not-allowed"
              >
                {mkdir.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('newFolder.create')}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename / move */}
      <Dialog open={moving !== null} onOpenChange={(open) => !open && !move.isPending && setMoving(null)}>
        <DialogContent className="plat rounded-[14px] border-[var(--line)]">
          <form onSubmit={submitMove}>
            <DialogHeader>
              <DialogTitle>{t('move.title')}</DialogTitle>
              <DialogDescription>
                {moving?.kind === 'folder' ? t('move.folderHint') : t('move.fileHint')}
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-1.5">
              <Label htmlFor="documents-move-target">{t('move.path')}</Label>
              <Input
                id="documents-move-target"
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setMoving(null)} className="plat-btn-ghost h-9 justify-center px-4">
                {t('actions.cancel')}
              </button>
              <button
                type="submit"
                disabled={!moveTarget.trim() || move.isPending}
                className="plat-btn h-9 justify-center px-4 disabled:cursor-not-allowed"
              >
                {move.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('move.save')}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}>
        <AlertDialogContent className="plat rounded-[14px] border-[var(--line)]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.title', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.kind === 'folder' ? t('delete.folderBody') : t('delete.fileBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="plat-btn-ghost !h-9 justify-center">{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="plat-btn !h-9 !px-4 justify-center"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {remove.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replace on conflict */}
      <AlertDialog open={conflicts.length > 0} onOpenChange={(open) => !open && setConflicts([])}>
        <AlertDialogContent className="plat rounded-[14px] border-[var(--line)]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {conflicts.length === 1
                ? t('replace.titleOne', { name: conflicts[0].name })
                : t('replace.titleMany', { count: conflicts.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('replace.body', { count: conflicts.length })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="plat-btn-ghost !h-9 justify-center">{t('replace.keep')}</AlertDialogCancel>
            <AlertDialogAction
              className="plat-btn !h-9 !px-4 justify-center"
              onClick={() => {
                const files = conflicts;
                setConflicts([]);
                void upload(files, true);
              }}
            >
              {t('replace.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
