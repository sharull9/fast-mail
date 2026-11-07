import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ThreadList } from "@/components/thread-list";
import { ThreadView } from "@/components/thread-view";
import { Button } from "@/components/ui/button";
import { EmptyPreview } from "@/components/empty-preview";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { searchQuery } from "@/lib/data";

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
  // Local FTS5 over cached metadata, including while background sync is running.
  const { data } = useQuery(searchQuery(q));
  const threads = data?.threads ?? [];

  const open = useCallback(
    (id: string) => void navigate({ to: "/search", search: { q, t: id }, replace: true }),
    [navigate, q],
  );
  const close = useCallback(() => void navigate({ to: "/search", search: { q }, replace: true }), [navigate, q]);

  const list = (
    <section className="list-col @container h-full">
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
        </div>
      </header>
      <ThreadList
        key={q}
        threads={threads}
        selectedId={t}
        onOpen={open}
        onClose={close}
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
        <ResizablePanel id="list" defaultSize="40%" minSize="30%">
          {list}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="preview" defaultSize="60%" minSize="30%">
          {preview}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
