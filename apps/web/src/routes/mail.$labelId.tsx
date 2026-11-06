import { useCallback, useEffect, useMemo } from "react";

import { Outlet, createFileRoute, retainSearchParams, useNavigate, useParams } from "@tanstack/react-router";

import { INBOX_TABS, inboxCategoryLabel, isInboxCategory } from "@mailfast/shared";

import { useLiveQuery } from "@tanstack/react-db";

import { useQuery } from "@tanstack/react-query";

import { ThreadList } from "@/components/thread-list";

import { ScopeFilter } from "@/components/scope-filter";

import { DateRangeFilter } from "@/components/date-range-filter";

import { Button } from "@/components/ui/button";

import {
  connectionQuery,
  statusQuery,
  loadMore,
  queryClient,
  threadsCollection,
  threadTotalQuery,
  labelsCollection,
} from "@/lib/data";

import { threadDateRange, labelName, SCOPES, validateDateRange } from "@/lib/format";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Inbox, Layers, Users, type LucideIcon } from "lucide-react";

/** Icons for the inbox category tabs (Gmail's own metaphors for Primary / Social / Updates). */
const TAB_ICONS: Record<string, LucideIcon> = {
  INBOX: Layers,
  INBOX_PRIMARY: Inbox,
  INBOX_SOCIAL: Users,
  INBOX_UPDATES: Info,
};

import { EmptyPreview } from "@/components/empty-preview";

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

import { useIsMobile } from "@/hooks/use-mobile";

import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/mail/$labelId")({
  validateSearch: (search) => validateDateRange(search),

  search: { middlewares: [retainSearchParams(["from", "to"])] },

  // Runs on hover too (defaultPreload: "intent"), so the mailbox is synced before the click.

  loaderDeps: ({ search }) => search,

  loader: async ({ params, deps }) => {
    const connection = await queryClient.ensureQueryData(connectionQuery).catch(() => undefined);

    if (connection?.paired) {
      const status = await queryClient.ensureQueryData(statusQuery).catch(() => undefined);
      await threadsCollection(
        params.labelId,
        threadDateRange(validateDateRange(deps, status?.oldestMessageDate)),
      ).preload();
    }
  },

  component: Mailbox,
});

function Mailbox() {
  const { labelId } = Route.useParams();

  const search = Route.useSearch();
  const { data: status } = useQuery(statusQuery);
  const range = useMemo(
    () => validateDateRange(search, status?.oldestMessageDate),
    [search, status?.oldestMessageDate],
  );

  const hasRange = !!(range.from || range.to);

  const inbox = labelId === "INBOX" || isInboxCategory(labelId) || labelId.startsWith("CATEGORY_");

  const threadId = useParams({ strict: false }).threadId;

  const navigate = useNavigate();

  const isMobile = useIsMobile();

  useEffect(() => {
    if (search.from === range.from && search.to === range.to) return;
    void navigate({
      from: Route.fullPath,
      search: (previous) => ({ ...previous, from: range.from, to: range.to }),
      replace: true,
    });
  }, [navigate, search.from, search.to, range.from, range.to]);

  const bounds = useMemo(() => threadDateRange(range), [range.from, range.to]);

  const collection = threadsCollection(labelId, bounds);

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

  const more = useCallback(() => void loadMore(labelId, bounds), [labelId, bounds]);

  const { data: rangeTotal } = useQuery(threadTotalQuery(labelId, bounds));

  const total = hasRange ? (rangeTotal ?? 0) : label?.total;

  const changeRange = (next: typeof range) =>
    void navigate({ from: Route.fullPath, search: (previous) => ({ ...previous, from: next.from, to: next.to }) });

  const categories = inbox ? (
    <Tabs
      value={INBOX_TABS.find((tab) => categoryId(tab.id) === labelId)?.id ?? labelId}
      onValueChange={(id) => void navigate({ to: "/mail/$labelId", params: { labelId: id } })}
      className="inbox-tabs h-8 justify-center gap-0"
    >
      <TabsList aria-label="Inbox categories">
        {INBOX_TABS.map((tab) => {
          const TabIcon = TAB_ICONS[tab.id] ?? Inbox;
          const unread = labels.find((l) => l.id === categoryId(tab.id))?.unread ?? 0;
          // Sized by the list panel (container query on .list-col), not the window: below 30rem the
          // tabs collapse to icons, the count becomes a dot, and the name moves into the tooltip.
          return (
            // The tooltip wraps the tab's content, not the tab: TooltipTrigger would overwrite the tab's
            // data-state="active" (it sets its own data-state), which is what styles the selected tab.
            <TabsTrigger key={tab.id} value={tab.id} aria-label={tab.name} className="relative @max-[30rem]:px-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5">
                    <TabIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="@max-[30rem]:hidden">{tab.name}</span>
                    {unread > 0 && (
                      <span
                        aria-hidden="true"
                        className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] leading-none font-medium text-muted-foreground tabular-nums group-data-[state=active]/tab:bg-primary/20 group-data-[state=active]/tab:text-primary @max-[30rem]:hidden"
                      >
                        {unread}
                      </span>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{unread > 0 ? `${tab.name} · ${unread} unread` : tab.name}</TooltipContent>
              </Tooltip>
              {unread > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 hidden size-1.5 rounded-full bg-primary @max-[30rem]:block"
                />
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  ) : undefined;

  const list = (
    <section className="list-col @container h-full">
      <header className="list-head">
        {inbox || SCOPES.includes(labelId) ? (
          <ScopeFilter
            labelId={labelId}
            labels={labels}
            onChange={(id) => void navigate({ to: "/mail/$labelId", params: { labelId: id } })}
          />
        ) : (
          <span className="min-w-0 truncate text-sm font-semibold">{labelName(labelId, label?.name)}</span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <DateRangeFilter range={range} onChange={changeRange} />
          <span className="hidden max-w-52 truncate text-xs text-muted-foreground @min-[820px]:block">
            {Math.max(threads.length, total ?? 0).toLocaleString()} conversations · {label?.unread ?? 0} unread
          </span>
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
          key={`${labelId}:${bounds.after}:${bounds.before}`}
          labelId={labelId}
          total={total}
          threads={threads}
          toolbarStart={categories}
          emptyAction={
            hasRange ? (
              <Button variant="outline" size="sm" onClick={() => changeRange({})}>
                Clear date filter
              </Button>
            ) : undefined
          }
          selectedId={threadId}
          onOpen={open}
          onClose={close}
          onEndReached={more}
          empty={hasRange ? "No conversations in this date range" : "Nothing here."}
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
