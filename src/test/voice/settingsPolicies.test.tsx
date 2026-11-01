/**
 * Settings and Policies used to be forms of local state with a Save button
 * that only flashed green. These assertions are about the opposite: every
 * number on screen comes from the server, the one control that exists really
 * calls the API, and the things the backend cannot do are said rather than
 * mimed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DoNotCallEntry, VoiceConfig, VoiceStatus } from '@/lib/api/voice';

const addMutate = vi.fn();
const removeMutate = vi.fn();
const updateConfig = vi.fn();
const toastFn = vi.fn();

const STATUS: VoiceStatus = {
  engine: 'conversation_relay',
  language: 'en',
  consent_mode: 'one_party',
  outbound_enabled: true,
  voice_configured: true,
  webhook_base_configured: false,
  active_call_count: 0,
  listen_in_enabled: false,
};

const CONFIG: VoiceConfig = {
  voice_turn_model: 'openai:gpt-4o-mini',
  default_model: 'claude-haiku-4-5',
  choices: [
    { value: '', label: 'Default (claude-haiku-4-5)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
  ],
};

let dncEntries: DoNotCallEntry[] = [];
let dncError: { status: number; message: string } | null = null;

let declared = true;
vi.mock('@/lib/capabilities', () => ({
  // FE10: operator features with no backend show only when the capability is declared; tests toggle it.
  useCapabilities: () => ({ caps: {}, isLoading: false, isOff: () => false, isDeclared: () => declared }),
  useHealth: () => ({ data: undefined }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastFn }) }));

vi.mock('@/lib/api/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/voice')>();
  return {
    ...actual,
    useVoiceConnected: () => true,
    useVoiceStatus: () => ({ data: STATUS }),
    useVoiceConfig: () => ({ data: CONFIG, isLoading: false, isError: false }),
    useUpdateVoiceConfig: () => ({ mutate: updateConfig, isPending: false }),
    useVoicePolicy: () => ({ data: undefined, isLoading: false, isError: true }),
    useDoNotCall: () => ({
      data: dncError ? undefined : dncEntries,
      isLoading: false,
      isError: !!dncError,
      error: dncError,
    }),
    useAddDoNotCall: () => ({ mutate: addMutate, isPending: false }),
    useRemoveDoNotCall: () => ({ mutate: removeMutate, isPending: false }),
  };
});

const { default: PoliciesView } = await import('@/pages/telephony/_components/policies/PoliciesView');
const { default: VoiceSettingsView } = await import('@/pages/telephony/_components/settings/VoiceSettingsView');

beforeAll(() => {
  // Radix drives pointer capture and scrolling; jsdom implements neither.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  dncEntries = [
    { phone_number: '+4930111222', reason: 'asked on the call', source: 'call', call_sid: 'CA1' },
  ];
  dncError = null;
  addMutate.mockClear();
  removeMutate.mockClear();
  updateConfig.mockClear();
  toastFn.mockClear();
});

describe('policies', () => {
  it('lists the opt-outs the backend holds, with where each came from', () => {
    render(<PoliciesView />);
    expect(screen.getByText('+4930111222')).toBeInTheDocument();
    expect(screen.getByText(/asked on the call · via call/)).toBeInTheDocument();
  });

  it('adds a number through the API, not into local state', async () => {
    const user = userEvent.setup();
    render(<PoliciesView />);

    await user.type(screen.getByLabelText('Phone number to block'), '+4915199999');
    await user.type(screen.getByLabelText('Reason'), 'complained twice');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(addMutate).toHaveBeenCalledWith(
      { phone_number: '+4915199999', reason: 'complained twice' },
      expect.anything(),
    );
  });

  it('removes one through the API', async () => {
    const user = userEvent.setup();
    render(<PoliciesView />);

    await user.click(screen.getByRole('button', { name: /remove \+4930111222/i }));
    expect(removeMutate).toHaveBeenCalledWith('+4930111222', expect.anything());
  });

  it('surfaces the server’s own refusal rather than a friendlier guess', async () => {
    const user = userEvent.setup();
    render(<PoliciesView />);

    await user.type(screen.getByLabelText('Phone number to block'), '030 123');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    const [, handlers] = addMutate.mock.calls[0];
    handlers.onError({ message: 'Invalid phone number format: 030 123', status: 422 });
    expect(toastFn).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Invalid phone number format: 030 123' }),
    );
  });

  it('says an endpoint is missing instead of showing an empty list', () => {
    dncError = { status: 404, message: 'No /api/voice/do-not-call on this backend' };
    render(<PoliciesView />);
    expect(screen.getByText('This backend has no do-not-call endpoint yet.')).toBeInTheDocument();
  });

  it('FE10: shows the limit and retention blocks only when the backend declares limits_api', () => {
    render(<PoliciesView />);
    expect(screen.getByText('Hard limits')).toBeInTheDocument();
    expect(screen.getByText('Max call duration')).toBeInTheDocument();
    expect(screen.getByText('PINCER_VOICE_MAX_CALL_DURATION')).toBeInTheDocument();
    expect(screen.getByText('600 s')).toBeInTheDocument();
    expect(screen.getByText('20:00–08:00')).toBeInTheDocument();
    expect(screen.getByText('Retention & approvals')).toBeInTheDocument();
    expect(screen.getByText('Transcript retention')).toBeInTheDocument();
    expect(screen.getByText('90 days')).toBeInTheDocument();
    expect(screen.getByText(/Tools for guest callers/)).toBeInTheDocument();
    expect(screen.getByText(/replaces the default set/)).toBeInTheDocument();
  });

  it('FE10: hides both blocks when limits_api is not declared', () => {
    declared = false;
    try {
      render(<PoliciesView />);
      expect(screen.queryByText('Hard limits')).toBeNull();
      expect(screen.queryByText('Retention & approvals')).toBeNull();
    } finally {
      declared = true;
    }
  });

  it('marks a limit live where the status endpoint really answers it', () => {
    render(<PoliciesView />);
    const limits = screen.getByText('Hard limits').closest('section') as HTMLElement;
    // This fixture's status carries neither, so both read as defaults.
    expect(within(limits).queryByText('live')).toBeNull();
  });

  it('reports consent as the server has it, and does not offer to change it', () => {
    render(<PoliciesView />);
    const section = screen.getByText('Consent & announcement').closest('section') as HTMLElement;
    expect(within(section).getByText('one party')).toBeInTheDocument();
    expect(within(section).getByText(/PINCER_VOICE_CONSENT_MODE/)).toBeInTheDocument();
    // The limits are back as facts, not as a form: the old screen's inputs
    // and its Save button (which saved nothing) are gone.
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    // The only inputs on the page are the two that really write something.
    expect(screen.getAllByRole('textbox').map((i) => i.getAttribute('aria-label'))).toEqual([
      'Phone number to block',
      'Reason',
    ]);
  });
});

describe('settings', () => {
  it('shows what the server found, including what is missing', () => {
    render(<VoiceSettingsView />);
    expect(screen.getByText('conversation_relay')).toBeInTheDocument();
    const webhook = screen.getByText('Webhook base URL').closest('div') as HTMLElement;
    expect(within(webhook).getByText('not configured')).toBeInTheDocument();
    const listen = screen.getByText('Live listen-in').closest('div') as HTMLElement;
    expect(within(listen).getByText('off')).toBeInTheDocument();
  });

  it('changes the turn model through the API', async () => {
    const user = userEvent.setup();
    render(<VoiceSettingsView />);

    await user.click(screen.getByLabelText('Model used for each conversational turn'));
    await user.click(await screen.findByRole('option', { name: /Claude Haiku 4.5/ }));

    expect(updateConfig).toHaveBeenCalledWith('claude-haiku-4-5-20251001', expect.anything());
  });

  it('keeps the model the server is running selectable even when it is off the list', () => {
    render(<VoiceSettingsView />);
    // `openai:gpt-4o-mini` is not in `choices`; it must still be the value.
    expect(screen.getByLabelText('Model used for each conversational turn')).toHaveTextContent(
      /gpt-4o-mini \(in use\)/,
    );
  });

  it('does not pretend credentials can be edited here', () => {
    render(<VoiceSettingsView />);
    expect(screen.getByText(/no API to change them from a browser/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /test connection/i })).toBeNull();
    expect(screen.queryByText(/AC••/)).toBeNull();
  });
});
