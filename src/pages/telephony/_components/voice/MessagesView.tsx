/**
 * Messages the receptionist took on calls: the owner's main reason to have one.
 *
 * The list is unread-weighted, unverified name/number stay visible rather than
 * buried, and "call back" prefills the call form instead of dialling. Nothing
 * here places a call without a second, deliberate click.
 */
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Inbox,
  Loader2,
  Phone,
  PhoneOutgoing,
  RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useMarkRead,
  useMessages,
  useVoiceConnected,
  type InboundMessage,
} from '@/lib/api/voice';
import { CHIP_TONE_CLASS, intentMeta } from '@/pages/telephony/_lib/voiceMeta';
import StartCallModal from '@/pages/telephony/_components/voice/StartCallModal';
import { ThreadChip } from '@/pages/telephony/_components/threads/ThreadBits';
import { callBackPurpose } from '@/pages/telephony/_lib/briefing';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** This field was never confirmed on the call. */
function UnverifiedDot({ what }: { what: string }) {
  return (
    <span
      title={`${what}/number not confirmed on the call — check before relying on it`}
      className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 align-middle"
      data-testid="unverified-dot"
    />
  );
}

function IntentChip({ intent }: { intent: string | null | undefined }) {
  const meta = intentMeta(intent);
  if (!meta) return null;
  return (
    <span
      title={meta.title}
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        CHIP_TONE_CLASS[meta.tone],
      )}
    >
      {meta.label}
    </span>
  );
}

function MessageRow({
  message,
  active,
  onOpen,
}: {
  message: InboundMessage;
  active: boolean;
  onOpen: () => void;
}) {
  const unread = !message.read_at;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="message-row"
      data-unread={unread ? 'true' : 'false'}
      className={cn(
        'flex w-full flex-col gap-1 border-b border-[var(--line-soft)] px-5 py-3 text-left transition-colors',
        active ? 'bg-[var(--sand)]' : 'hover:bg-[rgba(20,22,26,0.03)]',
      )}
    >
      <div className="flex items-center gap-2">
        {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />}
        <span className={cn('truncate text-sm', unread ? 'font-semibold text-[var(--ink)]' : 'text-[var(--text-2)]')}>
          {message.caller_name || 'Unknown caller'}
          {message.name_unverified && <UnverifiedDot what="Name" />}
        </span>
        {message.urgency === 'urgent' && (
          <span title="Marked urgent by the caller" className="shrink-0 text-xs text-[var(--bad-fg)]">
            ❗
          </span>
        )}
        <IntentChip intent={message.call?.inbound_intent} />
        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-5)]">{fmtWhen(message.created_at)}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-4)]">
          {message.caller_number || '—'}
          {message.number_unverified && <UnverifiedDot what="Number" />}
        </span>
        {/* Which matter this message came out of (§4.3). Inside a button, so
            it is a label here rather than a nested link. */}
        <ThreadChip as="text" threadId={message.thread_id} subject={message.thread_subject} />
      </div>
      <p className={cn('line-clamp-2 text-xs', unread ? 'text-[var(--text-2)]' : 'text-[var(--text-4)]')}>
        {message.matter}
      </p>
    </button>
  );
}

function MessageDrawer({
  message,
  onClose,
  onCallBack,
}: {
  message: InboundMessage;
  onClose: () => void;
  onCallBack: () => void;
}) {
  const navigate = useNavigate();
  return (
    <aside
      data-testid="message-drawer"
      className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-[var(--line-soft)] bg-white"
    >
      <div className="flex items-center gap-2 border-b border-[var(--line-soft)] px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-[var(--text-4)] hover:text-[var(--ink)]"
          aria-label="Close message"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--ink)]">
            {message.caller_name || 'Unknown caller'}
            {message.name_unverified && <UnverifiedDot what="Name" />}
          </p>
          <p className="font-mono text-[11px] text-[var(--text-4)]">
            {message.caller_number || 'no number'}
            {message.number_unverified && <UnverifiedDot what="Number" />}
          </p>
        </div>
        <IntentChip intent={message.call?.inbound_intent} />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {(message.name_unverified || message.number_unverified) && (
          <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            The caller never confirmed
            {message.name_unverified && ' the spelling of their name'}
            {message.name_unverified && message.number_unverified && ' or'}
            {message.number_unverified && ' the number to call back'}
            . Check it before acting on this message.
          </p>
        )}

        <div>
          <p className="plat-eyebrow mb-1.5">Matter</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-1)]">{message.matter}</p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-[var(--text-5)]">Taken</dt>
            <dd className="text-[var(--text-2)]">{new Date(message.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-5)]">Urgency</dt>
            <dd className={message.urgency === 'urgent' ? 'font-semibold text-[var(--bad-fg)]' : 'text-[var(--text-2)]'}>
              {message.urgency || 'normal'}
            </dd>
          </div>
          {message.call?.duration_seconds != null && (
            <div>
              <dt className="text-[var(--text-5)]">Call length</dt>
              <dd className="text-[var(--text-2)]">{Math.round(message.call.duration_seconds)}s</dd>
            </div>
          )}
          {message.delivery_state && (
            <div>
              <dt className="text-[var(--text-5)]">Delivery</dt>
              <dd className="text-[var(--text-2)]">{message.delivery_state}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex gap-2 border-t border-[var(--line-soft)] px-5 py-4">
        <button
          type="button"
          onClick={onCallBack}
          disabled={!message.caller_number}
          data-testid="message-call-back"
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          title={message.caller_number ? 'Prefills the call form; it does not dial' : 'No number to call back'}
        >
          <PhoneOutgoing className="h-3.5 w-3.5" />
          Call back
        </button>
        <button
          type="button"
          onClick={() => navigate(`/telephony?call=${encodeURIComponent(message.call_sid)}`)}
          className="flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--text-2)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          <Phone className="h-3.5 w-3.5" />
          Open call
        </button>
      </div>
    </aside>
  );
}

export default function MessagesView() {
  const { i18n } = useTranslation();
  const connected = useVoiceConnected();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [callBack, setCallBack] = useState<InboundMessage | null>(null);

  const { data, isLoading, isError, error, refetch, isRefetching } = useMessages({ unread: onlyUnread });
  const markRead = useMarkRead();

  const messages = useMemo(
    () =>
      [...(data?.messages ?? [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [data],
  );
  const open = messages.find((m) => m.id === openId) ?? null;

  const openMessage = (m: InboundMessage) => {
    setOpenId(m.id);
    // Opening IS reading — the drawer shows the whole matter.
    if (!m.read_at) markRead.mutate(m.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--line-soft)] px-6 pb-4 pt-5">
        <p className="plat-crumb" style={{ color: 'var(--text-4)' }}>3days.telephony</p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-[26px] text-[var(--ink)]">Messages</h1>
          {!!data?.unread && (
            <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 text-[11px] font-bold text-white">
              {data.unread} unread
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyUnread((v) => !v)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                onlyUnread
                  ? 'border-[var(--ink)] text-[var(--ink)]'
                  : 'border-[var(--line)] text-[var(--text-3)] hover:border-[var(--ink)]',
              )}
            >
              Unread only
            </button>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-full border border-[var(--line)] p-1.5 text-[var(--text-4)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
              aria-label="Refresh messages"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} />
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--text-4)]">
          What callers asked the receptionist to pass on
          {data ? ` · ${data.total} total` : ''}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto">
          {!connected ? (
            <p className="p-6 text-sm text-[var(--text-4)]">
              Not connected to a Pincer backend — connect on the Voice page to see messages.
            </p>
          ) : isLoading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-[var(--text-4)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading messages…
            </p>
          ) : isError ? (
            <p className="flex items-start gap-2 p-6 text-sm text-[var(--bad-fg)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              Could not load messages: {error?.message}
            </p>
          ) : !messages.length ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center">
              <Inbox className="h-6 w-6 text-[var(--text-5)]" />
              <p className="text-sm text-[var(--text-3)]">
                {onlyUnread ? 'Nothing unread.' : 'No messages yet.'}
              </p>
              <p className="max-w-sm text-xs text-[var(--text-5)]">
                When the receptionist takes a message on a call, it lands here — with the caller's
                name, number and what they wanted.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <MessageRow key={m.id} message={m} active={m.id === openId} onOpen={() => openMessage(m)} />
            ))
          )}
        </div>

        {open && (
          <MessageDrawer
            message={open}
            onClose={() => setOpenId(null)}
            onCallBack={() => setCallBack(open)}
          />
        )}
      </div>

      {callBack && (
        <StartCallModal
          onClose={() => setCallBack(null)}
          initialMode="now"
          initialNumber={callBack.caller_number ?? ''}
          initialName={callBack.caller_name ?? ''}
          initialPurpose={callBackPurpose(
            callBack.caller_name ?? '',
            callBack.matter,
            i18n.language,
          )}
          initialLanguage={callBack.call?.language ?? ''}
          // The call-back belongs to the matter the message came from (§4.3):
          // the loop the inbound matcher closes from the other side.
          thread={
            callBack.thread_id && callBack.thread_subject
              ? { id: callBack.thread_id, subject: callBack.thread_subject }
              : undefined
          }
        />
      )}
    </div>
  );
}
