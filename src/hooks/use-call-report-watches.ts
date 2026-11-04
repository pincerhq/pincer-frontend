/**
 * The web chat's call report watches (pincerhq/pincer#303): one per chat that
 * waits for a call's result. See src/lib/callReports.ts for how a chat knows
 * which reports are its own.
 */

import { useEffect, useRef, useState } from 'react';
import {
  getTranscript,
  recordPlacedCalls,
  saveMessages,
  type ChatTranscript,
  type StoredChatMessage,
} from '@/lib/chatTranscripts';
import { awaitedCalls, callReportMessage, fetchMissingReports, watchCallReports } from '@/lib/callReports';
import type { CallReport } from '@/lib/pincerClient';

/** What the chat shows while it has a call without a result. */
export type CallWait = 'waiting' | 'gave-up';

export interface CallReportWatchOptions {
  /** The signed-in identity whose transcripts are read; null stops everything. */
  ownerId: () => string | null;
  /** Reports just stored in `chatId`, to show if that chat is open. */
  onStored: (chatId: string, messages: StoredChatMessage[]) => void;
}

export function useCallReportWatches(options: CallReportWatchOptions) {
  const opts = useRef(options);
  opts.current = options;
  const watches = useRef(new Map<string, AbortController>());
  // A turn still being answered in a chat: its reply is stored when it ends,
  // and a report that came in meanwhile is stored after it, as it is shown.
  const turns = useRef(new Map<string, Promise<void>>());
  const [waits, setWaits] = useState<Record<string, CallWait>>({});

  const setWait = (chatId: string, wait: CallWait | undefined) =>
    setWaits(p => {
      if (p[chatId] === wait) return p;
      const next = { ...p };
      if (wait) next[chatId] = wait;
      else delete next[chatId];
      return next;
    });

  const store = async (chatId: string, reports: CallReport[]) => {
    const owner = opts.current.ownerId();
    if (!owner || !reports.length) return;
    await turns.current.get(chatId);
    const messages = reports.map(callReportMessage);
    try {
      await saveMessages(owner, chatId, messages);
    } catch {
      /* still shown; the next open catches it up again */
    }
    opts.current.onStored(chatId, messages);
  };

  // (Re)start the watch of a chat. It reads the calls to wait for from the
  // transcript, so a restart picks up a call just placed.
  const watch = (chatId: string) => {
    const owner = opts.current.ownerId();
    if (!owner) return;
    watches.current.get(chatId)?.abort();
    const controller = new AbortController();
    watches.current.set(chatId, controller);
    setWait(chatId, 'waiting');
    void watchCallReports({
      transcript: () => getTranscript(owner, chatId),
      onReports: reports => store(chatId, reports),
      signal: controller.signal,
    }).then(end => {
      if (end === 'aborted' || watches.current.get(chatId) !== controller) return;
      watches.current.delete(chatId);
      setWait(chatId, end === 'gave-up' ? 'gave-up' : undefined);
    });
  };

  useEffect(() => {
    const running = watches.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, []);

  return {
    /** Per chat id: a call result still waited for, or given up on. */
    waits,

    /** A turn in `chatId` placed these calls: note them and wait for their reports. */
    async placed(chatId: string, callSids: string[] | undefined) {
      const owner = opts.current.ownerId();
      if (!owner || !callSids?.length) return;
      try {
        await recordPlacedCalls(owner, chatId, callSids);
      } catch {
        return; // nothing to read the calls back from; the reply says it rang
      }
      watch(chatId);
    },

    /** A chat was opened: take the reports that came while it was not watched,
     * and keep waiting for the rest. */
    async opened(t: ChatTranscript) {
      let arrived = new Set<string>();
      try {
        const reports = await fetchMissingReports(t);
        arrived = new Set(reports.map(r => r.call_sid));
        await store(t.id, reports);
      } catch {
        /* a nicety: the chat opens either way; a watch asks again */
      }
      const left = awaitedCalls(t).filter(c => !arrived.has(c.callSid));
      if (left.length && !watches.current.has(t.id)) watch(t.id);
    },

    /** A turn starts in `chatId`; reports wait for the returned release. */
    holdReports(chatId: string): () => void {
      let release!: () => void;
      const settled = new Promise<void>(r => (release = r));
      turns.current.set(chatId, settled);
      return () => {
        if (turns.current.get(chatId) === settled) turns.current.delete(chatId);
        release();
      };
    },
  };
}
