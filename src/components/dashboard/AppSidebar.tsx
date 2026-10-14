
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useSession } from '@/stores/session';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  LayoutDashboard,
  MessageCircle,
  Puzzle,
  ClipboardCheck,
  Brain,
  LogOut,
  Globe,
  Check,
  SunMoon,
  Pencil,
  MessageSquare,
  Phone,
  UserRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { ProfilePanel } from '@/components/account/ProfilePanel';
import { useVoiceT } from '@/i18n/voice';
import { useTheme } from '@/contexts/ThemeContext';

interface ChatHistoryItem {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: Date;
  messageCount: number;
}

interface AppSidebarProps {
  chatHistory?: ChatHistoryItem[];
  currentChatId?: string;
  onSelectChat?: (id: string) => void;
  onNewChat?: () => void;
}

const navigationItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Chat",
    url: "/chat",
    icon: MessageCircle,
  },
  {
    title: "Tasks",
    url: "/tasks",
    icon: ClipboardCheck,
  },
  {
    title: "Company",
    url: "/company-brain",
    icon: Brain,
  },
  {
    title: "Integrations",
    url: "/integrations",
    icon: Puzzle,
  },
];

/**
 * The apps that ship alongside the platform sections above. They used to sit
 * on a fixed rail down the right edge; two tiles did not earn a whole rail, so
 * they moved in here where the rest of the navigation already is.
 */
const appItems = [
  {
    title: "Telephony",
    url: "/telephony",
    icon: Phone,
  },
];

const languages = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'sv', label: 'Svenska' },
  { code: 'no', label: 'Norsk' },
];

const themes = ['light', 'dark', 'system'] as const;


export function AppSidebar({ chatHistory, currentChatId, onSelectChat, onNewChat }: AppSidebarProps = {}) {
  const location = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const isChat = location.pathname === '/chat';
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [profileOpen, setProfileOpen] = useState(false);
  const ta = useVoiceT('voice-account');
  const { theme, setTheme } = useTheme();

  const identity = useSession((s) => s.identity);
  const userLabel = identity?.displayName || identity?.email || identity?.id || '';

  const getInitials = (label: string) => label.slice(0, 2).toUpperCase();

  const handleLogout = () => {
    useSession.getState().logout();
    navigate('/login');
  };

  const handleLogoClick = () => {
    toggleSidebar();
  };

  return (
    <Sidebar className="border-r" collapsible="icon">
      <SidebarHeader className="p-4">
        <div 
          className="flex items-center space-x-2 cursor-pointer hover:bg-accent rounded-lg p-2 -m-2 transition-colors"
          onClick={handleLogoClick}
        >
          <div className="w-6 h-6 bg-[color:var(--ink)] rounded-[7px] flex items-center justify-center flex-shrink-0">
            <Brain className="w-3 h-3 text-[color:var(--on-ink)]" />
          </div>
          {state === "expanded" && (
            <span className="plat-display text-[15px] text-[color:var(--ink)] truncate">3Days.ai</span>
          )}
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Worker Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location.pathname === item.url || location.pathname.startsWith(item.url + '/')}
                    tooltip={state === "collapsed" ? item.title : undefined}
                  >
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Apps</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {appItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.url || location.pathname.startsWith(item.url + '/')}
                    tooltip={state === "collapsed" ? item.title : undefined}
                  >
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isChat && state === 'expanded' && (
          <SidebarGroup className="flex-1 min-h-0">
            <div className="flex items-center justify-between px-2 pb-1">
              <SidebarGroupLabel className="flex items-center gap-1.5 p-0">
                <MessageSquare className="h-3 w-3" />
                History
              </SidebarGroupLabel>
              {onNewChat && (
                <button
                  onClick={onNewChat}
                  title="New chat"
                  className="flex items-center justify-center h-5 w-5 rounded text-[color:var(--text-5)] hover:text-[color:var(--text-1)] hover:bg-[color:var(--sand)] transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
            <SidebarGroupContent className="flex-1 min-h-0">
              <ScrollArea className="h-full max-h-64">
                <div className="px-1 space-y-0.5">
                  <p className="text-[10px] font-semibold text-[color:var(--text-5)] uppercase tracking-widest px-2 pt-1 pb-1.5">Today</p>
                  <button
                    onClick={() => onSelectChat?.('current')}
                    className={`w-full text-left px-2 py-1.5 rounded-md transition-colors text-xs flex items-center gap-1.5 ${
                      currentChatId === 'current'
                        ? 'bg-[color:color-mix(in_srgb,var(--ink)_6%,transparent)] font-semibold text-[color:var(--ink)]'
                        : 'hover:bg-[color:color-mix(in_srgb,var(--ink)_4%,transparent)] text-[color:var(--text-2)]'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--ink)] shrink-0" />
                    <span className="truncate">Current Chat</span>
                  </button>

                  {chatHistory && chatHistory.length > 0 && (
                    <>
                      <p className="text-[10px] font-semibold text-[color:var(--text-5)] uppercase tracking-widest px-2 pt-3 pb-1">Earlier</p>
                      {chatHistory.map(chat => (
                        <button
                          key={chat.id}
                          onClick={() => onSelectChat?.(chat.id)}
                          className={`w-full text-left px-2 py-1.5 rounded-md transition-colors text-xs truncate ${
                            currentChatId === chat.id
                              ? 'bg-[color:color-mix(in_srgb,var(--ink)_6%,transparent)] font-semibold text-[color:var(--ink)]'
                              : 'hover:bg-[color:color-mix(in_srgb,var(--ink)_4%,transparent)] text-[color:var(--text-2)]'
                          }`}
                        >
                          {chat.title}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </ScrollArea>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

      </SidebarContent>
      
      <SidebarFooter className="p-3 border-t border-[color:var(--line-soft)]">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={`flex items-center gap-2 hover:bg-accent px-2 ${state === "collapsed" ? "justify-center w-full" : ""}`}>
                <Avatar className="h-7 w-7 flex-shrink-0">
                  <AvatarFallback className="bg-[color:var(--sand-deep)] text-[color:var(--ink)] text-xs font-semibold">
                    {getInitials(userLabel)}
                  </AvatarFallback>
                </Avatar>
                {state === "expanded" && (
                  <span className="text-sm text-[color:var(--text-1)] truncate max-w-[120px]">{userLabel}</span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align={state === "expanded" ? "end" : "center"} className="w-64 bg-[color:var(--paper)] border shadow-lg">
              <DropdownMenuItem onSelect={() => setProfileOpen(true)} className="flex items-center space-x-2 cursor-pointer">
                <UserRound className="h-4 w-4" />
                <span>{ta('menu')}</span>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center space-x-2 cursor-pointer">
                  <Globe className="h-4 w-4" />
                  <span>Language</span>
                  <span className="ml-auto text-xs text-[color:var(--text-5)] mr-1">
                    {languages.find(l => l.code === selectedLanguage)?.label}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44 bg-[color:var(--paper)] border shadow-lg">
                  {languages.map((lang) => (
                    <DropdownMenuItem
                      key={lang.code}
                      onClick={() => setSelectedLanguage(lang.code)}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span>{lang.label}</span>
                      {selectedLanguage === lang.code && (
                        <Check className="h-3.5 w-3.5 text-[color:var(--ink)]" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center space-x-2 cursor-pointer">
                  <SunMoon className="h-4 w-4" />
                  <span>{ta('theme.label')}</span>
                  <span className="ml-auto text-xs text-[color:var(--text-5)] mr-1">
                    {ta(`theme.${theme}`)}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44 bg-[color:var(--paper)] border shadow-lg">
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(value) => setTheme(value as (typeof themes)[number])}
                  >
                    {themes.map((option) => (
                      <DropdownMenuRadioItem key={option} value={option} className="cursor-pointer">
                        {ta(`theme.${option}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="flex items-center space-x-2 cursor-pointer text-red-600">
                <LogOut className="h-4 w-4" />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ProfilePanel open={profileOpen} onOpenChange={setProfileOpen} />

        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
