// src/lib/api/conversations.ts
// Client for /api/conversations — the Pincer memory backend's stored
// exchanges: one user/assistant pair each, with no thread id. The chat lists
// them read-only beside the browser's own transcripts (src/lib/chatTranscripts.ts),
// so history saved before transcripts existed stays reachable.

import { apiFetch } from "@/lib/api/voice";

export interface ConversationMessage {
  role: "user" | "assistant" | string;
  content: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  category: string;
  tags: string[];
  preview: string;
  messages: ConversationMessage[];
  created_at: string;
}

export interface ConversationList {
  conversations: Conversation[];
  total?: number;
  limit: number;
  offset: number;
}

export function listConversations(userId: string, limit = 50): Promise<ConversationList> {
  return apiFetch(`/api/conversations?user_id=${encodeURIComponent(userId)}&limit=${limit}`);
}
