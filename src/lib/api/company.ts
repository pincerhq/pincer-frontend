// src/lib/api/company.ts
// The Company Brain page's client. Memento is an MCP server — Pincer's agent
// reaches its tools (search / remember / forget / sync_status), the browser
// cannot. So:
//   - connection status is REAL   → /api/integrations lists MCP servers
//   - ask / teach / forget REAL   → chat-mediated: the agent is instructed to
//     call the memento tools, each request in a conversation of its own so
//     the user's chats stay untouched (same pattern as the call summarizer)
//   - browsing files / sync health from the UI would need a REST proxy for
//     the MCP tools — those panels stay mocked and badged.

import { useQuery } from "@tanstack/react-query";
import { authedFetch, isConnected, PincerError, sendOneOffChat } from "@/lib/pincerClient";
import { REFETCH_INTERVALS } from "@/lib/constants";

export interface IntegrationEntry {
  name: string;
  version: string;
  description: string;
  status: "active" | "disabled" | string;
  source: "builtin" | "integration" | "mcp" | string;
  slug?: string;
}

export function useIntegrations() {
  return useQuery<{ integrations: IntegrationEntry[] }, PincerError>({
    queryKey: ["company", "integrations"],
    queryFn: async () => {
      const res = await authedFetch("/api/integrations");
      if (!res.ok) throw new PincerError(`HTTP ${res.status}`, res.status);
      return res.json();
    },
    refetchInterval: (REFETCH_INTERVALS.VOICE ?? 5000) * 6,
    enabled: isConnected(),
  });
}

/** The memento MCP entry from the integrations list, if configured. */
export function findMemento(entries: IntegrationEntry[] | undefined): IntegrationEntry | null {
  return entries?.find((e) => e.source === "mcp" && e.name.toLowerCase().includes("memento")) ?? null;
}

// ── Chat-mediated brain operations (one-off conversations) ──────────────

// Each call is a fresh conversation (sendOneOffChat): an earlier answer in
// context could stand in for the memento search the prompt asks for.

/** Ask the knowledge base a question — the agent must answer from memento search. */
export function askCompanyBrain(question: string): Promise<string> {
  return sendOneOffChat(
    "You are answering strictly from the company knowledge base. " +
      "Use the memento `search` tool with a suitable query, then answer based ONLY on the returned chunks. " +
      "Cite the source file of each fact you use in the form [source: filename]. " +
      "If the search returns nothing relevant, say plainly that the knowledge base has nothing on this — do not guess. " +
      "No greetings, no follow-up questions.\n\nQuestion: " + question,
  );
}

/** Store a fact in the knowledge base under a key, via the memento remember tool. */
export function teachCompanyBrain(key: string, content: string): Promise<string> {
  return sendOneOffChat(
    "Call the memento `remember` tool now with key " + JSON.stringify(key) +
      " and exactly this content (do not rephrase it):\n\n" + content +
      "\n\nThen confirm in one short sentence what was stored and under which key. " +
      "If the tool is unavailable or fails, say exactly what went wrong.",
  );
}

export interface BrainChunk {
  source: string;
  distance: number | null;
  text: string;
}

/**
 * Run memento `search` and get the RAW result chunks back as data — the
 * console renders them as ranked rows (source / score / snippet), not prose.
 * The agent is instructed to pass the tool output through as JSON only.
 */
export async function searchBrainChunks(query: string): Promise<BrainChunk[]> {
  const reply = await sendOneOffChat(
    "Call the memento `search` tool with query " + JSON.stringify(query) + ". " +
      "Return the tool's raw results as a JSON array ONLY — no prose, no markdown fences: " +
      '[{"source": "<file or key>", "distance": <number or null>, "text": "<chunk text>"}]. ' +
      "Keep the tool's result order. If the search returns nothing, return []. " +
      "If the memento tool is unavailable, return {\"error\": \"<reason>\"}.",
  );
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start === -1 || end === -1) {
    const eStart = reply.indexOf("{");
    if (eStart !== -1) {
      try {
        const parsed = JSON.parse(reply.slice(eStart, reply.lastIndexOf("}") + 1));
        if (parsed?.error) throw new PincerError(String(parsed.error), 500);
      } catch (err) {
        if (err instanceof PincerError) throw err;
      }
    }
    throw new PincerError("Agent did not return structured results", 500);
  }
  try {
    const rows = JSON.parse(reply.slice(start, end + 1)) as BrainChunk[];
    return rows.filter((r) => r && typeof r.text === "string");
  } catch {
    throw new PincerError("Could not parse search results", 500);
  }
}

/** Read back exactly what is stored under a key, via memento search(key=...). */
export function inspectBrainKey(key: string): Promise<string> {
  return sendOneOffChat(
    "Call the memento `search` tool with the parameter key=" + JSON.stringify(key) +
      " (key lookup, not a text query). Return the stored content verbatim, prefixed by nothing. " +
      "If nothing is stored under that key, reply exactly: NOTHING_STORED",
  );
}

/** Ask the agent to run memento's sync_status tool and report it. */
export function checkBrainSync(): Promise<string> {
  return sendOneOffChat(
    "Call the memento `sync_status` tool now and report the result as short lines: " +
      "enabled yes/no, last tick time, indexed file count, last tick new/modified/deleted counts, errors if any. " +
      "No greetings, no commentary. If the tool is unavailable, say exactly what went wrong.",
  );
}

/** Delete a remembered entry by key, via the memento forget tool. */
export function forgetCompanyBrain(key: string): Promise<string> {
  return sendOneOffChat(
    "Call the memento `forget` tool now with key " + JSON.stringify(key) + ". " +
      "Then confirm in one short sentence. If the tool is unavailable or fails, say exactly what went wrong.",
  );
}
