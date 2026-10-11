/**
 * What a 401 or 403 looks like to the person using the app.
 *
 * The alternative — a toast, or a silent retry loop — is the P8 failure exactly:
 * the user keeps typing into an editor whose saves are all failing, and finds
 * out later. This is modal on purpose. It appears once per session (further
 * 401s while it is open change nothing) and offers the single action that
 * actually fixes the problem.
 *
 * "Reconnect" goes to the Pincer integration settings rather than attempting a
 * refresh, because under ADR 0001 there is no refresh to attempt: the token is
 * the shared Pincer bearer, and re-obtaining it is a platform flow.
 */

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
import { onSessionExpired } from '@/pages/notes/_lib/apiClient';

export default function NotesSessionDialog() {
  const [status, setStatus] = useState<401 | 403 | null>(null);
  const navigate = useNavigate();

  useEffect(() => onSessionExpired((next) => setStatus((current) => current ?? next)), []);

  const forbidden = status === 403;

  return (
    <AlertDialog open={status !== null} onOpenChange={(open) => !open && setStatus(null)}>
      <AlertDialogContent
        className="plat rounded-[14px] border-[var(--line)]"
        style={{ background: 'var(--paper)' }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="plat-display flex items-center gap-2 text-[19px] text-[var(--ink)]">
            <ShieldAlert aria-hidden className="h-4 w-4" style={{ color: 'var(--warn-fg)' }} />
            {forbidden ? 'This workspace is not available to you' : 'Your session has expired'}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-[var(--text-3)]">
            {forbidden
              ? 'The Notes service accepted the credential but refused the request. Check which workspace this deployment points at.'
              : 'The Notes service rejected the stored credential. Anything you typed is still in this tab — reconnect and it saves on the next keystroke.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="plat-btn-ghost !h-9 justify-center">
            Keep working offline
          </AlertDialogCancel>
          <AlertDialogAction
            className="plat-btn !h-9 !px-4 justify-center"
            onClick={() => {
              setStatus(null);
              navigate('/login');
            }}
          >
            Reconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
