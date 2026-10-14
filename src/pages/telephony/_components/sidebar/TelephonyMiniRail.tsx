import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useActiveCalls,
  usePendingApprovals,
  useScheduledCalls,
  useThreads,
  useUnreadMessageCount,
  useVoiceConnected,
} from '@/lib/api/voice';
import { useVoiceT } from '@/i18n/voice';
import { isNavItemActive, useVisibleNavGroups, type NavItem } from './telephonyNav';
import { UserMenu } from './UserMenu';

const COLLAPSED_KEY = 'voice.rail.collapsed';

// ─── NavRow ───────────────────────────────────────────────────────────────────

interface NavRowProps {
  icon: NavItem['icon'];
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
  collapsed?: boolean;
  depth?: 0 | 1;
  trailing?: React.ReactNode;
  ariaExpanded?: boolean;
}

function NavRow({ icon: Icon, label, active, onClick, badge, collapsed, depth = 0, trailing, ariaExpanded }: NavRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-expanded={ariaExpanded}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-[10px] py-2 text-left text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]',
        collapsed ? 'justify-center px-0' : depth === 1 ? 'pl-9 pr-3' : 'px-3',
        active
          ? 'bg-[rgba(20,22,26,0.07)] font-semibold text-[var(--ink)]'
          : 'text-[var(--text-2)] hover:bg-[rgba(20,22,26,0.04)]',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-[var(--ink)]' : 'text-[var(--text-4)]')} aria-hidden="true" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge}
      {!collapsed && trailing}
    </button>
  );
}

// ─── Badge variants ──────────────────────────────────────────────────────────

function LiveBadge({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <span className="relative flex h-4 w-4 shrink-0 items-center justify-center" role="status" aria-label={label}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold leading-none text-white">
        {count}
      </span>
    </span>
  );
}

function AmberBadge({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <span
      className="flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold leading-none text-white"
      aria-label={label}
    >
      {count}
    </span>
  );
}

// ─── Live counts (shared with the mobile tab bar) ─────────────────────────────

export function useNavBadges() {
  const t = useVoiceT('voice-nav');
  const connected = useVoiceConnected();
  const { data: activeCalls } = useActiveCalls();
  const liveCount = activeCalls?.length ?? 0;
  const { approvals } = usePendingApprovals();
  const pendingCount = approvals.length;
  const unreadMessages = useUnreadMessageCount();
  const { data: scheduledCalls } = useScheduledCalls();
  const plannedCount = scheduledCalls?.length ?? 0;
  // S14 §4: open matters with something past due — same query the history uses.
  const { data: threadPage } = useThreads({ status: ['open'], expiredOnly: true });
  const overdueThreads = threadPage?.threads ?? [];
  const overdueTitle =
    overdueThreads.length > 0
      ? t('badges.pastDue', { subjects: overdueThreads.slice(0, 3).map((th) => th.subject).join(', ') }) +
        (overdueThreads.length > 3 ? t('badges.pastDueMore', { count: overdueThreads.length - 3 }) : '')
      : undefined;

  const badgeFor = (key: string): React.ReactNode => {
    if (!connected) return undefined;
    switch (key) {
      case 'calls':
        return overdueThreads.length > 0 ? (
          <span title={overdueTitle}>
            <AmberBadge count={overdueThreads.length} label={overdueTitle ?? ''} />
          </span>
        ) : undefined;
      case 'live':
        return liveCount > 0 ? <LiveBadge count={liveCount} label={t('badges.liveCalls', { count: liveCount })} /> : undefined;
      case 'pending':
        return pendingCount > 0 ? <AmberBadge count={pendingCount} label={t('badges.pending', { count: pendingCount })} /> : undefined;
      case 'messages':
        return unreadMessages > 0 ? <AmberBadge count={unreadMessages} label={t('badges.unread', { count: unreadMessages })} /> : undefined;
      case 'planned':
        return plannedCount > 0 ? <AmberBadge count={plannedCount} label={t('badges.planned', { count: plannedCount })} /> : undefined;
      default:
        return undefined;
    }
  };

  return { connected, badgeFor };
}

// ─── TelephonyMiniRail ────────────────────────────────────────────────────────

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function TelephonyMiniRail() {
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  const t = useVoiceT('voice-nav');
  const tc = useVoiceT('voice-common');
  const groups = useVisibleNavGroups();
  const { connected, badgeFor } = useNavBadges();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [openSub, setOpenSub] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const isOpen = (item: NavItem) => openSub[item.key] ?? isNavItemActive(item, pathname, hash);

  const renderItem = (item: NavItem) => {
    const active = isNavItemActive(item, pathname, hash);
    if (item.children && item.children.length > 0 && !collapsed) {
      const open = isOpen(item);
      return (
        <div key={item.key}>
          <NavRow
            icon={item.icon}
            label={t(`items.${item.labelKey}`)}
            active={active && !item.children.some((c) => isNavItemActive(c, pathname, hash))}
            onClick={() => {
              setOpenSub((s) => ({ ...s, [item.key]: !open }));
              if (!open) navigate(item.path);
            }}
            ariaExpanded={open}
            trailing={<ChevronDown className={cn('h-3.5 w-3.5 text-[var(--text-5)] transition-transform', open && 'rotate-180')} aria-hidden="true" />}
          />
          {open && (
            <div className="space-y-0.5">
              {item.children.map((child) => (
                <NavRow
                  key={child.key}
                  icon={child.icon}
                  label={t(`items.${child.labelKey}`)}
                  active={isNavItemActive(child, pathname, hash)}
                  onClick={() => navigate(child.path)}
                  depth={1}
                />
              ))}
            </div>
          )}
        </div>
      );
    }
    return (
      <NavRow
        key={item.key}
        icon={item.icon}
        label={t(`items.${item.labelKey}`)}
        active={active}
        onClick={() => navigate(item.path)}
        badge={badgeFor(item.key)}
        collapsed={collapsed}
      />
    );
  };

  return (
    <aside
      className={cn(
        'hidden h-full shrink-0 flex-col overflow-hidden border-r border-[var(--line-soft)] transition-[width] md:flex',
        collapsed ? 'w-14' : 'w-60',
      )}
      aria-label={tc('app.section')}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className={cn('flex items-center pb-3 pt-4', collapsed ? 'justify-center px-2' : 'justify-between px-5')}>
        {!collapsed && <p className="plat-eyebrow !text-[var(--text-3)]">{tc('app.section')}</p>}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t('rail.expand') : t('rail.collapse')}
          aria-pressed={collapsed}
          className="rounded-[8px] p-1 text-[var(--text-4)] hover:bg-[rgba(20,22,26,0.04)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto pb-4">
        {groups.map((group, i) => (
          <div key={group.key}>
            {i > 0 && !collapsed && <div className="plat-eyebrow !text-[var(--text-3)] mb-2 mt-6 px-5">{t(`groups.${group.key}`)}</div>}
            {i > 0 && collapsed && <div className="mx-4 my-3 border-t border-[var(--line-soft)]" aria-hidden="true" />}
            <div className="space-y-0.5">{group.items.map(renderItem)}</div>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-[var(--line-soft)] py-2', collapsed ? 'px-1' : 'px-3')}>
        <UserMenu collapsed={collapsed} connected={connected} />
      </div>
    </aside>
  );
}
