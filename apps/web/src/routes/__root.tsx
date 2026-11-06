import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ClientOnly,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { api } from "@/lib/api";
import {
  authQuery,
  connectEvents,
  connectionQuery,
  labelsCollection,
  prefetchLabel,
  queryClient,
  statusQuery,
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
import { ChevronsUpDown, RefreshCw } from "lucide-react";
import { MailAvatar } from "@/components/mail-avatar";
import { AppContextMenu } from "@/components/app-context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarFooter } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
    <html lang="en" className="dark">
      <head>
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
        <AuthGate />
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
  useEffect(() => {
    if (auth.data?.configured && auth.data.signedIn) return connectEvents();
  }, [auth.data?.configured, auth.data?.signedIn]);

  if (auth.isPending) return <div className="splash" />;
  if (auth.isError)
    return (
      <ConnectionUnavailable
        onRetry={() => void auth.refetch()}
        message={`Couldn’t check Google sign-in with this Mailfast server: ${auth.error.message}`}
      />
    );
  if (!auth.data.configured || !auth.data.signedIn) return <Setup status={auth.data} />;
  return <Layout />;
}

function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");
  return (
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
  );
}

function AppContent() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  const [initialQuery, setInitialQuery] = useState<string | undefined>();
  const [pairBrowserOpen, setPairBrowserOpen] = useState(false);
  const { toggleSidebar } = useSidebar();
  useEffect(() => {
    const onCommand = (event: Event) => {
      setInitialQuery(event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : undefined);
      setMenuOpen(true);
    };
    window.addEventListener("mailfast:command", onCommand);
    return () => window.removeEventListener("mailfast:command", onCommand);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName));
      if (
        ((event.ctrlKey || event.metaKey) && ["f", "k"].includes(event.key.toLowerCase())) ||
        (event.key === "/" && !typing)
      ) {
        event.preventDefault();
        if (!menuOpenRef.current) setInitialQuery(undefined);
        setMenuOpen(true);
        const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
        input?.focus();
        input?.select();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <>
      <AppContextMenu>
        <Sidebar
          onSearch={() => {
            setInitialQuery(undefined);
            setMenuOpen(true);
          }}
          onPairBrowser={() => setPairBrowserOpen(true)}
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
        />
        <PairBrowserDialog open={pairBrowserOpen} onOpenChange={setPairBrowserOpen} />
      </AppContextMenu>
    </>
  );
}

function Sidebar({ onSearch, onPairBrowser }: { onSearch: () => void; onPairBrowser: () => void }) {
  const account = useQuery(authQuery).data?.account ?? "";
  const { data: labels } = useLiveQuery({ query: (q) => q.from({ l: labelsCollection }) });
  const { state } = useSidebar();
  const system = SIDEBAR_ORDER.map((id) => labels.find((l) => l.id === id) ?? { id, name: labelName(id), unread: 0 });
  const user = labels
    .filter((l) => l.type === "user" && !HIDDEN_LABELS.has(l.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <MailSidebar collapsible="icon" aria-label="Mail navigation">
      <SidebarHeader className="group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:pb-0">
        <div className="flex min-w-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Account menu"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 text-left hover:bg-sidebar-accent group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
              >
                <MailAvatar name="" email={account} className="size-8 group-data-[collapsible=icon]:size-7" />
                <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <span className="block font-semibold text-foreground">Mailfast</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{account}</span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60" align="start">
              <DropdownMenuLabel className="truncate">{account}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void api.syncNow();
                }}
              >
                <Icon name="ALL" />
                Sync now
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onPairBrowser}>
                <Icon name="external" />
                Pair another browser…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void api.logout().then(() => {
                    queryClient.clear();
                    window.location.reload();
                  });
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SidebarTrigger
            className="group-data-[collapsible=icon]:hidden"
            aria-label={state === "collapsed" ? "Expand sidebar" : "Collapse sidebar"}
          />
        </div>
        <SidebarTrigger
          className="hidden group-data-[collapsible=icon]:inline-flex group-data-[collapsible=icon]:size-8"
          aria-label="Expand sidebar"
        />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-label="Search mail"
              className="rounded-lg border bg-background text-muted-foreground group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:text-sidebar-foreground group-data-[collapsible=icon]:hover:bg-sidebar-accent group-data-[collapsible=icon]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:active:bg-sidebar-accent group-data-[collapsible=icon]:active:text-sidebar-accent-foreground"
              onClick={onSearch}
              tooltip="Search mail (Ctrl K)"
            >
              <Icon name="search" />
              <span>Search mail</span>
              <kbd className="ml-auto group-data-[collapsible=icon]:hidden">Ctrl K</kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
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
