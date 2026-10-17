/**
 * The live-call screen: an approval for this call is actionable inline, the
 * extracted outcome reads as sentences rather than the JSON blob it arrives
 * as, and the caller's history is there while you are still talking to them.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActiveCall, CallDetail, VoiceApproval } from '@/lib/api/voice';

const decideMutate = vi.fn();
const blockMutate = vi.fn();
const updateModel = vi.fn();

const CALL: ActiveCall = {
  call_sid: 'CA-live',
  direction: 'outbound',
  caller_number: '+4930111111',
  target_number: '+491622549781',
  target_name: 'Tina',
  purpose: 'test',
  engine: 'conversation_relay',
  duration_seconds: 53,
};

const OUTCOME_JSON = JSON.stringify({
  outcome: 'partial',
  task_result: 'Agent attempted to create a calendar reminder but the system refused it.',
  key_facts: ['System language was switched from English to Ukrainian'],
  commitments: [{ who: 'agent', what: 'retry the reminder', when: 'after permissions are fixed' }],
  follow_up_suggestions: [{ tool: 'calendar_system', reason: 'Retry calendar reminder creation' }],
  language: 'uk',
});

const DETAIL: CallDetail = {
  call_sid: 'CA-live',
  direction: 'outbound',
  status: 'in-progress',
  from_number: '+4930111111',
  to_number: '+491622549781',
  started_at: '2026-08-20T16:42:00Z',
  ended_at: null,
  duration_seconds: 53,
  language: 'en',
  cost_total_usd: 0.0182,
  latency: {
    turns: 6,
    p50_ms: 940,
    p95_ms: 1810,
    stages_p50: { stt: 210, llm_ttft: 420, tts: 300, total: 930 },
    per_turn: [{ turn: 6, stt_ms: 200, llm_ttft_ms: 400, tts_ms: 290, total_ms: 1_450 }],
  },
  appointment: {
    status: 'proposed',
    agreed_datetime: null,
    duration_minutes: 30,
    calendar_event_link: null,
    retry_count: 0,
  },
  transcript: [
    { speaker: 'caller', text: 'Hi Tina.', confidence: 0.98, state: 'final', timestamp: '2026-08-20T16:42:04Z' },
    {
      speaker: 'system',
      text: '{"event":"language_switch","from":"en","to":"uk","reason":"caller request"}',
      confidence: 1,
      state: 'final',
      timestamp: '2026-08-20T16:42:08Z',
    },
    { speaker: 'agent', text: 'Привіт!', confidence: 0.97, state: 'final', timestamp: '2026-08-20T16:42:08Z' },
  ],
  actions: [
    {
      action_type: 'tool_call',
      tool_name: 'calendar.create_event',
      input_summary: 'tomorrow 12:00, investor meeting',
      output_summary: '',
      user_confirmed: false,
      timestamp: '2026-08-20T16:43:00Z',
      tier: 'W',
      approval_mode: 'user',
      deny_reason: 'tier_blocked',
    },
    {
      action_type: 'outcome',
      tool_name: 'outcome',
      input_summary: '',
      output_summary: OUTCOME_JSON,
      user_confirmed: null,
      timestamp: '2026-08-20T16:43:12Z',
    },
  ],
};

const MINE: VoiceApproval = {
  id: 'apr_live',
  call_sid: 'CA-live',
  tool_name: 'calendar.create_event',
  summary: 'Create a reminder tomorrow 12:00',
  args_preview: {},
  expires_at: new Date(Date.now() + 20_000).toISOString(),
};

const SOMEONE_ELSES: VoiceApproval = { ...MINE, id: 'apr_other', call_sid: 'CA-other' };

let declared = true;
const endCall = vi.fn();
vi.mock('@/lib/capabilities', () => ({
  // FE10: operator features with no backend show only when the capability is declared; tests toggle it.
  useCapabilities: () => ({ caps: {}, isLoading: false, isOff: () => false, isDeclared: () => declared }),
  useHealth: () => ({ data: undefined }),
}));
vi.mock('@/lib/api/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/voice')>();
  return {
    ...actual,
    useLiveCallDetail: () => ({ data: DETAIL }),
    useVoiceStatus: () => ({ data: { consent_mode: 'two_party', engine: 'conversation_relay' } }),
    useVoiceConfig: () => ({
      data: { voice_turn_model: 'sonnet', default_model: 'sonnet', choices: [{ value: 'sonnet', label: 'Sonnet' }] },
    }),
    useUpdateVoiceConfig: () => ({ mutate: updateModel, isPending: false }),
    useEndCall: () => ({ mutate: endCall, isPending: false, isError: false }),
    usePendingApprovals: () => ({ approvals: [MINE, SOMEONE_ELSES], streaming: true, isLoading: false }),
    useDecideApproval: () => ({ mutate: decideMutate }),
    useCallHistoryAll: () => ({
      calls: [
        {
          call_sid: 'CA-old',
          direction: 'outbound',
          status: 'completed',
          from_number: '+4930111111',
          to_number: '+491622549781',
          started_at: '2026-08-19T10:00:00Z',
          ended_at: '2026-08-19T10:02:00Z',
          duration_seconds: 120,
          outcome: { outcome: 'confirmed' },
        },
      ],
    }),
    useMessages: () => ({ data: { messages: [], total: 0, unread: 0 } }),
    useAddToBlocklist: () => ({ mutate: blockMutate, isSuccess: false }),
  };
});

const { default: LiveCallModal } = await import('@/pages/telephony/_components/voice/LiveCallModal');

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

beforeEach(() => {
  decideMutate.mockClear();
  blockMutate.mockClear();
});

const renderModal = () => render(<LiveCallModal call={CALL} onClose={() => {}} />);

describe('live call modal', () => {
  it('puts an approval for THIS call in reach, and leaves other calls alone', async () => {
    const user = userEvent.setup();
    renderModal();

    const rows = screen.getAllByTestId('live-approval');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Create a reminder tomorrow 12:00');

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(decideMutate).toHaveBeenCalledWith(
      { id: 'apr_live', decision: 'approve' },
      expect.anything(),
    );
  });

  it('reads the extracted outcome as sentences, never as the raw JSON blob', () => {
    renderModal();
    expect(screen.getByText(/Agent attempted to create a calendar reminder/)).toBeInTheDocument();
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByText(/retry the reminder/)).toBeInTheDocument();
    // The blob itself must not reach the reader.
    expect(screen.queryByText(/"follow_up_suggestions"/)).toBeNull();
    expect(screen.queryByText(/draft_args/)).toBeNull();
  });

  it('shows the signals that say whether the call is going well', () => {
    renderModal();
    expect(screen.getByText('1.45 s')).toBeInTheDocument(); // last turn, amber
    expect(screen.getByText('$0.018')).toBeInTheDocument();
    expect(screen.getByText('Українська')).toBeInTheDocument(); // language after the switch
    expect(screen.getByText('6')).toBeInTheDocument(); // turns
  });

  it('carries the v3 gate detail into the live action list', () => {
    renderModal();
    const row = screen.getByTestId('call-action-row');
    expect(row).toHaveAttribute('data-denied', 'true');
    expect(screen.getByTestId('deny-reason').textContent).toMatch(/Blocked by policy/i);
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  it('shows the booking it is making while it is making it', () => {
    renderModal();
    expect(screen.getByText('Booking in progress')).toBeInTheDocument();
    expect(screen.getByText(/booking: proposed/)).toBeInTheDocument();
  });

  it('tells you who this is, and can block them without ending the call', async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByText(/1 previous call · last: confirmed/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /block caller/i }));
    expect(blockMutate).not.toHaveBeenCalled(); // confirms first
    await user.click(screen.getByRole('button', { name: /block for good/i }));
    expect(blockMutate).toHaveBeenCalledWith({
      number: '+491622549781',
      reason: 'blocked during a live call',
    });
  });

  it('FE10: call controls exist only when the backend declares them; End call hangs up the real call', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /whisper/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /end call/i }));
    expect(endCall).toHaveBeenCalledWith(CALL.call_sid);
    // …while the things that DO work are enabled.
    expect(screen.getByRole('button', { name: /copy transcript/i })).toBeEnabled();
  });

  it('FE10: hides the call controls when the capability is not declared', () => {
    declared = false;
    try {
      renderModal();
      expect(screen.queryByRole('button', { name: /end call/i })).toBeNull();
      expect(screen.getByRole('button', { name: /copy transcript/i })).toBeEnabled();
    } finally {
      declared = true;
    }
  });
});
