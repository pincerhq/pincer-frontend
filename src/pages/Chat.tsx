import { useState, useEffect, useRef } from 'react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/dashboard/AppSidebar';
import {
  Send, Mic, MicOff,
  Paperclip, X, FileText, Image, Plus, Link2, Unlink,
  ShieldAlert, Check, AlertCircle, Loader2, Wrench,
  Users, ChevronDown, Megaphone, BarChart3, CalendarRange, Wallet,
} from 'lucide-react';
import '@/styles/platform.css';
import { useToast } from '@/hooks/use-toast';
import {
  isConnected as pincerConnected,
  streamChat,
  sendChat,
  resetUserId,
  respondApproval,
  PincerError,
  getAuth,
} from '@/lib/pincerClient';
import {
  getTranscript,
  listTranscripts,
  saveMessages,
  type ChatTranscript,
  type StoredChatMessage,
} from '@/lib/chatTranscripts';
import { cleanAssistantText, renderAssistantText, renderTextWithLinks } from '@/lib/formatChat';

type ChainStep =
  | {
      kind: 'tool';
      key: string;
      name: string;
      status: 'running' | 'done';
    }
  | {
      kind: 'approval';
      key: string;
      approvalId: string;
      tool: string;
      decision?: 'approved' | 'denied' | 'error';
      error?: string;
    };

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  // `url` is a blob URL that dies with the page, so stored messages have none.
  attachments?: Array<{ name: string; type: string; size: number; url?: string }>;
  streaming?: boolean;
  chain?: ChainStep[];
}

interface ChatHistory {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: Date;
  messageCount: number;
}

const SUGGESTIONS = [
  { title: 'Create a marketing plan',   sub: 'for my new product launch',        icon: Megaphone     },
  { title: 'Analyze sales data',        sub: 'and generate a summary report',    icon: BarChart3     },
  { title: 'Draft a project timeline',  sub: 'with milestones and deliverables', icon: CalendarRange },
  { title: 'Prepare a budget overview', sub: 'for Q2 planning session',          icon: Wallet        },
];

const AGENTS = [
  { label: 'Emma',  color: '#fce7f3', dot: '#f472b6' },
  { label: 'Aria',  color: '#dbeafe', dot: '#60a5fa' },
  { label: 'Felix', color: '#dcfce7', dot: '#4ade80' },
  { label: 'Maya',  color: '#ede9fe', dot: '#a78bfa' },
];

// The sidebar's "Current Chat": a new conversation nothing has been sent in yet.
const NEW_CHAT = 'current';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  text: "Hello! Welcome to 3days.ai. I'm your AI assistant. Try asking me to help you with tasks like 'Create a marketing plan for my new product' or 'Analyze my sales data'. How can I help you today?",
  sender: 'assistant',
  timestamp: new Date(),
};

const Chat = () => {
  const { toast } = useToast();
  const [message, setMessage]             = useState('');
  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [isListening, setIsListening]     = useState(false);
  const [attachments, setAttachments]     = useState<File[]>([]);
  const [chatHistory, setChatHistory]     = useState<ChatHistory[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>(NEW_CHAT);
  const [isStreaming, setIsStreaming]     = useState(false);
  const [loadingChat, setLoadingChat]     = useState(false);
  const [loadError, setLoadError]         = useState<string | null>(null);
  const [historyError, setHistoryError]   = useState(false);
  const [pincerOn, setPincerOn]           = useState<boolean>(() => pincerConnected());
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  // Dismissed prompt suggestions survive reloads — "closed" should stay closed.
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('chat.suggestions.dismissed') ?? '[]');
    } catch {
      return [];
    }
  });

  const restoreSuggestions = () => {
    localStorage.removeItem('chat.suggestions.dismissed');
    setDismissedSuggestions([]);
  };

  const dismissSuggestion = (title: string | 'ALL') => {
    setDismissedSuggestions(prev => {
      const next = title === 'ALL' ? SUGGESTIONS.map(x => x.title) : [...prev, title];
      localStorage.setItem('chat.suggestions.dismissed', JSON.stringify(next));
      return next;
    });
  };

  const visibleSuggestions = SUGGESTIONS.filter(x => !dismissedSuggestions.includes(x.title));

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const abortRef       = useRef<AbortController | null>(null);
  const agentMenuRef   = useRef<HTMLDivElement>(null);

  const hasStarted = messages.some(m => m.sender === 'user');
  // Nothing is sent into a conversation that has not finished opening.
  const inputBlocked = isStreaming || loadingChat || loadError !== null;

  // Transcripts live in this browser (src/lib/chatTranscripts.ts): the
  // backend keeps single exchanges and a trimmed model context, not threads.
  // The conversation the person last wrote in — what "Current Chat" opens.
  const liveChatIdRef = useRef<string>(NEW_CHAT);
  // Bumped on every switch, so a load that lands after the next one is dropped.
  const loadSeqRef = useRef(0);
  const saveFailedRef = useRef(false);

  const ownerId = () => (pincerConnected() ? getAuth()?.userId ?? null : null);

  const refreshHistory = async (): Promise<ChatTranscript[] | null> => {
    const owner = ownerId();
    if (!owner) {
      setChatHistory([]);
      return null;
    }
    try {
      const list = await listTranscripts(owner);
      setChatHistory(list.map(toHistoryItem));
      setHistoryError(false);
      return list;
    } catch {
      setHistoryError(true);
      return null;
    }
  };

  const persist = async (convId: string, msgs: ChatMessage[]) => {
    const owner = ownerId();
    if (!owner || convId === NEW_CHAT) return;
    try {
      await saveMessages(owner, convId, msgs.map(toStored));
      saveFailedRef.current = false;
    } catch {
      if (!saveFailedRef.current) {
        saveFailedRef.current = true;
        toast({
          title: 'Chat not saved',
          description: 'This browser refused to store the conversation, so it will be incomplete when you reopen it.',
          variant: 'destructive',
        });
      }
      return;
    }
    void refreshHistory();
  };

  // Boot: show welcome, then reopen the conversation the person left off in.
  useEffect(() => {
    setMessages([WELCOME_MESSAGE]);
    const seq = loadSeqRef.current;
    let cancelled = false;
    (async () => {
      const list = await refreshHistory();
      // Someone who already opened or started a chat has moved on.
      if (cancelled || !list?.length || loadSeqRef.current !== seq) return;
      const latest = list[0];
      liveChatIdRef.current = latest.id;
      setCurrentChatId(latest.id);
      setMessages(latest.messages.map(fromStored));
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // Once per mount: later refreshes come from the handlers that change history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasStarted) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, hasStarted]);

  useEffect(() => {
    if (!showAgentMenu) return;
    const handler = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setShowAgentMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAgentMenu]);

  const pickAgent = (label: string) => {
    setMessage(prev => {
      const sep = prev.length === 0 || /\s$/.test(prev) ? '' : ' ';
      return `${prev}${sep}@${label} `;
    });
    setShowAgentMenu(false);
    textareaRef.current?.focus();
  };

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 240) + 'px'; }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    adjustHeight();
  };

  const handleSend = () => {
    if (inputBlocked) return;
    if (!message.trim() && attachments.length === 0) return;

    // Writing in a conversation continues it; the first message of a new one
    // gives it the id it is stored under.
    let convId = currentChatId;
    if (pincerOn) {
      if (convId === NEW_CHAT) {
        convId = crypto.randomUUID();
        loadSeqRef.current++;
        setCurrentChatId(convId);
      }
      liveChatIdRef.current = convId;
    }
    const atts = attachments.map(f => ({ name: f.name, type: f.type, size: f.size, url: URL.createObjectURL(f) }));
    const userText = message;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), text: userText, sender: 'user', timestamp: new Date(), attachments: atts.length ? atts : undefined };
    setMessages(p => [...p, userMsg]);
    setMessage('');
    setAttachments([]);
    if (textareaRef.current)  textareaRef.current.style.height = 'auto';
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (pincerOn) {
      void persist(convId, [userMsg]);
      void dispatchToPincer(convId, userText);
    } else {
      // No backend, no answer. The old fallback echoed the question back as if
      // the agent had replied, which reads as a working assistant and is not.
      setMessages(p => [
        ...p,
        {
          id: crypto.randomUUID(),
          text: 'Not connected to a Pincer backend — nothing was sent and there is no reply.',
          sender: 'assistant',
          timestamp: new Date(),
        },
      ]);
    }
  };

  // Stream a reply from the Pincer backend, appending tokens to a single
  // assistant bubble. Tool starts/dones and approval requests are merged
  // into a single `chain` timeline on that bubble so the user sees one
  // vertical sequence of steps. Falls back to POST /api/chat/message on
  // stream failure. Only the settled reply is stored, once, under `convId`.
  const dispatchToPincer = async (convId: string, userText: string) => {
    const assistantId = crypto.randomUUID();
    const startedAt = new Date();
    setMessages(p => [
      ...p,
      { id: assistantId, text: '', sender: 'assistant', timestamp: startedAt, streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setIsStreaming(true);

    let streamed = '';
    const appendDelta = (delta: string) => {
      streamed += delta;
      setMessages(p =>
        p.map(m => (m.id === assistantId ? { ...m, text: m.text + delta } : m)),
      );
    };
    const updateChain = (mut: (chain: ChainStep[]) => ChainStep[]) => {
      setMessages(p =>
        p.map(m =>
          m.id === assistantId ? { ...m, chain: mut(m.chain ?? []) } : m,
        ),
      );
    };
    const settle = (text: string) => {
      setMessages(p =>
        p.map(m => (m.id === assistantId ? { ...m, text, streaming: false } : m)),
      );
      if (text) {
        void persist(convId, [{ id: assistantId, text, sender: 'assistant', timestamp: startedAt }]);
      }
    };
    const finish = (finalText?: string) =>
      settle(finalText && finalText.length > streamed.length ? finalText : streamed);

    try {
      let gotChunk = false;
      for await (const ev of streamChat(userText, controller.signal)) {
        if (ev.event === 'chunk') {
          gotChunk = true;
          appendDelta(ev.data.delta);
        } else if (ev.event === 'approval') {
          // Backend is asking the user to confirm a destructive tool call.
          // Append it to the chain so it sits inline with the surrounding
          // tool steps; the SSE keeps streaming once respondApproval()
          // resolves the future.
          const stepKey = `ap-${ev.data.approval_id}`;
          updateChain(chain => [
            ...chain,
            {
              kind: 'approval',
              key: stepKey,
              approvalId: ev.data.approval_id,
              tool: ev.data.tool,
            },
          ]);
        } else if (ev.event === 'tool') {
          const { phase, name } = ev.data;
          if (phase === 'start') {
            updateChain(chain => [
              ...chain,
              { kind: 'tool', key: `tool-${chain.length}-${name}`, name, status: 'running' },
            ]);
          } else {
            // phase === 'done': mark the latest running tool with this name as done
            updateChain(chain => {
              for (let k = chain.length - 1; k >= 0; k--) {
                const s = chain[k];
                if (s.kind === 'tool' && s.name === name && s.status === 'running') {
                  const next = chain.slice();
                  next[k] = { ...s, status: 'done' };
                  return next;
                }
              }
              return chain;
            });
          }
        } else if (ev.event === 'done') {
          // Any tool still marked running at end-of-turn is treated as completed.
          updateChain(chain =>
            chain.map(s =>
              s.kind === 'tool' && s.status === 'running' ? { ...s, status: 'done' } : s,
            ),
          );
          finish(ev.data.text);
          return;
        } else if (ev.event === 'error') {
          throw new PincerError(ev.data.message, 500);
        }
      }
      // Stream closed without an explicit `done` — finalize whatever we have.
      if (gotChunk) finish();
      else throw new PincerError('Empty stream', 500);
    } catch (streamErr) {
      if (controller.signal.aborted) {
        finish();
        return;
      }
      // Fall back to the non-streaming endpoint so the user still gets a reply.
      try {
        const { reply } = await sendChat(userText);
        settle(reply);
      } catch (fallbackErr) {
        const msg =
          fallbackErr instanceof PincerError
            ? fallbackErr.message
            : streamErr instanceof Error
              ? streamErr.message
              : 'Unknown error';
        settle(`⚠️ ${msg}`);
        if (fallbackErr instanceof PincerError && fallbackErr.status === 401) {
          setPincerOn(false);
        }
      }
    } finally {
      setIsStreaming(false);
      // A newer turn may already own the ref; only clear our own controller.
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleApproval = async (msgId: string, approvalId: string, approved: boolean) => {
    const setDecision = (decision: 'approved' | 'denied' | 'error', error?: string) => {
      setMessages(p =>
        p.map(m => {
          if (m.id !== msgId || !m.chain) return m;
          return {
            ...m,
            chain: m.chain.map(s =>
              s.kind === 'approval' && s.approvalId === approvalId
                ? { ...s, decision, error }
                : s,
            ),
          };
        }),
      );
    };

    try {
      await respondApproval(approvalId, approved);
      setDecision(approved ? 'approved' : 'denied');
    } catch (err) {
      const detail = err instanceof PincerError ? err.message : 'Failed to send decision';
      setDecision('error', detail);
      if (err instanceof PincerError && err.status === 401) setPincerOn(false);
    }
  };

  const showNewChat = () => {
    setCurrentChatId(NEW_CHAT);
    setLoadingChat(false);
    setLoadError(null);
    setMessages([WELCOME_MESSAGE]);
  };

  const startNewChat = () => {
    abortRef.current?.abort();
    if (pincerOn) resetUserId();
    loadSeqRef.current++;
    liveChatIdRef.current = NEW_CHAT;
    showNewChat();
    void refreshHistory();
  };

  // Switching stops a reply still streaming (what arrived is kept) and always
  // reads the whole transcript from the store, never a cached copy.
  const selectChat = async (id: string) => {
    const target = id === NEW_CHAT ? liveChatIdRef.current : id;
    if (target === currentChatId && !loadError) return;
    abortRef.current?.abort();
    const seq = ++loadSeqRef.current;
    if (target === NEW_CHAT) {
      showNewChat();
      return;
    }
    setCurrentChatId(target);
    setLoadError(null);
    setLoadingChat(true);
    setMessages([]);
    try {
      const owner = ownerId();
      const transcript = owner ? await getTranscript(owner, target) : null;
      if (seq !== loadSeqRef.current) return;
      if (!transcript) throw new Error('Conversation not found');
      setMessages(transcript.messages.map(fromStored));
    } catch {
      if (seq === loadSeqRef.current) setLoadError(target);
    } finally {
      if (seq === loadSeqRef.current) setLoadingChat(false);
    }
  };

  const getFileIcon = (type: string) => type.startsWith('image/') ? Image : FileText;
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  /* ── Agent dropdown (lives inside the input bar) ── */
  const agentDropdown = (
    <div className="relative" ref={agentMenuRef}>
      <button
        type="button"
        onClick={() => setShowAgentMenu(p => !p)}
        className={`flex items-center gap-1 h-9 px-2 rounded-lg transition-colors ${
          showAgentMenu
            ? 'bg-gray-100 text-gray-700'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
        }`}
        title="Mention an agent"
      >
        <Users className="h-5 w-5" />
        <ChevronDown className="h-3 w-3" />
      </button>
      {showAgentMenu && (
        <div className="absolute bottom-full right-0 mb-2 min-w-[170px] rounded-xl border border-gray-200 bg-white shadow-lg py-1 z-20">
          <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
            Demo roster — inserts text only
          </div>
          {AGENTS.map(a => (
            <button
              key={a.label}
              type="button"
              onClick={() => pickAgent(a.label)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.dot }} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  /* ── Bottom input bar (shared) ── */
  const inputBar = (
    <div className="w-full">
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 px-1">
          {attachments.map((f, i) => {
            const Icon = getFileIcon(f.type);
            return (
              <div key={i} className="flex items-center gap-1.5 bg-gray-100 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700">
                <Icon className="h-3.5 w-3.5 text-gray-400" />
                <span className="truncate max-w-[8rem]">{f.name}</span>
                <button onClick={() => setAttachments(p => p.filter((_, j) => j !== i))} className="ml-0.5 text-gray-400 hover:text-gray-600"><X className="h-3 w-3" /></button>
              </div>
            );
          })}
        </div>
      )}

      {/* Textarea card */}
      <div
        className="plat-field-shell rounded-[14px] border bg-white transition-colors duration-200"
        style={{ borderColor: 'var(--line)' }}
      >
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'Generating reply…' : 'Message AI assistant… (Shift+Enter for new line)'}
          rows={1}
          disabled={inputBlocked}
          className="w-full resize-none bg-transparent text-base text-gray-800 placeholder-gray-400 px-5 pt-5 pb-2 focus:outline-none leading-relaxed disabled:opacity-60"
          style={{ minHeight: '88px', maxHeight: '240px' }}
        />
        <div className="flex items-center justify-between px-4 pb-4">
          {/* Left actions */}
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center h-9 w-9 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <Paperclip className="h-5 w-5" />
          </button>
          {/* Right actions */}
          <div className="flex items-center gap-2">
            {agentDropdown}
            <button
              onClick={() => setIsListening(p => !p)}
              className={`flex items-center justify-center h-9 w-9 rounded-lg transition-colors ${isListening ? 'bg-red-100 text-red-500' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            >
              {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <button
              onClick={handleSend}
              disabled={inputBlocked || (!message.trim() && attachments.length === 0)}
              className={`flex items-center justify-center h-9 w-9 rounded-full transition-all duration-150 ${
                !inputBlocked && (message.trim() || attachments.length > 0)
                  ? 'bg-[#14161a] text-white hover:opacity-85'
                  : 'bg-gray-100 text-gray-300 cursor-not-allowed'
              }`}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-gray-400 mt-2">
        AI can make mistakes. Consider checking important information.
      </p>
    </div>
  );

  const pincerBadge = (
    <span
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
        pincerOn
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-gray-50 border-gray-200 text-gray-500'
      }`}
      title={pincerOn ? 'Connected to Pincer' : 'Demo mode — sign in again to connect'}
    >
      {pincerOn ? <Link2 className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
      {pincerOn ? 'Pincer connected' : 'Demo mode'}
    </span>
  );

  return (
    <SidebarProvider className="plat">
      <AppSidebar
        chatHistory={chatHistory}
        currentChatId={currentChatId}
        onSelectChat={selectChat}
        onNewChat={startNewChat}
      />
      <SidebarInset className="flex flex-row overflow-hidden h-screen bg-transparent">

        {/* ────────────── Main chat column ────────────── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {historyError && (
            <div role="alert" className="flex items-center justify-center gap-2 px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Could not load your saved chats from this browser.</span>
              <button type="button" onClick={() => void refreshHistory()} className="font-medium underline">
                Retry
              </button>
            </div>
          )}

          {!hasStarted && !loadingChat && loadError === null ? (
            /* ── Empty / welcome state ── */
            <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-16">
              <div className="w-full max-w-2xl flex flex-col items-center gap-8">

                {/* Greeting */}
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="plat-crumb">3days.chat</p>
                  <h1 className="text-[2rem] text-gray-900">How can I help you today?</h1>
                  <p className="text-sm text-gray-500">Chat with your AI employees or ask anything</p>
                  {pincerBadge}
                </div>

                {/* Input — centered */}
                <div className="w-full space-y-2.5">
                  {inputBar}
                </div>

                {/* All suggestions hidden → a quiet way to bring them back */}
                {visibleSuggestions.length === 0 && dismissedSuggestions.length > 0 && (
                  <button
                    type="button"
                    onClick={restoreSuggestions}
                    className="text-xs text-gray-400 transition-colors hover:text-gray-600"
                  >
                    Show suggestions
                  </button>
                )}

                {/* Prompt suggestions — squircle-icon list rows (reference nav style) */}
                {visibleSuggestions.length > 0 && (
                  <div className="w-full">
                    <div className="mb-2 flex items-center justify-between px-3">
                      <p className="plat-eyebrow">Suggestions</p>
                      <button
                        type="button"
                        onClick={() => dismissSuggestion('ALL')}
                        className="text-[11px] text-gray-400 transition-colors hover:text-gray-600"
                      >
                        Hide all
                      </button>
                    </div>
                    <div className="space-y-1">
                      {visibleSuggestions.map(item => {
                        const Icon = item.icon;
                        return (
                          <div key={item.title} className="group flex items-center">
                            <button
                              type="button"
                              onClick={() => { setMessage(item.title + ' ' + item.sub); textareaRef.current?.focus(); }}
                              className="plat-item min-w-0 flex-1"
                            >
                              <span className="plat-item-icon !h-11 !w-11 !rounded-[10px]">
                                <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                              </span>
                              <span className="min-w-0">
                                <span className="plat-item-title block truncate text-[14px]">{item.title}</span>
                                <span className="plat-item-sub block truncate text-xs">{item.sub}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => dismissSuggestion(item.title)}
                              className="mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-300 opacity-0 transition-all hover:bg-gray-200/60 hover:text-gray-600 group-hover:opacity-100"
                              aria-label={`Dismiss suggestion: ${item.title}`}
                              title="Dismiss"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

          ) : (
            /* ── Active chat state ── */
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b" style={{ borderColor: 'var(--line-soft)' }}>
                <div className="flex items-center gap-3">
                  <span className="plat-crumb">3days.chat</span>
                  {pincerBadge}
                </div>
                <button onClick={startNewChat} className="plat-btn-ghost !h-8">
                  <Plus className="h-3.5 w-3.5" />
                  New chat
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto py-10 px-4 space-y-8">
                  {loadError !== null && (
                    <div role="alert" className="flex flex-col items-center gap-2 py-10 text-sm text-gray-600">
                      <AlertCircle className="h-5 w-5 text-red-400" />
                      <span>This conversation could not be loaded, so nothing of it is shown.</span>
                      <button type="button" onClick={() => void selectChat(loadError)} className="plat-btn-ghost !h-8">
                        Try again
                      </button>
                    </div>
                  )}
                  {loadingChat && (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading conversation…</span>
                    </div>
                  )}
                  {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                      {/* Content */}
                      <div className={`flex flex-col max-w-[80%] ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                        {msg.sender === 'assistant' ? (
                          (() => {
                            const cleaned = cleanAssistantText(msg.text);
                            const hasText = cleaned.length > 0;
                            const hasChain = !!msg.chain && msg.chain.length > 0;
                            const showTyping = msg.streaming && !hasText && !hasChain;
                            return (
                              <div className="flex flex-col gap-2 w-full">
                                {hasChain && (
                                  <ChainTimeline
                                    steps={msg.chain!}
                                    msgId={msg.id}
                                    streaming={!!msg.streaming}
                                    onDecide={handleApproval}
                                  />
                                )}
                                <div className="text-sm text-gray-800 leading-relaxed">
                                  {showTyping ? (
                                    <span className="inline-flex items-center gap-1 text-gray-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
                                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
                                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" />
                                    </span>
                                  ) : hasText ? (
                                    <>
                                      {renderAssistantText(msg.text)}
                                      {msg.streaming && (
                                        <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-gray-400 animate-pulse align-middle" />
                                      )}
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="text-sm px-4 py-2.5 rounded-[12px] rounded-tr-md leading-relaxed whitespace-pre-wrap break-words" style={{ background: 'var(--sand-deep)', color: 'var(--ink)' }}>
                            {renderTextWithLinks(msg.text)}
                          </div>
                        )}

                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-1.5 flex flex-col gap-1.5">
                            {msg.attachments.map((att, i) => {
                              const Icon = getFileIcon(att.type);
                              return (
                                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg border border-gray-200">
                                  <Icon className="h-3.5 w-3.5 text-gray-500" />
                                  <span className="text-xs text-gray-700 truncate max-w-48">{att.name}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <span className="text-[11px] text-gray-400 mt-1.5 px-0.5">{fmt(msg.timestamp)}</span>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Bottom bar */}
              <div className="shrink-0 px-4 pt-3 pb-4">
                <div className="max-w-2xl mx-auto space-y-2.5">
                  {inputBar}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Hidden file input */}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => setAttachments(p => [...p, ...Array.from(e.target.files || [])])} accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx" />
      </SidebarInset>
    </SidebarProvider>
  );
};

// Vertical chain-of-thought timeline. Renders tool calls and approval
// requests as a single sequence of points connected by a vertical line,
// so the user reads the agent's work top-to-bottom as it happens.
function ChainTimeline({
  steps,
  msgId,
  streaming,
  onDecide,
}: {
  steps: ChainStep[];
  msgId: string;
  streaming: boolean;
  onDecide: (msgId: string, approvalId: string, approved: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5">
      <ol className="flex flex-col">
        {steps.map((step, i) => (
          <ChainRow
            key={step.key}
            step={step}
            isLast={i === steps.length - 1}
            streaming={streaming}
            msgId={msgId}
            onDecide={onDecide}
          />
        ))}
      </ol>
    </div>
  );
}

function ChainRow({
  step,
  isLast,
  streaming,
  msgId,
  onDecide,
}: {
  step: ChainStep;
  isLast: boolean;
  streaming: boolean;
  msgId: string;
  onDecide: (msgId: string, approvalId: string, approved: boolean) => void;
}) {
  // Active = the latest in-flight thing the agent is doing right now; this
  // controls the dot accent so the chain reads like a progress indicator.
  const isActive =
    streaming &&
    isLast &&
    ((step.kind === 'tool' && step.status === 'running') ||
      (step.kind === 'approval' && !step.decision));

  return (
    <li className="flex gap-3">
      {/* Dot + connector */}
      <div className="flex flex-col items-center pt-1">
        <ChainDot step={step} isActive={isActive} />
        {!isLast && <div className="flex-1 w-px bg-gray-200 mt-1 min-h-[14px]" />}
      </div>

      {/* Content */}
      <div className={`flex-1 ${isLast ? 'pb-0' : 'pb-3'}`}>
        {step.kind === 'tool' ? (
          <ToolStepBody step={step} />
        ) : (
          <ApprovalStepBody step={step} msgId={msgId} onDecide={onDecide} />
        )}
      </div>
    </li>
  );
}

function ChainDot({ step, isActive }: { step: ChainStep; isActive: boolean }) {
  if (step.kind === 'approval') {
    if (step.decision === 'approved') {
      return <span className="h-2 w-2 rounded-full bg-gray-700 ring-2 ring-gray-100" />;
    }
    if (step.decision === 'denied') {
      return <span className="h-2 w-2 rounded-full bg-gray-300 ring-2 ring-gray-100" />;
    }
    if (step.decision === 'error') {
      return <span className="h-2 w-2 rounded-full bg-red-400 ring-2 ring-red-50" />;
    }
    return (
      <span
        className={`h-2 w-2 rounded-full bg-gray-500 ring-2 ring-gray-100 ${
          isActive ? 'animate-pulse' : ''
        }`}
      />
    );
  }
  // tool
  if (step.status === 'running') {
    return (
      <span
        className={`h-2 w-2 rounded-full bg-[#8fc4e4] ring-2 ring-[#bdd8ec]/40 ${
          isActive ? 'animate-pulse' : ''
        }`}
      />
    );
  }
  return <span className="h-2 w-2 rounded-full bg-gray-400 ring-2 ring-gray-100" />;
}

function ToolStepBody({ step }: { step: Extract<ChainStep, { kind: 'tool' }> }) {
  const running = step.status === 'running';
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <Wrench className="h-3 w-3 text-gray-400 shrink-0" />
      <span className="font-mono text-gray-700">{step.name}</span>
      <span className="inline-flex items-center gap-1 text-gray-400">
        {running ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>running…</span>
          </>
        ) : (
          <>
            <Check className="h-3 w-3 text-gray-400" />
            <span>done</span>
          </>
        )}
      </span>
    </div>
  );
}

function ApprovalStepBody({
  step,
  msgId,
  onDecide,
}: {
  step: Extract<ChainStep, { kind: 'approval' }>;
  msgId: string;
  onDecide: (msgId: string, approvalId: string, approved: boolean) => void;
}) {
  if (step.decision === 'approved' || step.decision === 'denied') {
    const approved = step.decision === 'approved';
    return (
      <div className="flex items-center gap-2 text-[12px]">
        {approved ? (
          <Check className="h-3 w-3 text-gray-500" />
        ) : (
          <X className="h-3 w-3 text-gray-400" />
        )}
        <span className="text-gray-500">{approved ? 'Approved' : 'Denied'}</span>
        <span className="font-mono text-gray-700">{step.tool}</span>
      </div>
    );
  }

  if (step.decision === 'error') {
    return (
      <div className="flex items-center gap-2 text-[12px] text-red-500">
        <AlertCircle className="h-3 w-3" />
        <span>Could not send decision: {step.error ?? 'unknown error'}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[12px]">
        <ShieldAlert className="h-3.5 w-3.5 text-gray-500 shrink-0" />
        <span className="font-medium text-gray-800">Approval required</span>
        <span className="font-mono text-gray-700">{step.tool}</span>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={() => onDecide(msgId, step.approvalId, true)}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-gray-900 text-white hover:bg-gray-700 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onDecide(msgId, step.approvalId, false)}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function toStored(m: ChatMessage): StoredChatMessage {
  return {
    id: m.id,
    role: m.sender,
    text: m.text,
    at: m.timestamp.toISOString(),
    attachments: m.attachments?.map(({ name, type, size }) => ({ name, type, size })),
  };
}

function fromStored(m: StoredChatMessage): ChatMessage {
  return {
    id: m.id,
    text: m.text,
    sender: m.role,
    timestamp: new Date(m.at),
    attachments: m.attachments?.map(a => ({ ...a })),
  };
}

function toHistoryItem(t: ChatTranscript): ChatHistory {
  const user = t.messages.find(m => m.role === 'user')?.text ?? '';
  const assistant = [...t.messages].reverse().find(m => m.role === 'assistant')?.text ?? '';
  return {
    id: t.id,
    title: user.length > 44 ? `${user.slice(0, 44)}…` : user || 'Conversation',
    lastMessage: assistant.length > 60 ? `${assistant.slice(0, 60)}…` : assistant,
    timestamp: new Date(t.updatedAt),
    messageCount: t.messages.length,
  };
}

export default Chat;
