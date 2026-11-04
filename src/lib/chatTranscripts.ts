/**
 * The web chat's transcripts, kept in this browser's IndexedDB.
 *
 * Pincer has no record of a web conversation as the person saw it.
 * `/api/conversations` lists memory records of category `exchange`: one
 * user/assistant pair each, with no thread id, and the streaming endpoint
 * writes none. The model's session is trimmed and summarised, so it is context
 * for the model, not a transcript. Until the backend stores threads, the
 * browser is the only place the whole conversation exists, so it is kept here.
 *
 * That makes history device-local: another browser or device, or cleared site
 * data, shows none of it. The exchange records Pincer already holds are still
 * listed beside it, read-only (src/lib/api/conversations.ts).
 *
 * Transcripts are scoped to the signed-in identity (`ownerId`, the
 * `pincer_user_id`), so a second person signing in on the same browser does
 * not see them. Messages are only ever added or replaced by id, never dropped:
 * a write carries the messages it is about, not a whole copy of the thread.
 */

import { createStore, entries, get, update, type UseStore } from 'idb-keyval';

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** ISO timestamp of when the message was shown. */
  at: string;
  attachments?: Array<{ name: string; type: string; size: number }>;
}

/** A phone call placed from a chat; its report comes back later (pincerhq/pincer#303). */
export interface PlacedCall {
  callSid: string;
  /** ISO timestamp of when the dial was placed, by this browser's clock. */
  at: string;
}

export interface ChatTranscript {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The Pincer conversation this chat is sent as: its own id for a chat started
   * here. Absent on chats stored before they had one; those were all sent to
   * the identity's main web conversation, which still holds their context.
   */
  conversationId?: string;
  /** Chronological: the order the messages were first written in. */
  messages: StoredChatMessage[];
  /** The calls this chat placed, so it accepts only their reports. */
  calls?: PlacedCall[];
}

let store: UseStore | null = null;
const db = () => (store ??= createStore('pincer-chat', 'transcripts'));

const keyOf = (ownerId: string, id: string) => `${ownerId}/${id}`;

/** Every transcript of `ownerId`, most recently updated first. */
export async function listTranscripts(ownerId: string): Promise<ChatTranscript[]> {
  const prefix = `${ownerId}/`;
  const rows = await entries<string, ChatTranscript>(db());
  return rows
    .filter(([key]) => typeof key === 'string' && key.startsWith(prefix))
    .map(([, t]) => t)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/** IndexedDB runs transactions in the order they were opened, so a read issued
 * after `saveMessages` sees that write. */
export async function getTranscript(ownerId: string, id: string): Promise<ChatTranscript | null> {
  return (await get<ChatTranscript>(keyOf(ownerId, id), db())) ?? null;
}

/**
 * Add `messages` to a transcript, creating it if needed. A message whose id is
 * already stored replaces it in place; a new one goes to the end.
 *
 * The read and the write share one `readwrite` transaction, so two writes to
 * the same transcript (from this tab or another) never interleave and drop
 * each other's messages.
 */
export async function saveMessages(
  ownerId: string,
  id: string,
  messages: StoredChatMessage[],
): Promise<ChatTranscript> {
  return write(ownerId, id, current => {
    const merged = current ? current.messages.slice() : [];
    for (const m of messages) {
      const at = merged.findIndex(x => x.id === m.id);
      if (at === -1) merged.push(m);
      else merged[at] = m;
    }
    return { messages: merged };
  });
}

/** Note calls placed from a transcript (creating it if needed); a known SID is kept once. */
export async function recordPlacedCalls(
  ownerId: string,
  id: string,
  callSids: string[],
  at = new Date().toISOString(),
): Promise<ChatTranscript> {
  return write(ownerId, id, current => {
    const calls = current?.calls?.slice() ?? [];
    for (const callSid of callSids) {
      if (!calls.some(c => c.callSid === callSid)) calls.push({ callSid, at });
    }
    return { messages: current?.messages ?? [], calls };
  });
}

/** One read-modify-write of a transcript, in a single `readwrite` transaction. */
async function write(
  ownerId: string,
  id: string,
  change: (current: ChatTranscript | undefined) => Pick<ChatTranscript, 'messages' | 'calls'>,
): Promise<ChatTranscript> {
  let next!: ChatTranscript;
  await update<ChatTranscript>(
    keyOf(ownerId, id),
    current => {
      const now = new Date().toISOString();
      const { messages, calls = current?.calls } = change(current);
      next = {
        id,
        ownerId,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        messages,
      };
      const conversationId = current ? current.conversationId : id;
      if (conversationId) next.conversationId = conversationId;
      if (calls?.length) next.calls = calls;
      return next;
    },
    db(),
  );
  return next;
}
