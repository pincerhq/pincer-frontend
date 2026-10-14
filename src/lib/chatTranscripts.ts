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
 * Transcripts are scoped to the signed-in identity (`ownerId`, the
 * `pincer_user_id`), so a second person signing in on the same browser does
 * not see them. Messages are only ever added or replaced by id, never dropped:
 * a write carries the messages it is about, not a whole copy of the thread.
 */

import { createStore, entries, get, set, type UseStore } from 'idb-keyval';

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** ISO timestamp of when the message was shown. */
  at: string;
  attachments?: Array<{ name: string; type: string; size: number }>;
}

export interface ChatTranscript {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** Chronological: the order the messages were first written in. */
  messages: StoredChatMessage[];
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

// Writes to one transcript run one after another: each is a read-merge-write,
// and two of them interleaving would lose whichever finished first.
const pending = new Map<string, Promise<unknown>>();

/** Reads after this tab's queued writes to it, so a just-sent reply is in it. */
export async function getTranscript(ownerId: string, id: string): Promise<ChatTranscript | null> {
  const key = keyOf(ownerId, id);
  await pending.get(key)?.catch(() => undefined);
  return (await get<ChatTranscript>(key, db())) ?? null;
}

/**
 * Add `messages` to a transcript, creating it if needed. A message whose id is
 * already stored replaces it in place; a new one goes to the end.
 */
export function saveMessages(
  ownerId: string,
  id: string,
  messages: StoredChatMessage[],
): Promise<ChatTranscript> {
  const key = keyOf(ownerId, id);
  const run = async () => {
    const now = new Date().toISOString();
    const current = await get<ChatTranscript>(key, db());
    const merged = current ? current.messages.slice() : [];
    for (const m of messages) {
      const at = merged.findIndex(x => x.id === m.id);
      if (at === -1) merged.push(m);
      else merged[at] = m;
    }
    const next: ChatTranscript = {
      id,
      ownerId,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      messages: merged,
    };
    await set(key, next, db());
    return next;
  };
  const result = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
  pending.set(key, result);
  void result.finally(() => {
    if (pending.get(key) === result) pending.delete(key);
  }).catch(() => undefined);
  return result;
}
