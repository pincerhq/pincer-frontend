/**
 * Account menu (FE1 §2): profile, language DE/EN (persisted) and logout.
 * Rendered in the rail footer on desktop and at the bottom of the "Mehr" sheet
 * on phones.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe, LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfilePanel } from "@/components/account/ProfilePanel";
import { cn } from "@/lib/utils";
import { useSession, type VoiceLocale } from "@/stores/session";
import { useVoiceT } from "@/i18n/voice";
import { ROUTES } from "@/pages/telephony/_lib/routes";

export function useLogout() {
  const navigate = useNavigate();
  const logout = useSession((s) => s.logout);
  return () => {
    logout();
    navigate(ROUTES.LOGIN, { replace: true });
  };
}

export function UserMenu({ collapsed = false, connected }: { collapsed?: boolean; connected: boolean }) {
  const t = useVoiceT("voice-nav");
  const tc = useVoiceT("voice-common");
  const ta = useVoiceT("voice-auth");
  const tp = useVoiceT("voice-account");
  const navigate = useNavigate();
  const locale = useSession((s) => s.locale);
  const setLocale = useSession((s) => s.setLocale);
  const doLogout = useLogout();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("rail.userMenu")}
          className={cn(
            "flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-xs hover:bg-[color:color-mix(in_srgb,var(--ink)_4%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
            collapsed && "justify-center",
          )}
        >
          <UserRound className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
          {!collapsed && (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", connected ? "bg-[var(--ok-fg)]" : "bg-[var(--text-5)]")} aria-hidden="true" />
              <span className="truncate text-[var(--text-3)]">{connected ? tc("status.connected") : tc("status.disconnected")}</span>
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56 rounded-[12px]">
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserRound className="mr-2 h-4 w-4" aria-hidden="true" />
            {tp("menu")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-2 text-xs text-[var(--text-3)]">
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            {tc("language.label")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as VoiceLocale)}>
            <DropdownMenuRadioItem value="de">{tc("language.de")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="en">{tc("language.en")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={doLogout} className="text-[var(--bad-fg)]">
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            {ta("logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfilePanel open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}
