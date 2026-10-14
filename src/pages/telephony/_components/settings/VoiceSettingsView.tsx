/**
 * Telephony settings — what the voice stack is actually configured to do.
 *
 * The old screen showed masked Twilio credentials with Edit buttons, three
 * invented webhook URLs and a "Test connection" that tested nothing. None of
 * it was real: credentials and webhooks are server-side environment, and the
 * only voice setting the API lets a browser change is the turn model. So this
 * shows the server's own answers, makes the one changeable thing changeable,
 * and says plainly where the rest lives.
 */
import { useTranslation } from 'react-i18next';
import { Check, Cpu, Loader2, Plug, Radio, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useUpdateVoiceConfig,
  useVoiceConfig,
  useVoiceConnected,
  useVoiceStatus,
} from '@/lib/api/voice';
import PlatSelect from '@/pages/telephony/_components/shared/PlatSelect';
import PolicyPanel from '@/pages/telephony/_components/voice/PolicyPanel';

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--paper)] p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <Icon className="h-4 w-4 text-[var(--text-5)]" />
          {title}
        </h2>
        {hint && <span className="text-[11px] text-[var(--text-3)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** A yes/no the server reports — green when it is set up, amber when not. */
function Ready({ label, ok, missing }: { label: string; ok: boolean; missing?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--line-soft)] py-2 first:border-t-0">
      <span className="text-[12px] text-[var(--text-3)]">{label}</span>
      <span
        className={cn(
          'flex shrink-0 items-center gap-1.5 text-[12px] font-medium',
          ok ? 'text-green-700' : 'text-amber-700',
        )}
      >
        {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {ok ? 'configured' : (missing ?? 'not configured')}
      </span>
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-[var(--line-soft)] py-2 first:border-t-0">
      <span className="text-[12px] text-[var(--text-3)]">{label}</span>
      <span className="shrink-0 font-mono text-[12px] text-[var(--ink)]">{value || '—'}</span>
    </div>
  );
}

function TurnModelSetting() {
  const { toast } = useToast();
  const { data: cfg, isLoading, isError } = useVoiceConfig();
  const update = useUpdateVoiceConfig();

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--text-3)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
      </p>
    );
  }
  if (isError || !cfg) {
    return <p className="text-xs text-[var(--text-3)]">This backend does not expose the voice model config.</p>;
  }

  // A model the server is running but no longer offers still has to be
  // selectable, or switching away from it would look like a no-op.
  const known = cfg.choices.some((c) => c.value === cfg.voice_turn_model);
  const options = known
    ? cfg.choices
    : [...cfg.choices, { value: cfg.voice_turn_model, label: `${cfg.voice_turn_model} (in use)` }];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <PlatSelect
          value={cfg.voice_turn_model}
          onChange={(value) =>
            update.mutate(
              value,
              {
                onSuccess: () => toast({ title: 'Voice model updated', description: value || 'default' }),
                onError: (err) =>
                  toast({ title: 'Not changed', description: err.message, variant: 'destructive' }),
              },
            )
          }
          ariaLabel="Model used for each conversational turn"
        >
          {options.map((c) => (
            <option key={c.value || 'default'} value={c.value}>
              {c.label}
            </option>
          ))}
        </PlatSelect>
        {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-4)]" />}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-5)]">
        This is the model that answers each turn while someone is on the line, so it is a latency
        decision as much as a quality one. It takes effect on the next call — calls in progress keep
        the model they started with. The agent's other work uses{' '}
        <span className="font-mono">{cfg.default_model}</span>.
      </p>
    </>
  );
}

export default function VoiceSettingsView() {
  const connected = useVoiceConnected();
  const { data: status } = useVoiceStatus();
  const { i18n } = useTranslation();
  const de = i18n.language?.startsWith('de');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--line-soft)] px-6 pb-4 pt-5">
        <p className="plat-crumb" style={{ color: 'var(--text-4)' }}>
          3days.telephony
        </p>
        <h1 className="mt-1 text-[26px] text-[var(--ink)]">Settings</h1>
        <p className="mt-1 text-xs text-[var(--text-4)]">How this backend's voice stack is configured</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-6" tabIndex={0}>
        {!connected ? (
          <p className="text-sm text-[var(--text-4)]">
            Connect this browser to a Pincer backend to see its voice settings.
          </p>
        ) : (
          <>
            <Section icon={Radio} title="Voice stack" hint="reported by /api/voice/status">
              <Value label="Engine" value={status?.engine ?? ''} />
              <Value label="Default language" value={status?.language ?? ''} />
              <Value label="Consent mode" value={status?.consent_mode ?? ''} />
              <Ready label="Voice (TTS) selected" ok={!!status?.voice_configured} />
              <Ready label="Webhook base URL" ok={!!status?.webhook_base_configured} />
              <Ready label="Outbound calling" ok={!!status?.outbound_enabled} missing="off" />
              {status?.listen_in_enabled !== undefined && (
                <Ready label="Live listen-in" ok={!!status.listen_in_enabled} missing="off" />
              )}
            </Section>

            <Section icon={Cpu} title="Conversation model" hint="the only voice setting this API can change">
              <TurnModelSetting />
            </Section>

            <Section icon={Plug} title="Twilio & webhooks" hint="server-side environment">
              <p className="text-[12px] leading-relaxed text-[var(--text-3)]">
                {de
                  ? 'Twilio-Zugangsdaten und Webhook-URLs stehen in der Server-Umgebung (PINCER_TWILIO_*, PINCER_VOICE_WEBHOOK_BASE_URL). Es gibt keine API, um sie aus dem Browser zu ändern — ein Formular hier wäre ein Passwortfeld, das nichts speichert.'
                  : 'Twilio credentials and webhook URLs live in the server environment (PINCER_TWILIO_*, PINCER_VOICE_WEBHOOK_BASE_URL). There is no API to change them from a browser, and a form here would be a password field that saves nothing.'}
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-3)]">
                {de ? 'Prüfen mit ' : 'Check them with '}
                <span className="font-mono">pincer doctor</span>
                {de
                  ? ' — der Status oben ist das, was der Server gefunden hat.'
                  : ' — the status above is what the server found.'}
              </p>
            </Section>

            <Section icon={Radio} title="In-call tool policy" hint="resolved server-side, read-only">
              <PolicyPanel />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
