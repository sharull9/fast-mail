import { PreferencesProvider } from "@/components/preferences-provider";
import { themeBootstrap } from "@/lib/preferences";
import { ImportMailDialog } from "@/components/mail-transfer";
import { useHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import { appHotkeys, accountHotkeys, useShortcutLabel } from "@/lib/hotkeys";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import {
  ClientOnly,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { api, isDesktopApp, openExternal } from "@/lib/api";
import {
  authQuery,
  connectEvents,
  connectionQuery,
  labelsCollection,
  prefetchLabel,
  queryClient,
  statusQuery,
  switchAccount,
  signOutAccount,
  chatSpacesQuery,
} from "@/lib/data";
import { HIDDEN_LABELS, SIDEBAR_ORDER, labelName } from "@/lib/format";
import { Setup } from "@/components/setup";
import { ConnectionUnavailable, PairingScreen } from "@/components/connection-screens";
import { CommandMenu } from "@/components/command-menu";
import { PairBrowserDialog } from "@/components/pair-browser-dialog";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  Sidebar as MailSidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarTrigger,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Check, UserPlus, ChevronsUpDown, LogOut, RefreshCw, PenSquare, Settings, MessageSquare } from "lucide-react";
import { MailAvatar } from "@/components/mail-avatar";
import { AppContextMenu } from "@/components/app-context-menu";
import { ComposerProvider, ComposerPanel, useComposer } from "@/components/composer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarFooter } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { MailAccount } from "@mailfast/shared";
import appCss from "@/styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Mailfast" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: Shell,
  component: Root,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Everything talks to the local API, so render only in the client (the shell is prerendered). */}
      <ClientOnly fallback={<div className="splash" />}>
        <PreferencesProvider>
          <AuthGate />
        </PreferencesProvider>
      </ClientOnly>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const connection = useQuery(connectionQuery);
  const [incomingCode, setIncomingCode] = useState("");

  useLayoutEffect(() => {
    const code = new URLSearchParams(window.location.hash.slice(1)).get("pair");
    if (!code) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    setIncomingCode(code);
  }, []);

  if (connection.isPending) return <div className="splash" />;
  if (connection.isError)
    return <ConnectionUnavailable onRetry={() => void connection.refetch()} message={connection.error.message} />;
  if (!connection.data.paired)
    return (
      <PairingScreen
        connection={connection.data}
        initialCode={incomingCode}
        onPaired={async () => {
          setIncomingCode("");
          queryClient.removeQueries({ queryKey: ["auth"] });
          await queryClient.invalidateQueries({ queryKey: ["connection"] });
          const current = await queryClient.fetchQuery({ ...connectionQuery, staleTime: 0 });
          if (!current.paired) throw new Error("The browser session was not paired. Request a new code and try again.");
          await queryClient.invalidateQueries({ queryKey: ["auth"] });
        }}
      />
    );
  return <PairedGate />;
}

function PairedGate() {
  const auth = useQuery(authQuery);
  const navigate = useNavigate();
  useEffect(() => {
    const onSwitch = () => void navigate({ to: "/mail/$labelId", params: { labelId: "INBOX" } });
    window.addEventListener("mailfast:account-switched", onSwitch);
    return () => window.removeEventListener("mailfast:account-switched", onSwitch);
  }, [navigate]);
  useEffect(() => {
    if (auth.data?.configured && auth.data.signedIn) return connectEvents();
  }, [auth.data?.configured, auth.data?.signedIn, auth.data?.activeAccountId]);

  if (auth.isPending) return <div className="splash" />;
  if (auth.isError)
    return (
      <ConnectionUnavailable
        onRetry={() => void auth.refetch()}
        message={`Couldn’t check Google sign-in with this Mailfast server: ${auth.error.message}`}
      />
    );
  if (!auth.data.configured || !auth.data.signedIn) return <Setup status={auth.data} />;
  return <Layout key={auth.data.activeAccountId} />;
}

function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");
  return (
    <ComposerProvider>
      <SidebarProvider
        open={!collapsed}
        onOpenChange={(open) => {
          localStorage.setItem("sidebar-collapsed", String(!open));
          setCollapsed(!open);
        }}
        className="mail-app"
      >
        <AppContent />
      </SidebarProvider>
    </ComposerProvider>
  );
}

function AppContent() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState<string | undefined>();
  const [pairBrowserOpen, setPairBrowserOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { toggleSidebar } = useSidebar();
  useEffect(() => {
    const onCommand = (event: Event) => {
      setInitialQuery(event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : undefined);
      setMenuOpen(true);
    };
    window.addEventListener("mailfast:command", onCommand);
    return () => window.removeEventListener("mailfast:command", onCommand);
  }, []);
  const openSearch = () => {
    if (!menuOpen) setInitialQuery(undefined);
    setMenuOpen(true);
    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    input?.focus();
    input?.select();
  };
  useHotkeys(
    [appHotkeys.search, appHotkeys.find, appHotkeys.searchSlash].map((hotkey) => ({
      hotkey,
      callback: openSearch,
    })),
  );
  const { openComposer, composers } = useComposer();
  useHotkey(appHotkeys.shortcuts, () => setShortcutsOpen(true));
  useHotkey(appHotkeys.compose, () => openComposer());
  return (
    <>
      <AppContextMenu>
        <Sidebar
          onCompose={() => openComposer()}
          onSearch={() => {
            setInitialQuery(undefined);
            setMenuOpen(true);
          }}
          onPairBrowser={() => setPairBrowserOpen(true)}
          onKeyboardShortcuts={() => setShortcutsOpen(true)}
        />
        <div className="workspace">
          <div className="mobile-tools">
            <SidebarTrigger />
            <Button variant="ghost" size="sm" onClick={() => setMenuOpen(true)}>
              <Icon name="search" />
              Search mail
            </Button>
          </div>
          <main className="main flex-1 min-w-0">
            <Outlet />
          </main>
        </div>

        <CommandMenu
          initialQuery={initialQuery}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onToggleSidebar={toggleSidebar}
          onPairBrowser={() => setPairBrowserOpen(true)}
          onKeyboardShortcuts={() => setShortcutsOpen(true)}
          onCompose={() => openComposer()}
        />
        <KeyboardShortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <PairBrowserDialog open={pairBrowserOpen} onOpenChange={setPairBrowserOpen} />
        {composers
          .filter((c) => c.isOpen && (c.mode === "floating" || !c.draft.threadId))
          .map((c, index, arr) => (
            <ComposerPanel key={c.id} composerId={c.id} floatingIndex={index} totalFloating={arr.length} />
          ))}
      </AppContextMenu>
    </>
  );
}

function AccountAvatar({ account }: { account: MailAccount | undefined }) {
  if (!account?.image) return <MailAvatar name={account?.name ?? ""} email={account?.email ?? ""} className="size-8" />;
  return (
    <Avatar className="size-8 shrink-0">
      <AvatarImage src={account.image} alt="" />
      <AvatarFallback>{(account.name || account.email).slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function Sidebar({
  onCompose,
  onSearch,
  onPairBrowser,
  onKeyboardShortcuts,
}: {
  onCompose: () => void;
  onSearch: () => void;
  onPairBrowser: () => void;
  onKeyboardShortcuts: () => void;
}) {
  const shortcutLabel = useShortcutLabel();
  const auth = useQuery(authQuery).data;
  const accounts = auth?.accounts ?? [];
  const active = accounts.find((a) => a.id === auth?.activeAccountId);
  const account = active?.email ?? auth?.account ?? "";
  const navigate = useNavigate();
  const desktop = isDesktopApp();
  const [accountError, setAccountError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const perform = (operation: Promise<unknown>) => {
    setAccountError(null);
    void operation.catch((error: unknown) =>
      setAccountError(error instanceof Error ? error.message : "Account action failed"),
    );
  };
  useHotkeys(
    accounts.slice(0, 9).map((account, index) => ({
      hotkey: accountHotkeys[index],
      callback: () => perform(switchAccount(account.id)),
    })),
    { ignoreInputs: true },
  );
  const { data: labels } = useLiveQuery({ query: (q) => q.from({ l: labelsCollection }) });
  const { data: spacesData } = useQuery(chatSpacesQuery());
  const chatUnread = (spacesData?.spaces ?? []).reduce((acc, s) => acc + (s.unreadCount || 0), 0);
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const { state, isMobile, setOpenMobile } = useSidebar();
  const system = SIDEBAR_ORDER.map((id) => labels.find((l) => l.id === id) ?? { id, name: labelName(id), unread: 0 });
  const user = labels
    .filter((l) => l.type === "user" && !HIDDEN_LABELS.has(l.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <MailSidebar collapsible="icon" aria-label="Mail navigation">
      <ImportMailDialog open={importOpen} onOpenChange={setImportOpen} account={account} />
      <SidebarHeader className="gap-2 group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:pb-0">
        <div className="flex min-w-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Account menu"
                className="group/account flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 text-left outline-hidden hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
              >
                <AccountAvatar account={active} />
                <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
                    {active?.name || "Mailfast"}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">{account}</span>
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/70 group-hover/account:text-muted-foreground group-data-[collapsible=icon]:hidden" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60" align="start">
              <DropdownMenuLabel>Accounts</DropdownMenuLabel>
              {accounts.map((item, index) => (
                <DropdownMenuItem
                  key={item.id}
                  aria-label={`${item.email}${item.id === active?.id ? ", active" : ""}`}
                  onSelect={() => perform(switchAccount(item.id))}
                >
                  <AccountAvatar account={item} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name || item.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.email}</span>
                  </span>
                  {item.unread > 0 && (
                    <span className="rounded bg-muted px-1.5 text-xs" aria-label={`${item.unread} unread`}>
                      {item.unread}
                    </span>
                  )}
                  {item.id === active?.id && <Check className="size-4" aria-label="Active account" />}
                  {index < 9 && <DropdownMenuShortcut>{shortcutLabel(accountHotkeys[index].id)}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  perform(
                    api.login().then(({ url }) => {
                      openExternal(url);
                      setAdding(true);
                    }),
                  )
                }
              >
                <UserPlus className="size-4" />
                Add another account
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void api.syncNow();
                }}
              >
                <Icon name="ALL" />
                Sync now
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: "/chat", search: {} })}>
                <MessageSquare className="size-4" />
                Google Chat
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: "/settings", search: { section: "appearance" } })}>
                <Settings />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <Icon name="INBOX" />
                Import mail...
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onKeyboardShortcuts}>
                <Icon name="command" />
                Keyboard shortcuts
                <DropdownMenuShortcut>{shortcutLabel("shortcuts")}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onPairBrowser}>
                <Icon name="external" />
                Pair another browser…
              </DropdownMenuItem>
              {!desktop && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    void api.disconnectBrowser();
                  }}
                >
                  <LogOut />
                  Disconnect browser
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  if (active) perform(signOutAccount(active.id));
                }}
              >
                <LogOut />
                {/* One line: long addresses truncate; the full address is in the title tooltip. */}
                <span className="min-w-0 truncate" title={`Sign out of ${account}`}>
                  Sign out of {account}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  void api.logout().then(() => {
                    queryClient.clear();
                    window.location.reload();
                  });
                }}
              >
                <LogOut />
                Sign out of all accounts
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SidebarTrigger
            className="size-7 text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden"
            aria-label={state === "collapsed" ? "Expand sidebar" : "Collapse sidebar"}
          />
        </div>
        <SidebarTrigger
          className="hidden group-data-[collapsible=icon]:inline-flex group-data-[collapsible=icon]:size-8"
          aria-label="Expand sidebar"
        />
        <SidebarMenu className="flex-row gap-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
          <SidebarMenuItem className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
            <SidebarMenuButton
              aria-label="Compose message"
              className="h-7 bg-primary text-[13px] font-medium text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.25)] hover:bg-primary/90 hover:text-primary-foreground active:translate-y-px active:bg-primary/95 active:text-primary-foreground group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center [&>svg]:text-primary-foreground [&>svg]:size-3.5 rounded-full"
              onClick={onCompose}
              tooltip={`Compose message (${shortcutLabel("compose")})`}
            >
              <PenSquare className="size-3 shrink-0 text-primary-foreground" />
              <span className="font-medium text-primary-foreground group-data-[collapsible=icon]:hidden">Compose</span>
              <kbd className="ml-auto pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center rounded-md bg-primary-foreground/10 px-1.5 font-mono text-[10px] font-semibold text-primary-foreground/75! ring-1 ring-inset ring-primary-foreground/15 group-data-[collapsible=icon]:hidden">
                {shortcutLabel("compose")}
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-label="Search mail"
              className="size-7 justify-center bg-sidebar-accent/40 text-[13px] font-normal text-muted-foreground ring-1 ring-inset ring-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:ring-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:text-sidebar-foreground group-data-[collapsible=icon]:hover:bg-sidebar-accent group-data-[collapsible=icon]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:active:bg-sidebar-accent group-data-[collapsible=icon]:active:text-sidebar-accent-foreground [&>svg]:size-3.5 rounded-full"
              onClick={onSearch}
              tooltip={`Search mail (${shortcutLabel("search")})`}
            >
              <Icon name="search" />
              <span className="hidden">Search mail</span>
              <kbd className="ml-auto pointer-events-none hidden h-5 min-w-5 select-none items-center justify-center rounded-md bg-sidebar/80 px-1.5 font-mono text-[10px] font-semibold text-muted-foreground ring-1 ring-inset ring-sidebar-border">
                {shortcutLabel("search")}
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      {accountError && (
        <p role="alert" className="px-3 text-xs text-destructive">
          {accountError}
        </p>
      )}
      {adding && (
        <p role="status" className="px-3 text-xs text-muted-foreground">
          Finish signing in in your browser. Accounts refresh automatically.
        </p>
      )}
      <SidebarContent>
        {[
          { name: "Mail", labels: system.filter((l) => !["SPAM", "TRASH"].includes(l.id)) },
          { name: "More", labels: system.filter((l) => ["SPAM", "TRASH"].includes(l.id)) },
        ].map((group) => (
          <SidebarGroup key={group.name} className="group-data-[collapsible=icon]:first:pt-1">
            <SidebarGroupLabel>{group.name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.labels.map((l) => (
                  <LabelLink
                    key={l.id}
                    id={l.id}
                    name={labelName(l.id, l.name)}
                    unread={["INBOX", "IMPORTANT", "STARRED"].includes(l.id) ? l.unread : 0}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SidebarGroup>
          <SidebarGroupLabel>Chat</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={currentPath.startsWith("/chat")}
                  tooltip={chatUnread > 0 ? `Google Chat (${chatUnread} unread)` : "Google Chat"}
                >
                  <Link
                    to="/chat"
                    search={{}}
                    onClick={() => {
                      if (isMobile) setOpenMobile(false);
                    }}
                  >
                    <MessageSquare className="size-4" />
                    <span>Google Chat</span>
                    {chatUnread > 0 && <SidebarMenuBadge>{chatUnread}</SidebarMenuBadge>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {user.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Labels</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {user.map((l) => (
                  <LabelLink key={l.id} id={l.id} name={l.name} unread={l.unread} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <StatusBar />
      <SidebarRail />
    </MailSidebar>
  );
}

function LabelLink({ id, name, unread }: { id: string; name: string; unread: number }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active =
    path.startsWith(`/mail/${id}/`) || path === `/mail/${id}` || (id === "INBOX" && path.startsWith("/mail/INBOX_"));
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={unread > 0 ? `${name} (${unread} unread)` : name}>
        <Link
          to="/mail/$labelId"
          params={{ labelId: id }}
          aria-label={unread > 0 ? `${name}, ${unread} unread` : name}
          aria-current={active ? "page" : undefined}
          onMouseEnter={() => prefetchLabel(id)}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
        >
          <Icon name={id} />
          <span>{name}</span>
        </Link>
      </SidebarMenuButton>
      {unread > 0 && id !== "SENT" && id !== "DRAFT" && <SidebarMenuBadge>{unread}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

const PHASE_TEXT: Record<string, string> = {
  initial: "Loading inbox…",
  backfill: "Syncing older mail…",
  incremental: "Checking for new mail…",
  idle: "Up to date",
  error: "Sync error",
  "signed-out": "Signed out",
};

function StatusBar() {
  const status = useQuery(statusQuery).data;
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const phase = status?.phase ?? "idle";
  const busy = syncing || ["initial", "backfill", "incremental"].includes(phase);
  const error = syncError ?? status?.error;
  const phaseText = syncError ? "Sync error" : PHASE_TEXT[phase];
  const dot = <span className={`dot block ${error ? "error" : phase}`} />;

  return (
    <SidebarFooter className="border-t p-3 group-data-[collapsible=icon]:p-2">
      <div className="flex items-center gap-2">
        {!collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="min-w-0 flex-1" aria-label={phaseText}>
                <p className="flex items-center gap-2 text-xs text-foreground">
                  {dot}
                  <span className="truncate">{phaseText}</span>
                </p>
                {status && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {status.messagesStored.toLocaleString()} messages cached
                  </p>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>{error ?? phaseText}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-7 shrink-0"
              aria-label="Sync now"
              aria-busy={busy}
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                setSyncError(null);
                try {
                  await api.syncNow();
                } catch (error) {
                  setSyncError(error instanceof Error ? error.message : "Couldn't sync mail");
                } finally {
                  setSyncing(false);
                }
              }}
            >
              <RefreshCw className={`size-4${busy ? " animate-spin" : ""}`} />
              {collapsed && <span className="absolute right-0 top-0">{dot}</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sync now</TooltipContent>
        </Tooltip>
      </div>
    </SidebarFooter>
  );
}
