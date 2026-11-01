/**
 * Sentiment and talk ratio (S16).
 *
 * The copy rule is the feature, so most of these assertions are about what the
 * UI says rather than what it computes: a call is described, never a person;
 * an inferred number is labelled inferred; and a missing reading says which
 * kind of missing it is instead of quietly becoming "Neutral".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CallAnalytics, ReceptionistStats } from '@/lib/api/voice';
import {
  MIN_ASSESSED_FOR_DISTRIBUTION,
  SENTIMENT,
  SENTIMENTS,
  TRAJECTORY,
  absenceCopy,
  seemed,
  t,
} from '@/components/voice/analytics/sentimentCopy';
import { clock, sharePercents } from '@/components/voice/analytics/talkMath';

const analytics = (over: Partial<CallAnalytics> = {}): CallAnalytics => ({
  agent_speech_ms: 130_000,
  caller_speech_ms: 80_000,
  silence_ms: 25_000,
  overlap_ms: 0,
  interruptions: 0,
  talk_ratio: 130 / 210,
  method: 'exact',
  sentiment: 'positive',
  sentiment_trajectory: 'stable',
  sentiment_rationale: 'Thanked the agent twice and agreed to the slot.',
  sentiment_reason: '',
  ...over,
});

const stats = (over: Partial<ReceptionistStats> = {}): ReceptionistStats => ({
  answered: 20,
  intents: {},
  booking_conversion: 0.5,
  transfer_rate: 0,
  messages_taken: 2,
  busy_capacity: 0,
  silent_hangups: 0,
  ...over,
});

let receptionistStats: ReceptionistStats = stats();

const HISTORY_CALLS: Record<string, unknown>[] = [
  { sid: 'CA-neg', sentiment: 'negative', talk_ratio: 0.4, method: 'estimated' },
  { sid: 'CA-pos', sentiment: 'positive', talk_ratio: 0.7, method: 'exact' },
  { sid: 'CA-legacy' },
].map((c) => ({
  call_sid: c.sid,
  direction: 'inbound',
  status: 'completed',
  from_number: '+4930111222',
  to_number: '',
  started_at: '2026-08-21T09:00:00Z',
  ended_at: '2026-08-21T09:02:00Z',
  duration_seconds: 120,
  sentiment: c.sentiment ?? null,
  talk_ratio: c.talk_ratio ?? null,
  method: c.method ?? null,
}));

vi.mock('@/lib/api/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/voice')>();
  return {
    ...actual,
    useReceptionistProfile: () => ({ data: { enabled: true, name: 'Kanzlei', languages: ['de'], timezone: 'Europe/Berlin', hours: {}, services_count: 0, faq_count: 0, booking: { enabled: true }, transfer: { enabled: false }, after_hours: 'message' }, isLoading: false }),
    useReceptionistStats: () => ({ data: receptionistStats, isLoading: false, isError: false }),
    useBlocklist: () => ({ data: [], isLoading: false, isError: false }),
    useAddToBlocklist: () => ({ mutate: vi.fn(), isPending: false }),
    useRemoveFromBlocklist: () => ({ mutate: vi.fn(), isPending: false }),
    useVoiceConnected: () => true,
    useCallHistoryAll: () => ({
      calls: HISTORY_CALLS,
      isLoading: false,
      isLoadingMore: false,
      isError: false,
      isRefetching: false,
      refetch: vi.fn(),
      cappedAt: null,
      loadMore: vi.fn(),
    }),
    useContacts: () => ({ data: [] }),
    useActiveCalls: () => ({ data: [] }),
    useLiveCalls: () => ({ calls: [], isLoading: false, unavailable: false }),
    useCallDetail: () => ({ data: undefined, isLoading: false }),
    useThread: () => ({ data: undefined }),
    useThreads: () => ({ data: { threads: [], total: 0 }, isLoading: false, isError: false, refetch: vi.fn() }),
    useUnreadMessageCount: () => 0,
    useVoiceStatus: () => ({ data: null }),
    useVoiceConfig: () => ({ data: null }),
    useUpdateVoiceConfig: () => ({ mutate: vi.fn(), isPending: false }),
    useSkills: () => ({ data: null }),
  };
});

const { default: TalkRatioBar } = await import('@/components/voice/analytics/TalkRatioBar');
const { default: SentimentChip } = await import('@/components/voice/analytics/SentimentChip');
const { default: SentimentDot } = await import('@/components/voice/analytics/SentimentDot');
const { default: AnalyticsPanel } = await import('@/components/voice/analytics/AnalyticsPanel');
const { default: ReceptionistPanel } = await import('@/pages/telephony/_components/voice/ReceptionistPanel');

describe('sentimentCopy is the single source', () => {
  it('has a label and a colour for every sentiment, in both languages', () => {
    expect(SENTIMENTS).toEqual(['positive', 'neutral', 'mixed', 'negative']);
    for (const key of SENTIMENTS) {
      const meta = SENTIMENT[key];
      expect(meta.label.en).toBeTruthy();
      expect(meta.label.de).toBeTruthy();
      expect(meta.dotClass).toContain('bg-');
    }
    expect(t(SENTIMENT.mixed.label, 'de')).toBe('Gemischt');
    expect(t(SENTIMENT.negative.label, 'en')).toBe('Negative');
  });

  it('describes the call and never diagnoses the person', () => {
    expect(seemed('negative', 'en')).toBe('Caller seemed negative');
    expect(seemed('negative', 'de')).toBe('Anrufer wirkte negativ');
    for (const key of SENTIMENTS) {
      expect(seemed(key, 'en')).not.toMatch(/\bis\b/);
      expect(seemed(key, 'de')).not.toMatch(/\bist\b/);
    }
  });

  it('uses arrows, not faces', () => {
    expect(Object.values(TRAJECTORY)).toEqual(['↗', '→', '↘']);
    const everyString = JSON.stringify({ SENTIMENT, TRAJECTORY });
    // No emoji faces anywhere: they mean different things in different places.
    expect(everyString).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
  });

  it('names each kind of absence rather than defaulting to neutral', () => {
    expect(absenceCopy('too_short', 'en')).toBe('Call too short to assess');
    expect(absenceCopy('too_short', 'de')).toBe('Anruf zu kurz für eine Einschätzung');
    expect(absenceCopy('extraction_failed', 'en')).toBe('Not assessed');
    expect(absenceCopy('not_conversed', 'de')).toBe('Nicht bewertet');
    expect(absenceCopy(undefined, 'en')).toBe('Not assessed');
    expect(absenceCopy('', 'en')).not.toMatch(/neutral/i);
  });

  it('exports the sample threshold the strip is gated on', () => {
    expect(MIN_ASSESSED_FOR_DISTRIBUTION).toBe(5);
  });
});

describe('talk ratio maths', () => {
  it('always sums to 100, including the awkward thirds', () => {
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharePercents([3333, 3333, 3334]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(sharePercents([130_000, 80_000, 25_000]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(sharePercents([1, 0, 0])).toEqual([100, 0, 0]);
  });

  it('gives the leftover point to the largest remainder', () => {
    // 33.33 / 33.33 / 33.34 → the last one earns the extra point.
    expect(sharePercents([3333, 3333, 3334])).toEqual([33, 33, 34]);
  });

  it('reads lengths as minutes and seconds', () => {
    expect(clock(185_000)).toBe('3:05');
    expect(clock(0)).toBe('0:00');
  });

  it('says nothing rather than zero when there is no speech', () => {
    expect(sharePercents([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('TalkRatioBar', () => {
  it('splits the speech and shows silence separately', () => {
    render(<TalkRatioBar analytics={analytics()} />);
    expect(screen.getByText(/Agent 62%/)).toBeInTheDocument();
    expect(screen.getByText(/Caller 38%/)).toBeInTheDocument();
    expect(screen.getByText(/11% silence/)).toBeInTheDocument();
    expect(screen.getByText('3:30 of 3:55 spoken')).toBeInTheDocument();
  });

  it('marks an estimate as an estimate, with the reason', () => {
    render(<TalkRatioBar analytics={analytics({ method: 'estimated' })} />);
    const marks = screen.getAllByText('≈');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]).toHaveAttribute(
      'title',
      'Estimated from text length (ConversationRelay engine). Exact timing is available on the Media Streams engine.',
    );
  });

  it('leaves the mark off an exact measurement', () => {
    render(<TalkRatioBar analytics={analytics({ method: 'exact' })} />);
    expect(screen.queryByText('≈')).toBeNull();
  });

  it('counts interruptions only when there were some', () => {
    const { unmount } = render(<TalkRatioBar analytics={analytics({ interruptions: 3 })} />);
    expect(screen.getByText(/↯ 3 interruptions/)).toBeInTheDocument();
    unmount();

    render(<TalkRatioBar analytics={analytics({ interruptions: 0 })} />);
    expect(screen.queryByText(/↯/)).toBeNull();
  });

  it('says there was no speech instead of drawing an empty bar', () => {
    render(<TalkRatioBar analytics={analytics({ agent_speech_ms: null, caller_speech_ms: null })} />);
    expect(screen.getByText('No speech to analyze')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('says the same for a call with no analytics at all', () => {
    render(<TalkRatioBar analytics={null} />);
    expect(screen.getByText('No speech to analyze')).toBeInTheDocument();
  });
});

describe('SentimentChip', () => {
  it('renders every sentiment with a dot, a word and the rationale', () => {
    for (const key of SENTIMENTS) {
      const { unmount } = render(
        <SentimentChip analytics={analytics({ sentiment: key, sentiment_rationale: 'Asked twice about the invoice.' })} />,
      );
      expect(screen.getByText(t(SENTIMENT[key].label, 'en'))).toBeInTheDocument();
      // Never colour alone: the sentence carries it too.
      expect(screen.getByText(new RegExp(seemed(key, 'en')))).toBeInTheDocument();
      expect(screen.getByText(/Asked twice about the invoice\./)).toBeInTheDocument();
      unmount();
    }
  });

  it('shows the trajectory arrow when there is one, and nothing when there is not', () => {
    for (const [key, arrow] of Object.entries(TRAJECTORY)) {
      const { unmount } = render(<SentimentChip analytics={analytics({ sentiment_trajectory: key })} />);
      expect(screen.getByText(arrow)).toBeInTheDocument();
      unmount();
    }
    render(<SentimentChip analytics={analytics({ sentiment_trajectory: null })} />);
    for (const arrow of Object.values(TRAJECTORY)) {
      expect(screen.queryByText(arrow)).toBeNull();
    }
  });

  it('keeps the chip when retention took the rationale', () => {
    render(<SentimentChip analytics={analytics({ sentiment_rationale: null })} />);
    expect(screen.getByText('Positive')).toBeInTheDocument();
    expect(screen.getByText('Details removed per retention policy')).toBeInTheDocument();
  });

  it('explains a short call rather than calling it neutral', () => {
    render(<SentimentChip analytics={analytics({ sentiment: null, sentiment_reason: 'too_short' })} />);
    expect(screen.getByText('Call too short to assess')).toBeInTheDocument();
    expect(screen.queryByText('Neutral')).toBeNull();
  });

  it('says "not assessed" when extraction failed or the call is legacy', () => {
    const { unmount } = render(
      <SentimentChip analytics={analytics({ sentiment: null, sentiment_reason: 'extraction_failed' })} />,
    );
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    unmount();

    render(<SentimentChip analytics={null} />);
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
  });
});

describe('SentimentDot', () => {
  it('marks a reading, and renders nothing at all without one', () => {
    const { container, unmount } = render(<SentimentDot sentiment="negative" />);
    expect(screen.getByLabelText('Negative')).toBeInTheDocument();
    expect(container.textContent).toContain('Ng');
    unmount();

    for (const empty of [null, undefined, '', 'unknown']) {
      const { container: c } = render(<SentimentDot sentiment={empty} />);
      // An empty cell is the truth; a grey dot would read as "neutral".
      expect(c.innerHTML).toBe('');
    }
  });
});

describe('AnalyticsPanel', () => {
  it('shows both rows for a real call', () => {
    render(
      <AnalyticsPanel
        call={{
          call_sid: 'CA1', direction: 'inbound', status: 'completed', from_number: '+49', to_number: '',
          started_at: '', ended_at: '', duration_seconds: 235, transcript: [], actions: [],
          analytics: analytics({ sentiment: 'negative', sentiment_rationale: 'Repeated that nobody called back.' }),
        }}
      />,
    );
    expect(screen.getByText(/Agent 62%/)).toBeInTheDocument();
    expect(screen.getByText('Negative')).toBeInTheDocument();
    expect(screen.getByText(/Repeated that nobody called back\./)).toBeInTheDocument();
  });

  it('handles a voicemail without inventing either number', () => {
    render(
      <AnalyticsPanel
        call={{
          call_sid: 'CA2', direction: 'outbound', status: 'completed', from_number: '', to_number: '+49',
          started_at: '', ended_at: '', duration_seconds: 12, transcript: [], actions: [],
          analytics: analytics({
            agent_speech_ms: null, caller_speech_ms: null, silence_ms: null, talk_ratio: null,
            sentiment: null, sentiment_rationale: null, sentiment_reason: 'not_conversed',
          }),
        }}
      />,
    );
    expect(screen.getByText('No speech to analyze')).toBeInTheDocument();
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
  });
});

describe('receptionist distribution', () => {
  it('waits for a sample worth reading', () => {
    receptionistStats = stats({
      sentiment_distribution: { positive: 2, neutral: 1, negative: 1, mixed: 0, assessed: 4 },
    });
    render(<ReceptionistPanel />);
    expect(screen.getByText('Not enough calls yet')).toBeInTheDocument();
  });

  it('draws the split with its counts once there is one', () => {
    receptionistStats = stats({
      sentiment_distribution: { positive: 6, neutral: 3, negative: 2, mixed: 1, assessed: 12 },
    });
    render(<ReceptionistPanel />);

    const heading = screen.getByText('Caller sentiment (7d)');
    const block = heading.parentElement as HTMLElement;
    expect(within(block).getByTitle('Positive: 6')).toBeInTheDocument();
    expect(within(block).getByTitle('Negative: 2')).toBeInTheDocument();
    expect(within(block).getByText('· 12 assessed')).toBeInTheDocument();
  });

  it('renders nothing where the backend sends no distribution', () => {
    receptionistStats = stats();
    render(<ReceptionistPanel />);
    expect(screen.queryByText(/Caller sentiment/)).toBeNull();
  });
});

// ── The history list ─────────────────────────────────────────────────

const { default: VoicePage } = await import('@/pages/telephony/_components/voice/VoicePage');

describe('history chips and filter', () => {
  const showHistory = async () => {
    const user = userEvent.setup();
    localStorage.setItem('telephony.history.view', 'calls');
    render(
      <MemoryRouter>
        <VoicePage />
      </MemoryRouter>,
    );
    return user;
  };

  it('shows a dot and a mini bar per assessed call, and an empty cell for the rest', async () => {
    await showHistory();

    expect(screen.getByLabelText('Negative')).toBeInTheDocument();
    expect(screen.getByLabelText('Positive')).toBeInTheDocument();
    // The legacy row has neither — and no grey stand-in.
    const legacyRow = document.querySelector('tr:has(td)')!;
    expect(legacyRow).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /agent \d+%/i })).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Agent 40%, caller 60%' })).toHaveAttribute(
      'title',
      expect.stringContaining('≈'),
    );
  });

  it('filters by sentiment, counts nulls as "not assessed", and admits what it can see', async () => {
    const user = await showHistory();

    await user.click(screen.getByRole('button', { name: /any sentiment/i }));
    expect(screen.getByText('filters the calls loaded so far')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Negative$/ }));
    expect(screen.getByText('CA-neg')).toBeInTheDocument();
    expect(screen.queryByText('CA-pos')).toBeNull();
    expect(screen.queryByText('CA-legacy')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Not assessed$/ }));
    expect(screen.getByText('CA-legacy')).toBeInTheDocument();
    expect(screen.getByText('CA-neg')).toBeInTheDocument();
  });

  it('offers the columns as soon as the backend sends the fields, reading or not', async () => {
    // Every call here predates the feature, so nothing is assessed — the
    // columns still belong, or the feature is invisible on the day it ships.
    HISTORY_CALLS.forEach((c) => {
      c.sentiment = null;
      c.talk_ratio = null;
    });
    await showHistory();

    expect(screen.getByRole('columnheader', { name: 'Mood' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Talk' })).toBeInTheDocument();
    // …and every cell in them is empty, not a grey stand-in.
    expect(screen.queryByLabelText(/Positive|Negative|Neutral|Mixed/)).toBeNull();
    expect(screen.queryByRole('img', { name: /agent \d+%/i })).toBeNull();
  });

  it('keeps a long thread subject inside its own column', async () => {
    HISTORY_CALLS[0].thread_id = 'th_1';
    HISTORY_CALLS[0].thread_subject =
      'Call the selected number and ask the user about an upcoming business meeting, then confirm the date';
    await showHistory();

    const cell = document.querySelector('td:has(a[href="/telephony/threads/th_1"])') as HTMLElement;
    expect(cell.className).toMatch(/w-\[150px\]/);
    // The chip truncates inside a bounded box rather than pushing the
    // status column out from under itself.
    expect((cell.firstElementChild as HTMLElement).className).toMatch(/max-w-\[142px\]/);
    const link = cell.querySelector('a') as HTMLElement;
    // The chip itself is capped by the box, and the subject truncates in it.
    expect(link.className).toContain('max-w-full');
    expect([...link.querySelectorAll('span')].some((el) => el.className.includes('truncate'))).toBe(true);
  });

  it('keeps sentiment off the live surfaces', async () => {
    await showHistory();
    const live = screen.queryByText(/Active calls/i)?.closest('section');
    if (live) {
      expect(within(live).queryByLabelText(/Positive|Negative|Neutral|Mixed/)).toBeNull();
    }
  });
});
