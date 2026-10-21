/**
 * Documents → the rows of one folder: folders first, then files, by name. A
 * row's menu opens, downloads, and (with write access) moves or deletes it;
 * protected rows show a lock and cannot be moved or deleted.
 */
import type { ReactNode } from 'react';
import { Download, Eye, File as FileIcon, Folder, Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StorageFile } from '@/lib/api/storage';
import { useDocumentsT } from '@/pages/company/_lib/i18n';
import { formatSize } from '@/pages/company/_lib/storageFiles';
import { cn } from '@/lib/utils';

export type DocumentRow =
  | { kind: 'folder'; key: string; name: string; protected: boolean }
  | ({ kind: 'file' } & StorageFile);

const byName = (a: DocumentRow, b: DocumentRow) =>
  a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true });

interface DocumentsTableProps {
  rows: DocumentRow[];
  canWrite: boolean;
  emptyState: ReactNode;
  onOpenFolder: (key: string) => void;
  onOpenFile: (file: StorageFile) => void;
  onDownload: (row: DocumentRow) => void;
  onMove: (row: DocumentRow) => void;
  onDelete: (row: DocumentRow) => void;
}

export default function DocumentsTable({
  rows,
  canWrite,
  emptyState,
  onOpenFolder,
  onOpenFile,
  onDownload,
  onMove,
  onDelete,
}: DocumentsTableProps) {
  const t = useDocumentsT();

  const lock = (row: DocumentRow) =>
    row.protected ? (
      <Lock
        className="h-3.5 w-3.5 shrink-0 text-[var(--text-4)]"
        aria-label={t('protected')}
        data-testid={`protected-${row.key}`}
      />
    ) : null;

  const columns: DataTableColumn<DocumentRow>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      primary: true,
      sort: byName,
      cell: (row) => (
        <button
          type="button"
          onClick={() => (row.kind === 'folder' ? onOpenFolder(row.key) : onOpenFile(row))}
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
              className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--text-3)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]/25"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.kind === 'folder' ? (
              <DropdownMenuItem onSelect={() => onOpenFolder(row.key)}>
                <Folder className="mr-2 h-4 w-4" /> {t('actions.open')}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => onOpenFile(row)}>
                  <Eye className="mr-2 h-4 w-4" /> {t('actions.open')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDownload(row)}>
                  <Download className="mr-2 h-4 w-4" /> {t('actions.download')}
                </DropdownMenuItem>
              </>
            )}
            {canWrite && (
              <>
                <DropdownMenuItem disabled={row.protected} onSelect={() => onMove(row)}>
                  <Pencil className="mr-2 h-4 w-4" /> {t('actions.move')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={row.protected}
                  onSelect={() => onDelete(row)}
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

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => `${row.kind}:${row.key}`}
      labels={{ empty: t('empty.folder'), sortBy: (column) => t('sortBy', { column }) }}
      emptyState={emptyState}
    />
  );
}
