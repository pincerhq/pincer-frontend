/**
 * Integrations — REAL state from the connected Pincer backend, nothing else.
 *
 * Every connection is the SAME block: icon, name, status, what it gives you,
 * and one footer action. Authorized and unauthorized sit side by side in one
 * grid rather than in differently-shaped sections, so the page reads as a
 * single inventory: here is everything the agent can reach, and here is where
 * each one stands.
 *
 * Three kinds of connection come back from GET /api/integrations:
 *   source "integration"  Google Workspace / Slack — the two services Pincer
 *                         can authorize. `status: active` means the credential
 *                         file is really on disk.
 *   source "mcp"          MCP tool servers from the agent's config; `status`
 *                         follows the server's enabled flag.
 *   source "builtin"      core tools — always on, nothing to authorize; shown
 *                         as one block listing them.
 *
 * Authorization runs on the machine hosting the agent (`pincer setup-google`
 * opens Google's consent screen, `pincer setup-slack` takes a bot token).
 * There is no browser OAuth endpoint, so an unauthorized block hands over the
 * exact command instead of a Connect button that could not work.
 */
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Blocks,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Wrench,
} from 'lucide-react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/dashboard/AppSidebar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { queryClient } from '@/lib/queryClient';
import { isConnected } from '@/lib/pincerClient';
import {
  AUTHORIZABLE,
  groupIntegrations,
  useIntegrationDetail,
  useIntegrations,
  type IntegrationEntry,
} from '@/lib/api/integrations';
import { useToast } from '@/hooks/use-toast';
import '@/styles/platform.css';

// ── Shared bits ──────────────────────────────────────────────────────

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <h2 className="plat-eyebrow">{label}</h2>
      {hint && <span className="text-[11px]" style={{ color: 'var(--text-5)' }}>{hint}</span>}
      <div className="h-px flex-1" style={{ background: 'var(--line-soft)' }} />
    </div>
  );
}

/** Mono command with a copy button — the only honest "connect" affordance. */
function CommandRow({ command }: { command: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="flex items-center gap-2 rounded-[10px] px-3 py-2"
      style={{ background: 'var(--sand)' }}
    >
      <Terminal className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-5)' }} />
      <code className="flex-1 truncate font-mono text-xs" style={{ color: 'var(--ink)' }}>
        {command}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          toast({ title: 'Command copied', description: 'Run it where the agent is installed.' });
        }}
        className="shrink-0 rounded-md p-1 transition-colors hover:bg-[rgba(20,22,26,0.06)]"
        style={{ color: copied ? 'var(--ok-fg)' : 'var(--text-4)' }}
        aria-label="Copy command"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ── One block shape for every connection ─────────────────────────────

type Kind = 'service' | 'mcp';

interface Connection {
  key: string;
  kind: Kind;
  name: string;
  description: string;
  /** Live = authorized service or enabled MCP server. */
  live: boolean;
  /** Right-hand meta on the header row (tool count, transport). */
  meta: string;
  slug?: string;
}

/** Turn both backend shapes into the same block model, live ones first. */
function toConnections(
  services: IntegrationEntry[],
  mcp: IntegrationEntry[],
): Connection[] {
  const items: Connection[] = [
    ...services.map((e) => ({
      key: `svc-${e.name}`,
      kind: 'service' as const,
      name: e.name,
      description: e.description,
      live: e.status === 'active',
      meta: e.version ?? '',
      slug: e.slug,
    })),
    ...mcp.map((e) => ({
      key: `mcp-${e.name}`,
      kind: 'mcp' as const,
      name: e.name,
      description: e.description,
      live: e.status === 'active',
      meta: e.version ?? 'mcp',
    })),
  ];
  return items.sort((a, b) => Number(b.live) - Number(a.live));
}

function ConnectionBlock({
  conn,
  onOpenDetail,
}: {
  conn: Connection;
  onOpenDetail: (slug: string) => void;
}) {
  const how = conn.slug ? AUTHORIZABLE[conn.slug] : undefined;
  const Icon = conn.kind === 'mcp' ? Server : conn.live ? ShieldCheck : KeyRound;

  return (
    <div className="plat-panel flex h-full flex-col">
      {/* Header — identical across every block */}
      <div className="flex items-start gap-3">
        <span className="plat-item-icon !h-11 !w-11 !rounded-[10px]">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="plat-item-title">{conn.name}</p>
            <span className={conn.live ? 'plat-pill plat-pill-ok' : 'plat-pill plat-pill-mute'}>
              {conn.live && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--ok-fg)' }} />
              )}
              {conn.kind === 'service'
                ? conn.live
                  ? 'authorized'
                  : 'not authorized'
                : conn.live
                  ? 'enabled'
                  : 'disabled'}
            </span>
          </div>
          <p className="plat-item-sub mt-1 line-clamp-2">{conn.description}</p>
        </div>
      </div>

      {/* Body — what it is / how it authorizes */}
      <div className="mt-3 space-y-1">
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          {conn.kind === 'mcp'
            ? 'MCP tool server from the agent configuration'
            : how
              ? how.method
              : 'First-party integration'}
        </p>
        {!conn.live && conn.kind === 'service' && how && (
          <p className="text-xs" style={{ color: 'var(--text-4)' }}>
            Needs first: {how.prerequisite}
          </p>
        )}
        {!conn.live && conn.kind === 'mcp' && (
          <p className="text-xs" style={{ color: 'var(--text-4)' }}>
            Configured but switched off — enable it in the agent's MCP config.
          </p>
        )}
      </div>

      {/* Footer — always present, always the same slot */}
      <div className="mt-auto pt-4">
        {conn.kind === 'service' && conn.live && conn.slug && (
          <button
            type="button"
            onClick={() => onOpenDetail(conn.slug!)}
            className="plat-btn-ghost w-full justify-center"
          >
            View tools and usage
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        )}
        {conn.kind === 'service' && !conn.live && how && (
          <>
            <CommandRow command={how.command} />
            <a
              href={how.docs}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold hover:opacity-70"
              style={{ color: 'var(--ink)' }}
            >
              Open the provider console
              <ExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
        {conn.kind === 'mcp' && (
          <div
            className="flex items-center gap-2 rounded-[10px] px-3 py-2"
            style={{ background: 'var(--sand)' }}
          >
            <Terminal className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-5)' }} />
            <code className="flex-1 truncate font-mono text-xs" style={{ color: 'var(--text-2)' }}>
              {conn.description}
            </code>
          </div>
        )}
        <p className="mt-2.5 font-mono text-[11px]" style={{ color: 'var(--text-5)' }}>
          {conn.kind === 'service'
            ? `${conn.meta}${conn.live ? ' · credentials on disk' : ' · available once connected'}`
            : `transport: ${conn.meta}`}
        </p>
      </div>
    </div>
  );
}

// ── Built-in tools: one block, not one card each ─────────────────────

function BuiltinBlock({ entries }: { entries: IntegrationEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(0, 6);
  return (
    <div className="plat-panel">
      <div className="flex items-start gap-3">
        <span className="plat-item-icon !h-11 !w-11 !rounded-[10px]">
          <Wrench className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="plat-item-title">Built-in tools</p>
            <span className="plat-pill plat-pill-ok">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--ok-fg)' }} />
              always on
            </span>
          </div>
          <p className="plat-item-sub mt-1">
            Shipped with the agent — nothing to authorize
          </p>
        </div>
      </div>

      {entries.length ? (
        <>
          <div className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {shown.map((e) => (
              <div
                key={e.name}
                className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0"
                style={{ borderColor: 'var(--line-soft)' }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs" style={{ color: 'var(--ink)' }}>
                    {e.name}
                  </span>
                  <span className="block truncate text-[11px]" style={{ color: 'var(--text-4)' }}>
                    {e.description}
                  </span>
                </span>
                {e.approval_required && (
                  <span className="plat-pill plat-pill-warn shrink-0">approval</span>
                )}
              </div>
            ))}
          </div>
          {entries.length > 6 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 text-xs font-semibold hover:opacity-70"
              style={{ color: 'var(--ink)' }}
            >
              {expanded ? 'Show fewer' : `Show all ${entries.length}`}
            </button>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm" style={{ color: 'var(--text-4)' }}>
          The backend reported no built-in tools.
        </p>
      )}
    </div>
  );
}

// ── Detail: tool catalog + real call counts ──────────────────────────

function DetailModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { data, isLoading } = useIntegrationDetail(slug);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl gap-0 rounded-[14px] p-0">
        <div className="border-b px-6 py-4" style={{ borderColor: 'var(--line-soft)' }}>
          <DialogTitle className="text-base">{data?.name ?? 'Integration'}</DialogTitle>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-4)' }}>
            {data
              ? `${data.tool_count} tools · ${data.usage.total_calls} calls recorded in the audit log`
              : 'Loading tool catalog…'}
          </p>
        </div>
        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 py-4">
          {isLoading && (
            <p className="text-sm" style={{ color: 'var(--text-4)' }}>Reading the tool registry…</p>
          )}
          {data?.categories.map((cat) => (
            <div key={cat.name}>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="plat-eyebrow">{cat.name}</p>
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-5)' }}>
                  {cat.tools.length} tools
                </span>
              </div>
              <div className="plat-list">
                {cat.tools.map((t) => {
                  const calls = data.usage.by_tool[t.name] ?? 0;
                  return (
                    <div key={t.name} className="plat-row !py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs" style={{ color: 'var(--ink)' }}>
                          {t.name}
                        </span>
                        {t.description && (
                          <span className="block truncate text-[11px]" style={{ color: 'var(--text-4)' }}>
                            {t.description}
                          </span>
                        )}
                      </span>
                      {calls > 0 && (
                        <span className="plat-row-meta font-mono text-[11px]">{calls} calls</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t px-6 py-3" style={{ borderColor: 'var(--line-soft)' }}>
          <button type="button" onClick={onClose} className="plat-btn !h-9">
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

const IntegrationsInner = () => {
  const connected = isConnected();
  const { data, isLoading, refetch, isFetching } = useIntegrations();
  const [detailSlug, setDetailSlug] = useState<string | null>(null);

  const groups = groupIntegrations(data?.integrations);
  const connections = toConnections([...groups.connected, ...groups.connectable], groups.mcp);
  const liveCount = connections.filter((c) => c.live).length;

  return (
    <div className="plat flex min-h-screen flex-col">
      <SidebarProvider>
        <div className="flex w-full flex-1">
          <AppSidebar />
          <SidebarInset className="flex flex-1 flex-col bg-transparent">
            <main className="mx-auto w-full max-w-5xl flex-1 p-6 lg:p-8">
              <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <p className="plat-crumb">3days.integrations</p>
                  <h1 className="mt-1 text-2xl">Integrations</h1>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-4)' }}>
                    Everything your agent can reach, and where each one stands
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  disabled={!connected || isFetching}
                  className="plat-btn-ghost"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {!connected && (
                <div className="plat-panel mb-6 flex flex-wrap items-center gap-3 !py-3.5">
                  <Plug className="h-4 w-4 shrink-0" style={{ color: 'var(--text-5)' }} />
                  <p className="flex-1 text-xs" style={{ color: 'var(--text-3)' }}>
                    Not connected to a Pincer backend — sign in again to see which services are
                    authorized.
                  </p>
                </div>
              )}

              {connected && isLoading && (
                <p className="text-sm" style={{ color: 'var(--text-4)' }}>
                  Reading the agent's tool registry…
                </p>
              )}

              {/* One grid, one block shape — live first, then everything else */}
              <section className="mb-10">
                <SectionHeader
                  label="Connections"
                  hint={
                    connections.length
                      ? `${liveCount} of ${connections.length} live`
                      : undefined
                  }
                />
                {connections.length ? (
                  <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
                    {connections.map((c) => (
                      <ConnectionBlock key={c.key} conn={c} onOpenDetail={setDetailSlug} />
                    ))}
                  </div>
                ) : (
                  <div className="plat-panel text-sm" style={{ color: 'var(--text-4)' }}>
                    {connected
                      ? 'The backend reported no services or MCP servers.'
                      : 'Connect to the backend to see your connections.'}
                  </div>
                )}
                <p className="mt-3 text-xs" style={{ color: 'var(--text-5)' }}>
                  Authorization runs where the agent is installed — there is no browser OAuth
                  endpoint, so the commands above are the whole flow.
                </p>
              </section>

              <section className="mb-10">
                <SectionHeader label="Included with the agent" hint="no connection needed" />
                <BuiltinBlock entries={groups.builtin} />
              </section>

              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-5)' }}>
                <Blocks className="h-3.5 w-3.5" />
                Everything on this page comes from GET /api/integrations on the connected backend.
              </div>
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>

      {detailSlug && <DetailModal slug={detailSlug} onClose={() => setDetailSlug(null)} />}
    </div>
  );
};

const IntegrationsPage = () => (
  <QueryClientProvider client={queryClient}>
    <IntegrationsInner />
  </QueryClientProvider>
);

export default IntegrationsPage;
