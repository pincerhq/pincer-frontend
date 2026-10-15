import { SidebarTrigger } from '@/components/ui/sidebar';
import { useVoiceT } from '@/i18n/voice';

/**
 * Phone-width header for the pages that use the app sidebar. Below `md` (the
 * sidebar's own mobile breakpoint, 768px) the sidebar is a closed sheet, and
 * this button is the only way to open it by touch.
 */
export function MobileMenuBar() {
  const t = useVoiceT('voice-nav');
  return (
    <div className="flex h-14 shrink-0 items-center border-b border-[color:var(--line-soft)] px-2 md:hidden">
      <SidebarTrigger aria-label={t('openMenu')} className="h-11 w-11 text-[color:var(--ink)]" />
    </div>
  );
}
