/**
 * The rail's "Planned" screen: the calls the server is holding for later.
 *
 * Every row comes from `GET /api/voice/calls/scheduled` and is cancelled with
 * `DELETE /api/voice/calls/scheduled/{id}` — the backend dials them. The local
 * "call queue" that used to share this page was a localStorage list nothing
 * ever dialed, and it is gone along with the composer tab that filled it.
 */
import { useState } from 'react';
import {
  CalendarClock,
  PhoneOutgoing,
  Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import StartCallModal from '@/pages/telephony/_components/voice/StartCallModal';
import { useCancelScheduledCall, useScheduledCalls } from '@/lib/api/voice';
import { leadTimeLabel, type PlannedCall } from '@/pages/telephony/_lib/planned';

/** The server answers in UTC; a scheduled call is read on a wall clock. */
function fmtWhen(at: string): string {
  const d = new Date(at.includes('T') ? at : at.replace(' ', 'T'));
  return isNaN(d.getTime()) ? at : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function label(entry: PlannedCall): string {
  const who = entry.numbers[0];
  return who?.name || who?.number || 'Unknown';
}

export default function PlannedCallsView() {
  const { data: scheduledCalls, isError: scheduledError } = useScheduledCalls();
  const cancelScheduled = useCancelScheduledCall();
  const [composer, setComposer] = useState<{ number: string; name: string; purpose: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  // Server-side entries, shown in the same shape the list already renders.
  const scheduled: PlannedCall[] = (scheduledCalls ?? []).map((c) => ({
    id: String(c.id),
    kind: 'scheduled' as const,
    numbers: [{ number: c.target_number, name: c.target_name }],
    purpose: c.purpose,
    at: c.next_run_at,
    created: c.created_at ?? '',
  }));

  const cancel = (entry: PlannedCall) => cancelScheduled.mutate(Number(entry.id));

  const Section = ({
    title,
    icon: Icon,
    items,
    empty,
  }: {
    title: string;
    icon: typeof CalendarClock;
    items: PlannedCall[];
    empty: string;
  }) => (
    <div>
      <p className="plat-eyebrow mb-2.5 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[var(--line)] px-4 py-5 text-center text-xs text-[var(--text-5)]">
          {empty}
        </p>
      ) : (
        <Card className="overflow-hidden border-[var(--line-soft)] bg-[var(--paper)]">
          <table className="w-full text-sm">
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--line-soft)] last:border-b-0">
                  <td className="w-full max-w-0 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex-shrink-0 rounded-[10px] bg-[var(--sand)] p-2"
                      >
                        <CalendarClock className="h-4 w-4 text-[var(--ink)]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--ink)]">
                          {label(entry)}
                          {entry.at && (
                            <span className="ml-2 text-xs font-normal text-[var(--brand)]">
                              {fmtWhen(entry.at)}
                              <span className="ml-1.5 text-[var(--text-5)]">
                                {leadTimeLabel(entry.at)}
                              </span>
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-[var(--text-4)]">{entry.purpose}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const first = entry.numbers[0];
                          setComposer({
                            number: first?.number ?? '',
                            name: first?.name ?? '',
                            purpose: entry.purpose,
                          });
                          setComposerOpen(true);
                        }}
                        className="flex h-7 items-center gap-1.5 rounded-full bg-[var(--ink)] px-2.5 text-xs font-medium text-[var(--on-ink)] hover:opacity-85"
                        title="Open in the composer and dial for real"
                      >
                        <PhoneOutgoing className="h-3 w-3" />
                        Call now instead
                      </button>
                      <button
                        type="button"
                        onClick={() => cancel(entry)}
                        className="rounded-full p-1.5 text-[var(--text-5)] hover:bg-[var(--sand-deep)] hover:text-[var(--text-3)]"
                        aria-label="Delete planned entry"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] px-6 pt-5 pb-4">
          <div>
            <p className="plat-crumb" style={{ color: 'var(--text-4)' }}>3days.telephony</p>
            <h1 className="mt-1 text-[26px] text-[var(--ink)]">Planned</h1>
            <p className="mt-1 text-xs text-[var(--text-4)]">
              Calls the assistant will place for you
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setComposer(null);
              setComposerOpen(true);
            }}
            className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--ink)] px-3.5 text-xs font-medium text-[var(--on-ink)] transition-colors hover:opacity-85"
          >
            <PhoneOutgoing className="h-3.5 w-3.5" />
            New call
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <Section
            title="Scheduled calls"
            icon={CalendarClock}
            items={scheduled}
            empty="Nothing here — real appointments are booked from the composer's Schedule appointment tab and appear in the call history."
          />
        </div>
      </div>

      {composerOpen && (
        <StartCallModal
          onClose={() => {
            setComposerOpen(false);
          }}
          initialMode="now"
          initialNumber={composer?.number ?? ''}
          initialName={composer?.name ?? ''}
          initialPurpose={composer?.purpose ?? ''}
        />
      )}
    </div>
  );
}
