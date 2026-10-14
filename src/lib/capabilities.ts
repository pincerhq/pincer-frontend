/**
 * Feature flags from the backend (FE-BINDING: "Feature flags from backend").
 *
 * Read from `GET /api/voice/status` (+ `GET /api/health` for the version) and
 * exposed as a tri-state per feature:
 *   - `true`      the backend says it is on
 *   - `false`     the backend says it is off → the nav item is hidden, never
 *                 merely disabled without explanation (T-FE0.2)
 *   - `undefined` the backend predates the flag → shown, badged by its surface
 *
 * The `capabilities` object on VoiceStatus is an FE0 API ask (see
 * docs/app/FE0-audit.md §7). Until it lands, the flags that already exist on
 * the status body are mapped here so gating is real where it can be.
 */
import { useQuery } from "@tanstack/react-query";
import { api, type Schema } from "@/lib/api/client";
import { useVoiceConnected, useVoiceStatus } from "@/lib/api/voice";

/** How often `useHealth()` polls /api/health; the offline countdown reads it too. */
export const HEALTH_POLL_MS = 30_000;

export type CapabilityKey =
  | "voice"
  | "outbound"
  | "listen_in"
  | "campaigns"
  | "knowledge"
  | "sip"
  | "followups"
  | "widget"
  | "call_queues"
  | "call_controls"
  | "limits_api";

export type Capabilities = Partial<Record<CapabilityKey, boolean>> & {
  residency_mode?: string;
};

type StatusWithCapabilities = Schema<"VoiceStatus"> & {
  capabilities?: Partial<Record<string, unknown>>;
};

function asFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function capabilitiesFromStatus(status: StatusWithCapabilities | undefined | null): Capabilities {
  if (!status) return {};
  const declared = status.capabilities ?? {};
  return {
    voice: asFlag(status.enabled),
    outbound: asFlag(status.outbound_enabled),
    listen_in: asFlag(status.listen_in_enabled),
    campaigns: asFlag(declared.campaigns),
    knowledge: asFlag(declared.knowledge),
    sip: asFlag(declared.sip),
    followups: asFlag(declared.followups),
    widget: asFlag(declared.widget),
    call_queues: asFlag(declared.call_queues),
    call_controls: asFlag(declared.call_controls),
    limits_api: asFlag(declared.limits_api),
    residency_mode: typeof declared.residency_mode === "string" ? declared.residency_mode : undefined,
  };
}

export interface HealthInfo {
  status?: string;
  version?: string;
}

export function useHealth() {
  const connected = useVoiceConnected();
  return useQuery<HealthInfo>({
    queryKey: ["health"],
    queryFn: () => api.get<HealthInfo>("/api/health"),
    enabled: connected,
    // FE1 §5: ['health'] every 30 s; the banner calls it offline after two misses.
    staleTime: HEALTH_POLL_MS,
    refetchInterval: HEALTH_POLL_MS,
    retry: false,
  });
}

/**
 * Flags only — deliberately not joined with `useHealth()`, so the navigation
 * needs exactly one query (the status the rail already polls) and nothing
 * else. Surfaces that show the backend version call `useHealth()` themselves.
 */
export function useCapabilities() {
  const status = useVoiceStatus();
  const caps = capabilitiesFromStatus(status.data as StatusWithCapabilities | undefined);
  return {
    caps,
    isLoading: status.isLoading,
    /** True only when the backend explicitly reported the feature off. */
    isOff: (key: CapabilityKey) => caps[key] === false,
    /** FE10: surfaces with no backend at all show only when the backend declares them (undeclared → hidden). */
    isDeclared: (key: CapabilityKey) => caps[key] === true,
  };
}
