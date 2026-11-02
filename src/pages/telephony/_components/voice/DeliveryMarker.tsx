/**
 * Marks an agent transcript line that did not play in full. A delivery
 * failure keeps the amber ⚠; a line the caller talked over, or one the call
 * ended on, is a deliberate cut and gets a muted note instead.
 */
import { useVoiceT } from '@/i18n/voice';
import { cn } from '@/lib/utils';
import type { LineDelivery } from '@/pages/telephony/_lib/voiceMeta';

const KNOWN_REASONS = new Set(['barge_in', 'call_ended']);

export default function DeliveryMarker({
  delivery,
  reason,
  className,
}: {
  delivery: LineDelivery | null;
  reason: string;
  className?: string;
}) {
  const t = useVoiceT('voice-calls');
  if (delivery === null) return null;
  if (delivery === 'failed') {
    // Failure codes (`send_error`, `tts_failed`, …) are for whoever debugs it.
    return (
      <span className={cn('text-[10px] text-amber-600', className)} title={reason || undefined}>
        ⚠ {t('transcript.delivery.failed')}
      </span>
    );
  }
  const why = KNOWN_REASONS.has(reason) ? t(`transcript.delivery.reasons.${reason}`) : '';
  return (
    <span className={cn('text-[10px] text-[var(--text-4)]', className)}>
      {t(`transcript.delivery.${delivery}`)}
      {why && ` — ${why}`}
    </span>
  );
}
