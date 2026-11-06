import { useCallback } from "react";

import { Outlet, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";

import { INBOX_TABS, inboxCategoryLabel, isInboxCategory } from "@mailfast/shared";

import { useLiveQuery } from "@tanstack/react-db";

import { ThreadList } from "@/components/thread-list";

import { connectionQuery, loadMore, queryClient, threadsCollection, labelsCollection } from "@/lib/data";

import { Icon } from "@/components/icon";

import { IconButton } from "@/components/icon-button";

import { openCommandMenu } from "@/components/app-context-menu";

import { labelName } from "@/lib/format";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EmptyPreview } from "@/components/empty-preview";

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

import { useIsMobile } from "@/hooks/use-mobile";

import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/mail/$labelId")({
  // Runs on hover too (defaultPreload: "intent"), so the mailbox is synced before the click.

  loader: async ({ params }) => {
    const connection = await queryClient.ensureQueryData(connectionQuery).catch(() => undefined);

    if (connection?.paired) await threadsCollection(params.labelId).preload();
  },

  component: Mailbox,
});

function Mailbox() {
  const { labelId } = Route.useParams();

  const threadId = useParams({ strict: false }).threadId;

  const navigate = useNavigate();

  const isMobile = useIsMobile();

  const collection = threadsCollection(labelId);

  const { data: labels } = useLiveQuery({ query: (q) => q.from({ l: labelsCollection }) });

  const categoryId = (id: string) => inboxCategoryLabel(id) ?? (id === "INBOX_PRIMARY" ? "CATEGORY_PERSONAL" : id);

  const label = labels.find((l) => l.id === labelId) ?? labels.find((l) => l.id === categoryId(labelId));

  const { data: threads, isLoading } = useLiveQuery({
    query: (q) => q.from({ t: collection }).orderBy(({ t }) => t.lastDate, "desc"),
  });

  const open = useCallback(
    (id: string) => void navigate({ to: "/mail/$labelId/$threadId", params: { labelId, threadId: id }, replace: true }),

    [navigate, labelId],
  );

  const close = useCallback(() => void navigate({ to: "/mail/$labelId", params: { labelId } }), [navigate, labelId]);

  const more = useCallback(() => void loadMore(labelId), [labelId]);

  const list = (
    <section className="list-col @container h-full">
      <header className="list-head">
        {labelId === "INBOX" || isInboxCategory(labelId) ? (
          <Tabs
            value={labelId}

            onValueChange={(id) => void navigate({ to: "/mail/$labelId", params: { labelId: id } })}

            className="inbox-tabs"
          >
            <TabsList aria-label="Inbox categories">
              {INBOX_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.name}

                  {(labels.find((l) => l.id === categoryId(tab.id))?.unread ?? 0) > 0 && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] leading-none font-medium text-muted-foreground tabular-nums group-data-[state=active]/tab:bg-primary/20 group-data-[state=active]/tab:text-primary">
                      {labels.find((l) => l.id === categoryId(tab.id))?.unread}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <span className="min-w-0 truncate text-sm font-semibold">{labelName(labelId, label?.name)}</span>
        )}

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
          {/* Next to the category tabs (~300px) the counts only fit in a wider list panel. */}
          <span
            className={
              labelId === "INBOX" || isInboxCategory(labelId)
                ? "hidden max-w-52 truncate text-xs text-muted-foreground @min-[560px]:block"
                : "hidden max-w-52 truncate text-xs text-muted-foreground @min-[380px]:block"
            }
          >
            {Math.max(threads.length, label?.total ?? 0).toLocaleString()} conversations · {label?.unread ?? 0} unread
          </span>

          <IconButton label="Search this mailbox" onClick={() => openCommandMenu()}>
            <Icon name="search" />
          </IconButton>
        </div>
      </header>

      {isLoading ? (
        <div className="loading-list" aria-label="Loading mail">
          <Skeleton className="h-12 w-full" />

          <Skeleton className="h-12 w-full" />

          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <ThreadList
          key={labelId}

          labelId={labelId}

          total={label?.total}

          threads={threads}

          selectedId={threadId}

          onOpen={open}

          onClose={close}

          onEndReached={more}

          empty="Nothing here."
        />
      )}
    </section>
  );

  if (isMobile) return <div className="mailbox">{threadId ? <Outlet /> : list}</div>;

  return (
    <div className="mailbox">
      <ResizablePanelGroup>
        <ResizablePanel id="list" defaultSize="40%" minSize="30%">
          {list}
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel id="preview" defaultSize="60%" minSize="30%">
          {threadId ? <Outlet /> : <EmptyPreview />}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
