/**
 * The one navigation model both shells render (desktop rail, mobile tabs +
 * "Mehr" sheet). Labels are i18n keys in `voice-nav`; role gating is resolved
 * by a hook so the two shells cannot disagree.
 *
 * The structure is what FE1 §2 specified minus every entry whose screen was
 * removed for lacking a backend — the menu now lists only surfaces that read
 * an endpoint the server actually serves, so nothing here leads to demo data
 * or a permanent error.
 */
import type { ComponentType } from "react";
import {
  Clock,
  Inbox,
  LayoutDashboard,
  CalendarClock,
  PhoneCall,
  Radio,
  Settings2,
  Shield,
} from "lucide-react";
import { ROUTES } from "@/pages/telephony/_lib/routes";
import { canRole, useSession, type OwnerAction } from "@/stores/session";

export type NavIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export interface NavItem {
  key: string;
  /** i18n key under `voice-nav:items` */
  labelKey: string;
  path: string;
  icon: NavIcon;
  /** Extra paths that count as "active" for this item. */
  alsoActive?: string[];
  /** Paths that must NOT count, even though they start with `path`. */
  exclude?: string[];
  /** FE9 §1.2: hidden when the role may not do this (the server enforces regardless). */
  action?: OwnerAction;
  /** Submenu (rendered collapsible on desktop, as a group in the sheet). */
  children?: NavItem[];
}

export interface NavGroup {
  key: "owner" | "operations" | "advanced";
  items: NavItem[];
}


/** Bottom tabs on phones: Übersicht · Anrufe · Nachrichten (+ Mehr). */
export const PRIMARY_ITEMS: NavItem[] = [
  { key: "overview", labelKey: "overview", path: ROUTES.OVERVIEW, icon: LayoutDashboard, alsoActive: [ROUTES.OVERVIEW_ALIAS] },
  {
    key: "calls",
    labelKey: "calls",
    path: ROUTES.CALLS,
    icon: PhoneCall,
    alsoActive: [`${ROUTES.HOME}/threads`],
    exclude: [ROUTES.CALLS_LIVE, ROUTES.CALLS_PENDING, ROUTES.CALLS_OPS],
  },
  { key: "messages", labelKey: "messages", path: ROUTES.MESSAGES, icon: Inbox },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "owner",
    items: [...PRIMARY_ITEMS],
  },
  {
    key: "operations",
    items: [
      { key: "live", labelKey: "live", path: ROUTES.CALLS_LIVE, icon: Radio },
      { key: "pending", labelKey: "pendingApproval", path: ROUTES.CALLS_PENDING, icon: Clock },
      { key: "planned", labelKey: "planned", path: ROUTES.PLANNED, icon: CalendarClock },
    ],
  },
  {
    key: "advanced",
    items: [
      { key: "callsOps", labelKey: "callsOps", path: ROUTES.CALLS_OPS, icon: PhoneCall },
      { key: "policies", labelKey: "policies", path: ROUTES.POLICIES, icon: Shield },
      {
        key: "settings",
        labelKey: "advancedSettings",
        path: ROUTES.SETTINGS,
        icon: Settings2,
      },
    ],
  },
];

function stripHash(p: string): string {
  const i = p.indexOf("#");
  return i >= 0 ? p.slice(0, i) : p;
}

export function isNavItemActive(item: NavItem, pathname: string, hash = ""): boolean {
  const startsWith = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (item.exclude?.some(startsWith)) return false;
  const own = stripHash(item.path);
  const ownHash = item.path.includes("#") ? item.path.slice(item.path.indexOf("#")) : "";
  if (own === ROUTES.HOME) {
    // Home is exact, plus its alias.
    if (pathname === ROUTES.HOME) return true;
  } else if (startsWith(own)) {
    return ownHash ? hash === ownHash : true;
  }
  if (item.children?.some((c) => isNavItemActive(c, pathname, hash))) return true;
  return item.alsoActive?.some((p) => pathname === p || (p.endsWith("/threads") && startsWith(p))) ?? false;
}

/** Groups with role-forbidden items removed (hidden, never disabled). */
export function useVisibleNavGroups(): NavGroup[] {
  const role = useSession((s) => s.role);
  const visible = (items: NavItem[]): NavItem[] =>
    items
      .filter((item) => !item.action || canRole(role, item.action))
      .map((item) => (item.children ? { ...item, children: visible(item.children) } : item));
  return NAV_GROUPS.map((g) => ({ ...g, items: visible(g.items) })).filter((g) => g.items.length > 0);
}
