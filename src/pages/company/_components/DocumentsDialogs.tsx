/**
 * Documents → the dialogs of the folder view: new folder, rename / move,
 * delete, and the replace prompt for uploads that already exist. Each one
 * owns its form state and its call, and reports through toasts.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { isProtectedKey, useDelete, useMkdir, useMove } from '@/lib/api/storage';
import type { DocumentRow } from '@/pages/company/_components/DocumentsTable';
import { useDocumentsT } from '@/pages/company/_lib/i18n';
import { errorText } from '@/pages/company/_lib/storageFiles';
import type { UploadConflicts } from '@/pages/company/_lib/useUploadQueue';

const DIALOG = 'plat rounded-[14px] border-[var(--line)]';

/** A key typed by hand: slashes at either end are dropped. */
const cleanKey = (raw: string) => raw.trim().replace(/^\/+|\/+$/g, '');

const join = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);

export function NewFolderDialog({
  open,
  onOpenChange,
  prefix,
  here,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefix: string;
  /** The open folder's name, for the description. */
  here: string;
}) {
  const t = useDocumentsT();
  const { toast } = useToast();
  const mkdir = useMkdir();
  const [name, setName] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const folder = cleanKey(name);
    if (!folder) return;
    mkdir.mutate(join(prefix, folder), {
      onSuccess: () => {
        toast({ title: t('toast.folderCreated', { name: folder }) });
        onOpenChange(false);
        setName('');
      },
      onError: (err) => toast({ title: t('toast.folderFailed'), description: errorText(err), variant: 'destructive' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !mkdir.isPending && onOpenChange(next)}>
      <DialogContent className={DIALOG}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t('newFolder.title')}</DialogTitle>
            <DialogDescription>{t('newFolder.in', { folder: here })}</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-1.5">
            <Label htmlFor="documents-folder-name">{t('newFolder.name')}</Label>
            <Input id="documents-folder-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <button type="button" onClick={() => onOpenChange(false)} className="plat-btn-ghost h-9 justify-center px-4">
              {t('actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || mkdir.isPending}
              className="plat-btn h-9 justify-center px-4 disabled:cursor-not-allowed"
            >
              {mkdir.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('newFolder.create')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({
  row,
  onClose,
  protectedPrefixes,
  onMoved,
}: {
  row: DocumentRow | null;
  onClose: () => void;
  /** The server refuses a move into these (403); known, the dialog says so without the round trip. */
  protectedPrefixes: readonly string[] | undefined;
  onMoved: (from: DocumentRow) => void;
}) {
  const t = useDocumentsT();
  const { toast } = useToast();
  const move = useMove();
  const [target, setTarget] = useState('');

  const rowKey = row?.key;
  useEffect(() => {
    if (rowKey !== undefined) setTarget(rowKey);
  }, [rowKey]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!row) return;
    const to = cleanKey(target);
    if (!to || to === row.key) return;
    if (protectedPrefixes && isProtectedKey(to, protectedPrefixes)) {
      toast({ title: t('toast.moveFailed'), description: t('toast.moveProtected', { to }), variant: 'destructive' });
      return;
    }
    move.mutate(
      { from: row.key, to },
      {
        onSuccess: () => {
          toast({ title: t('toast.moved', { to }) });
          onClose();
          onMoved(row);
        },
        // The server names the problem: the target exists or holds the source (409), a protected key (403).
        onError: (err) => toast({ title: t('toast.moveFailed'), description: errorText(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && !move.isPending && onClose()}>
      <DialogContent className={DIALOG}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t('move.title')}</DialogTitle>
            <DialogDescription>{row?.kind === 'folder' ? t('move.folderHint') : t('move.fileHint')}</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-1.5">
            <Label htmlFor="documents-move-target">{t('move.path')}</Label>
            <Input id="documents-move-target" value={target} onChange={(e) => setTarget(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <button type="button" onClick={onClose} className="plat-btn-ghost h-9 justify-center px-4">
              {t('actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={!target.trim() || move.isPending}
              className="plat-btn h-9 justify-center px-4 disabled:cursor-not-allowed"
            >
              {move.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('move.save')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({ row, onClose }: { row: DocumentRow | null; onClose: () => void }) {
  const t = useDocumentsT();
  const { toast } = useToast();
  const remove = useDelete();

  const confirm = () => {
    if (!row) return;
    remove.mutate(
      { key: row.key, folder: row.kind === 'folder' },
      {
        onSuccess: () => {
          toast({ title: t('toast.deleted', { name: row.name }) });
          onClose();
        },
        onError: (err) => toast({ title: t('toast.deleteFailed'), description: errorText(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <AlertDialog open={row !== null} onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogContent className={DIALOG}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('delete.title', { name: row?.name ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>
            {row?.kind === 'folder' ? t('delete.folderBody') : t('delete.fileBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="plat-btn-ghost !h-9 justify-center">{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="plat-btn !h-9 !px-4 justify-center"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {remove.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('actions.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ReplaceDialog({
  conflicts,
  onKeep,
  onReplace,
}: {
  conflicts: UploadConflicts | null;
  onKeep: () => void;
  onReplace: () => void;
}) {
  const t = useDocumentsT();
  const items = conflicts?.items ?? [];
  return (
    <AlertDialog open={items.length > 0} onOpenChange={(open) => !open && onKeep()}>
      <AlertDialogContent className={DIALOG}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {items.length === 1
              ? t('replace.titleOne', { name: items[0].path })
              : t('replace.titleMany', { count: items.length })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('replace.body', { count: items.length })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="plat-btn-ghost !h-9 justify-center">{t('replace.keep')}</AlertDialogCancel>
          <AlertDialogAction className="plat-btn !h-9 !px-4 justify-center" onClick={onReplace}>
            {t('replace.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
