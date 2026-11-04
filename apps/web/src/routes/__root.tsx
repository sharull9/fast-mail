import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ClientOnly,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { api } from "../lib/api";
import { authQuery, connectEvents, labelsCollection, prefetchLabel, queryClient, statusQuery } from "../lib/data";
import { HIDDEN_LABELS, SIDEBAR_ORDER, labelName } from "../lib/format";
import { Setup } from "../components/Setup";
import appCss from "../styles.css?url";

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
    <html lang="en">
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
  const auth = useQuery(authQuery);
  useEffect(() => connectEvents(), []);

  if (auth.isPending) return <div className="splash" />;
  if (auth.isError) return <div className="splash error">Can’t reach the Mailfast service: {auth.error.message}</div>;
  if (!auth.data.configured || !auth.data.signedIn) return <Setup status={auth.data} />;
  return <Layout />;
}

function Layout() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}

function Sidebar() {
  const { data: labels } = useLiveQuery({ query: (q) => q.from({ l: labelsCollection }) });
  const system = SIDEBAR_ORDER.map(
    (id) => labels.find((l) => l.id === id) ?? (id === "ALL" ? { id, name: "All Mail", unread: 0 } : null),
  ).filter((l) => l !== null);
  const user = labels
    .filter((l) => l.type === "user" && !HIDDEN_LABELS.has(l.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <nav className="sidebar">
      <div className="brand">
        <span className="logo">✉</span> Mailfast
      </div>
      <SearchBox />
      <ul className="labels">
        {system.map((l) => (
          <LabelLink key={l.id} id={l.id} name={labelName(l.id, l.name)} unread={l.unread} />
        ))}
      </ul>
      {user.length > 0 && (
        <>
          <div className="section">Labels</div>
          <ul className="labels">
            {user.map((l) => (
              <LabelLink key={l.id} id={l.id} name={l.name} unread={l.unread} />
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}

function LabelLink({ id, name, unread }: { id: string; name: string; unread: number }) {
  return (
    <li>
      <Link
        to="/mail/$labelId"
        params={{ labelId: id }}
        className="label"
        activeProps={{ className: "label active" }}
        onMouseEnter={() => prefetchLabel(id)}
      >
        <span className="label-name">{name}</span>
        {unread > 0 && id !== "SENT" && id !== "DRAFT" && <span className="count">{unread}</span>}
      </Link>
    </li>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const current = useRouterState({
    select: (s) => (s.location.pathname === "/search" ? (s.location.search as { q?: string }).q : undefined),
  });
  const [value, setValue] = useState(current ?? "");
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA/.test(target.tagName)) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Local FTS answers in a few ms, so search as you type with a short debounce.
  const go = (q: string, replace: boolean) => {
    if (q.trim()) void navigate({ to: "/search", search: { q }, replace });
  };

  return (
    <input
      ref={ref}
      className="search"
      placeholder="Search mail  ( / )"
      value={value}
      onChange={(e) => {
        const q = e.target.value;
        setValue(q);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => go(q, current !== undefined), 80);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") go(value, false);
        if (e.key === "Escape") {
          setValue("");
          e.currentTarget.blur();
          void navigate({ to: "/mail/$labelId", params: { labelId: "INBOX" } });
        }
      }}
    />
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
  const auth = useQuery(authQuery).data;
  return (
    <footer className="statusbar">
      <span className={`dot ${status?.phase ?? "idle"}`} />
      <span title={status?.error ?? undefined}>{PHASE_TEXT[status?.phase ?? "idle"]}</span>
      {status && <span className="muted">{status.messagesStored.toLocaleString()} messages cached</span>}
      {status && status.pendingActions > 0 && <span className="muted">{status.pendingActions} pending</span>}
      <span className="spacer" />
      <button className="link" onClick={() => void api.syncNow()}>
        Sync now
      </button>
      <span className="muted">{auth?.account}</span>
      <button
        className="link"
        onClick={async () => {
          await api.logout();
          queryClient.clear();
          await queryClient.invalidateQueries();
          window.location.reload();
        }}
      >
        Sign out
      </button>
    </footer>
  );
}
