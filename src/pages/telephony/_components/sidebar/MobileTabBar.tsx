/**
 * Bottom tabs for phones (FE1 §2, Block I rule 4): Übersicht · Anrufe ·
 * Nachrichten · Mehr. "Mehr" opens a sheet with every other area, grouped
 * exactly like the desktop rail — one nav model, two shells — plus the other
 * apps, language, theme, profile and logout at the bottom. On a phone this
 * sheet is the only way out of telephony: the platform sidebar is not here.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Brain, ClipboardCheck, LayoutDashboard, LogOut, MessageCircle, MoreHorizontal, Puzzle, UserRound } from 'lucide-react';
import { ProfilePanel } from '@/components/account/ProfilePanel';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useSession, type VoiceLocale } from '@/stores/session';
import { THEMES, useTheme } from '@/contexts/ThemeContext';
import { useVoiceT } from '@/i18n/voice';
import { isNavItemActive, PRIMARY_ITEMS, useVisibleNavGroups, type NavItem } from './telephonyNav';
import { useNavBadges } from './TelephonyMiniRail';
import { useLogout } from './UserMenu';

/** The platform apps, as the desktop sidebar lists them. */
const APP_LINKS = [
  { key: 'dashboard', path: '/dashboard', icon: LayoutDashboard },
  { key: 'chat', path: '/chat', icon: MessageCircle },
  { key: 'tasks', path: '/tasks', icon: ClipboardCheck },
  { key: 'company', path: '/company-brain', icon: Brain },
  { key: 'integrations', path: '/integrations', icon: Puzzle },
] as const;

export default function MobileTabBar() {
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  const t = useVoiceT('voice-nav');
  const tc = useVoiceT('voice-common');
  const ta = useVoiceT('voice-auth');
  const tp = useVoiceT('voice-account');
  const groups = useVisibleNavGroups();
  const { badgeFor } = useNavBadges();
  const locale = useSession((s) => s.locale);
  const setLocale = useSession((s) => s.setLocale);
  const doLogout = useLogout();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const primaryKeys = new Set(PRIMARY_ITEMS.map((i) => i.key));
  const locales: VoiceLocale[] = ['de', 'en'];
  // Flatten submenus into their own group in the sheet.
  const sheetGroups: Array<{ key: string; labelKey: string; items: NavItem[] }> = [];
  for (const g of groups) {
    const flat: NavItem[] = [];
    for (const item of g.items) {
      if (primaryKeys.has(item.key)) continue;
      if (item.children && item.children.length > 0) {
        sheetGroups.push({ key: item.key, labelKey: `items.${item.labelKey}`, items: item.children });
      } else flat.push(item);
    }
    if (flat.length) sheetGroups.push({ key: g.key, labelKey: `groups.${g.key}`, items: flat });
  }
  const moreActive = sheetGroups.some((g) => g.items.some((i) => isNavItemActive(i, pathname, hash)));

  const sheetItemClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-sm',
      active ? 'bg-[color:color-mix(in_srgb,var(--ink)_7%,transparent)] font-semibold text-[var(--ink)]' : 'text-[var(--text-2)] hover:bg-[color:color-mix(in_srgb,var(--ink)_4%,transparent)]',
    );
  const choiceClass = (selected: boolean) =>
    cn(
      'rounded-[10px] border px-3 py-1.5 text-sm',
      selected ? 'border-[var(--ink)] bg-[color:color-mix(in_srgb,var(--ink)_7%,transparent)] font-semibold text-[var(--ink)]' : 'border-[var(--line)] text-[var(--text-2)]',
    );

  const tabClass = (active: boolean) =>
    cn(
      'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-none transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]',
      active ? 'font-semibold text-[var(--ink)]' : 'text-[var(--text-3)]',
    );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--line-soft)] bg-[var(--paper)] pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label={t('groups.owner')}
      >
        {PRIMARY_ITEMS.map((item) => {
          const active = isNavItemActive(item, pathname, hash);
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path)}
              aria-current={active ? 'page' : undefined}
              className={tabClass(active)}
            >
              <span className="relative">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="max-w-full truncate">{t(`items.${item.labelKey}`)}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={tabClass(moreActive)}>
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          <span>{t('items.more')}</span>
        </button>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-[14px] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <SheetHeader className="text-left">
            <SheetTitle>{t('moreSheet.title')}</SheetTitle>
            <SheetDescription>{t('moreSheet.description')}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-5">
            {sheetGroups.map((group) => (
              <div key={group.key}>
                <p className="plat-eyebrow !text-[var(--text-3)] mb-2">{t(group.labelKey)}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isNavItemActive(item, pathname, hash);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          navigate(item.path);
                        }}
                        aria-current={active ? 'page' : undefined}
                        className={sheetItemClass(active)}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-[var(--text-4)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{t(`items.${item.labelKey}`)}</span>
                        {badgeFor(item.key)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div role="group" aria-labelledby="more-sheet-apps">
              <p id="more-sheet-apps" className="plat-eyebrow !text-[var(--text-3)] mb-2">{t('groups.apps')}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {APP_LINKS.map((app) => {
                  const Icon = app.icon;
                  return (
                    <button
                      key={app.key}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate(app.path);
                      }}
                      className={sheetItemClass(false)}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[var(--text-4)]" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{t(`apps.${app.key}`)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="border-t border-[var(--line-soft)] pt-4">
              <p className="plat-eyebrow !text-[var(--text-3)] mb-2">{tc('language.label')}</p>
              <div className="flex gap-1.5" role="radiogroup" aria-label={tc('language.label')}>
                {locales.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={locale === l}
                    onClick={() => setLocale(l)}
                    className={choiceClass(locale === l)}
                  >
                    {tc(`language.${l}`)}
                  </button>
                ))}
              </div>
              <p className="plat-eyebrow !text-[var(--text-3)] mb-2 mt-4">{tp('theme.label')}</p>
              <div className="flex gap-1.5" role="radiogroup" aria-label={tp('theme.label')}>
                {THEMES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={theme === option}
                    onClick={() => setTheme(option)}
                    className={choiceClass(theme === option)}
                  >
                    {tp(`theme.${option}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setProfileOpen(true);
                }}
                className="mt-4 flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-[var(--text-2)] hover:bg-[color:color-mix(in_srgb,var(--ink)_4%,transparent)]"
              >
                <UserRound className="h-4 w-4 text-[var(--text-4)]" aria-hidden="true" />
                {tp('menu')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  doLogout();
                }}
                className="mt-1 flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-[var(--bad-fg)] hover:bg-[color:color-mix(in_srgb,var(--bad-fg)_6%,transparent)]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {ta('logout')}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ProfilePanel open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}
