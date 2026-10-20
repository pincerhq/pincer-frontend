/**
 * Documents → one file, in a modal: preview, and for text files an editor.
 *
 *   Image     <img> from a presigned inline link (it lives the server's
 *             presign_ttl; a reopened dialog gets a fresh one once the
 *             cached link is close to its expires_at)
 *   Text      loaded through GET /api/storage/text — editing needs its etag,
 *             and a fetch of a presigned URL would need CORS on the bucket.
 *             Read-only until Edit; Save sends the etag, so a file changed on
 *             the server in between is a 409 the user resolves (reload or
 *             overwrite), never a silent overwrite.
 *   Markdown  text, plus a Preview toggle (off by default) that renders it —
 *             side by side with the editor while editing. Raw HTML is not rendered.
 *   Other     metadata, Download and Open in new tab.
 */
import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { AlertTriangle, Download, ExternalLink, Eye, Loader2, Lock, Pencil } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import { presign, usePresignedUrl, useSaveText, useTextFile, type StorageFile } from '@/lib/api/storage';
import { useDocumentsT } from '@/pages/company/_lib/i18n';
import { fileKind, formatSize } from '@/pages/company/_lib/storageFiles';
import { cn } from '@/lib/utils';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function Markdown({ source }: { source: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words" data-testid="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}

interface StorageFileDialogProps {
  file: StorageFile | null;
  onClose: () => void;
  canWrite: boolean;
}

export default function StorageFileDialog({ file, onClose, canWrite }: StorageFileDialogProps) {
  const t = useDocumentsT();
  const open = file !== null;
  const kind = file ? fileKind(file) : 'other';
  const isText = kind === 'text' || kind === 'markdown';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState(false);
  const [conflict, setConflict] = useState(false);
  // What asked to drop the unsaved edits: closing the dialog, or Cancel in the editor.
  const [confirmDiscard, setConfirmDiscard] = useState<'close' | 'cancel' | null>(null);

  // A different file starts from scratch: read-only, preview off.
  const fileKey = file?.key ?? null;
  useEffect(() => {
    setEditing(false);
    setDraft('');
    setPreview(false);
    setConflict(false);
    setConfirmDiscard(null);
  }, [fileKey]);

  const text = useTextFile(open && isText ? fileKey : null);
  const image = usePresignedUrl(fileKey, 'inline', open && kind === 'image');
  const inlineLink = usePresignedUrl(fileKey, 'inline', open && kind === 'other');
  const save = useSaveText();

  const dirty = editing && text.data !== undefined && draft !== text.data.content;

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  if (!file) return null;

  const requestClose = () => {
    if (dirty) setConfirmDiscard('close');
    else onClose();
  };

  const startEdit = () => {
    if (!text.data) return;
    setDraft(text.data.content);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (dirty) setConfirmDiscard('cancel');
    else setEditing(false);
  };

  const discard = () => {
    const reason = confirmDiscard;
    setConfirmDiscard(null);
    setEditing(false);
    setDraft('');
    if (reason === 'close') onClose();
  };

  const doSave = (overwrite = false) => {
    if (!text.data) return;
    save.mutate(
      { key: file.key, content: draft, etag: overwrite ? null : text.data.etag },
      {
        onSuccess: () => {
          setConflict(false);
          setEditing(false);
          toast.success(t('dialog.saved', { name: file.name }));
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setConflict(true);
          else toast.error(t('dialog.saveFailed'), { description: errorText(err) });
        },
      },
    );
  };

  const reload = async () => {
    setConflict(false);
    const fresh = await text.refetch();
    if (fresh.data) setDraft(fresh.data.content);
  };

  const download = async () => {
    try {
      const { url } = await presign(file.key, 'attachment');
      window.location.assign(url);
    } catch (err) {
      toast.error(t('toast.downloadFailed', { name: file.name }), { description: errorText(err) });
    }
  };

  const meta = [formatSize(file.size), file.last_modified ? new Date(file.last_modified).toLocaleString() : null]
    .filter(Boolean)
    .join(' · ');

  const showPreviewToggle = kind === 'markdown' && text.data !== undefined;
  const editorPane = (
    <Textarea
      aria-label={t('dialog.editorLabel')}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      spellCheck={false}
      className="h-[60vh] min-h-[240px] resize-none font-mono text-[13px] leading-relaxed"
    />
  );

  let body: ReactNode;
  if (kind === 'image') {
    body = image.isError ? (
      <p className="text-sm text-red-600">{errorText(image.error)}</p>
    ) : image.data ? (
      <div className="flex max-h-[65vh] items-center justify-center overflow-auto rounded-[10px] bg-[var(--sand)] p-2">
        <img src={image.data.url} alt={file.name} className="max-h-[62vh] max-w-full object-contain" />
      </div>
    ) : (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--text-4)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('dialog.loading')}
      </div>
    );
  } else if (isText) {
    if (text.isPending) {
      body = (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--text-4)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('dialog.loading')}
        </div>
      );
    } else if (text.isError) {
      body = <p className="text-sm text-red-600">{errorText(text.error)}</p>;
    } else if (editing) {
      body =
        kind === 'markdown' && preview ? (
          <div className="grid gap-3 md:grid-cols-2">
            {editorPane}
            <div className="h-[60vh] min-h-[240px] overflow-auto rounded-[10px] border border-[var(--line-soft)] p-4">
              <Markdown source={draft} />
            </div>
          </div>
        ) : (
          editorPane
        );
    } else {
      body =
        kind === 'markdown' && preview ? (
          <div className="max-h-[65vh] overflow-auto rounded-[10px] border border-[var(--line-soft)] p-4">
            <Markdown source={text.data.content} />
          </div>
        ) : (
          <pre
            data-testid="text-content"
            className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[var(--sand)] p-4 font-mono text-[13px] leading-relaxed text-[var(--text-1)]"
          >
            {text.data.content}
          </pre>
        );
    }
  } else {
    body = (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-[var(--text-3)]">{t('dialog.noPreview')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => void download()} className="plat-btn h-9 px-4">
            <Download className="h-3.5 w-3.5" /> {t('actions.download')}
          </button>
          {inlineLink.data && (
            <a href={inlineLink.data.url} target="_blank" rel="noopener noreferrer" className="plat-btn-ghost h-9 px-4">
              <ExternalLink className="h-3.5 w-3.5" /> {t('dialog.openInNewTab')}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
        <DialogContent
          className={cn('plat rounded-[14px] border-[var(--line)]', editing && preview ? 'max-w-6xl' : 'max-w-3xl')}
          onEscapeKeyDown={(e) => {
            if (dirty) {
              e.preventDefault();
              setConfirmDiscard('close');
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8">
              <span className="truncate">{file.name}</span>
              {file.protected && (
                <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--text-4)]" aria-label={t('protected')} />
              )}
            </DialogTitle>
            <DialogDescription>
              {file.key} · {meta}
            </DialogDescription>
          </DialogHeader>

          {(isText || kind === 'image') && (
            <div className="flex flex-wrap items-center gap-2">
              {showPreviewToggle && (
                <button
                  type="button"
                  aria-pressed={preview}
                  onClick={() => setPreview((p) => !p)}
                  className={cn('plat-btn-ghost h-8 px-3 text-xs', preview && 'bg-[rgba(20,22,26,0.07)]')}
                >
                  <Eye className="h-3.5 w-3.5" /> {t('dialog.preview')}
                </button>
              )}
              {isText && canWrite && !editing && text.data && (
                <button type="button" onClick={startEdit} className="plat-btn-ghost h-8 px-3 text-xs">
                  <Pencil className="h-3.5 w-3.5" /> {t('dialog.edit')}
                </button>
              )}
              {!editing && (
                <button type="button" onClick={() => void download()} className="plat-btn-ghost h-8 px-3 text-xs">
                  <Download className="h-3.5 w-3.5" /> {t('actions.download')}
                </button>
              )}
              {kind === 'image' && image.data && (
                <a
                  href={image.data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plat-btn-ghost h-8 px-3 text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> {t('dialog.openInNewTab')}
                </a>
              )}
            </div>
          )}

          {conflict && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{t('dialog.conflict')}</span>
              <button type="button" onClick={() => void reload()} className="plat-btn-ghost h-8 px-3 text-xs">
                {t('dialog.reload')}
              </button>
              <button
                type="button"
                onClick={() => doSave(true)}
                disabled={save.isPending}
                className="plat-btn h-8 px-3 text-xs"
              >
                {t('dialog.overwrite')}
              </button>
            </div>
          )}

          {body}

          {editing && (
            <DialogFooter>
              <button type="button" onClick={cancelEdit} className="plat-btn-ghost h-9 justify-center px-4">
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={() => doSave()}
                disabled={!dirty || save.isPending}
                className="plat-btn h-9 justify-center px-4 disabled:cursor-not-allowed"
              >
                {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('dialog.save')}
              </button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard !== null} onOpenChange={(next) => !next && setConfirmDiscard(null)}>
        <AlertDialogContent className="plat rounded-[14px] border-[var(--line)]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('dialog.discardBody', { name: file.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="plat-btn-ghost !h-9 justify-center">{t('dialog.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction className="plat-btn !h-9 !px-4 justify-center" onClick={discard}>
              {t('dialog.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
