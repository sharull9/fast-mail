import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ThreadList } from "@/components/thread-list";
import { ThreadView } from "@/components/thread-view";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyPreview } from "@/components/empty-preview";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  usePanelRef,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { searchQuery } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): { q: string; t?: string } => ({
    q: typeof s.q === "string" ? s.q : "",
    t: typeof s.t === "string" ? s.t : undefined,
  }),
  component: Search,
});

function Search() {
  const { q, t } = Route.useSearch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const listPanelRef = usePanelRef();
  const [isListCollapsed, setIsListCollapsed] = useState(() => {
    try {
      return localStorage.getItem("mailfast.list-collapsed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (listPanelRef.current) {
      if (isListCollapsed && !listPanelRef.current.isCollapsed()) {
        listPanelRef.current.collapse();
      } else {
        setIsListCollapsed(listPanelRef.current.isCollapsed());
      }
    }
  }, []);

  const toggleList = useCallback(() => {
    const panel = listPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, []);

  // Local FTS5 over cached metadata, including while background sync is running.
  const { data } = useQuery(searchQuery(q));
  const threads = data?.threads ?? [];

  const open = useCallback(
    (id: string) => void navigate({ to: "/search", search: { q, t: id }, replace: true }),
    [navigate, q],
  );
  const close = useCallback(() => void navigate({ to: "/search", search: { q }, replace: true }), [navigate, q]);

  const list = (
    <section className={cn("list-col @container h-full", isListCollapsed && "list-collapsed w-12 min-w-12 overflow-hidden")}>
      {isListCollapsed ? (
        <header className="flex h-11 shrink-0 items-center justify-center border-b px-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={toggleList}
                aria-label="Expand list"
              >
                <PanelLeftOpen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand list</TooltipContent>
          </Tooltip>
        </header>
      ) : (
        <header className="list-head">
          <span className="min-w-0 truncate text-sm font-semibold">Search: {q}</span>
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            <span className="hidden max-w-52 truncate text-xs text-muted-foreground @min-[380px]:block">
              {threads.length.toLocaleString()} conversations · {threads.filter((thread) => thread.unread).length} unread
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate({ to: "/mail/$labelId", params: { labelId: "INBOX" } })}
            >
              Clear search
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={toggleList}
                  aria-label="Collapse list"
                >
                  <PanelLeftClose className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse list</TooltipContent>
            </Tooltip>
          </div>
        </header>
      )}
      <ThreadList
        key={`${q}:${isListCollapsed ? "collapsed" : "expanded"}`}
        threads={threads}
        selectedId={t}
        onOpen={open}
        onClose={close}
        collapsed={isListCollapsed}
        empty="No matches in cached mail yet."
      />
    </section>
  );
  const preview = t ? (
    <ThreadView threadId={t} onClose={close} />
  ) : (
    <EmptyPreview
      summary={`${threads.length.toLocaleString()} search results · ${threads.filter((thread) => thread.unread).length.toLocaleString()} unread`}
    />
  );
  if (isMobile) return <div className="mailbox">{t ? preview : list}</div>;
  return (
    <div className="mailbox">
      <ResizablePanelGroup>
        <ResizablePanel
          id="list"
          panelRef={listPanelRef}
          defaultSize="40%"
          minSize="20%"
          collapsedSize="48px"
          collapsible
          onResize={(panelSize) => {
            const collapsed = listPanelRef.current?.isCollapsed() ?? panelSize.inPixels <= 52;
            setIsListCollapsed(collapsed);
            try {
              localStorage.setItem("mailfast.list-collapsed", String(collapsed));
            } catch {}
          }}
        >
          {list}
        </ResizablePanel>
        <ResizableHandle onDoubleClick={toggleList} />
        <ResizablePanel id="preview" defaultSize="60%" minSize="20%">
          {preview}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
