import { QueryClient, queryOptions } from "@tanstack/react-query";
import { createCollection, createOptimisticAction } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import {
  actionDelta,
  applyDelta,
  type Label,
  type ThreadAction,
  type ThreadDetail,
  type ThreadRow,
} from "@mailfast/shared";
import { api } from "./api";

/**
 * Data layer.
 *  - TanStack DB collections hold what lists render (labels, one collection per
 *    mailbox). Live queries keep components in sync, and optimistic actions
 *    update every affected list in the same tick.
 *  - TanStack Query holds request-shaped data (thread detail, search, status)
 *    and powers hover / keyboard prefetching.
 * The server pushes change events over SSE; we only invalidate the keys it names.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // SSE invalidates when data actually changes
      // No GC timers during build-time prerender (they would keep the build process alive).
      gcTime: typeof window === "undefined" ? Infinity : 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ------------------------------------------------------------------ labels

export const labelsCollection = createCollection(
  queryCollectionOptions<Label>({
    id: "labels",
    queryKey: ["labels"],
    queryFn: ({ signal }) => api.labels(signal),
    queryClient,
    getKey: (l) => l.id,
    // Sync starts when a live query subscribes, not at import (keeps prerender inert).
    startSync: false,
  }),
);

// ------------------------------------------------------------------ threads per mailbox

const PAGE = 200;
const limits = new Map<string, number>();
const hasMoreByLabel = new Map<string, boolean>();

function createThreadsCollection(labelId: string) {
  return createCollection(
    queryCollectionOptions<ThreadRow>({
      id: `threads:${labelId}`,
      queryKey: ["threads", labelId],
      queryFn: async ({ signal }) => {
        const res = await api.threads(labelId, limits.get(labelId) ?? PAGE, signal);
        hasMoreByLabel.set(labelId, res.hasMore);
        return res.threads;
      },
      queryClient,
      getKey: (t) => t.id,
      startSync: false,
      gcTime: 10 * 60_000,
    }),
  );
}

type ThreadsCollection = ReturnType<typeof createThreadsCollection>;
const threadCollections = new Map<string, ThreadsCollection>();

/** One stable collection per mailbox (business scope), memoised for the app's lifetime. */
export function threadsCollection(labelId: string): ThreadsCollection {
  let c = threadCollections.get(labelId);
  if (!c) {
    c = createThreadsCollection(labelId);
    threadCollections.set(labelId, c);
  }
  return c;
}

export function hasMore(labelId: string) {
  return hasMoreByLabel.get(labelId) ?? false;
}

const loadingMore = new Set<string>();
export async function loadMore(labelId: string) {
  if (!hasMore(labelId) || loadingMore.has(labelId)) return;
  loadingMore.add(labelId);
  limits.set(labelId, (limits.get(labelId) ?? PAGE) + PAGE);
  try {
    await threadsCollection(labelId).utils.refetch();
  } finally {
    loadingMore.delete(labelId);
  }
}

/** Whether a thread with these labels belongs in a mailbox view. */
function belongs(labelId: string, labelIds: string[]): boolean {
  if (labelId === "ALL") return !labelIds.includes("SPAM") && !labelIds.includes("TRASH");
  return labelIds.includes(labelId);
}

// ------------------------------------------------------------------ queries

export const threadQuery = (id: string) =>
  queryOptions({
    queryKey: ["thread", id],
    queryFn: ({ signal }) => api.thread(id, signal),
    staleTime: 60_000,
  });

export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ["search", q],
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  });

export const authQuery = queryOptions({ queryKey: ["auth"], queryFn: () => api.authStatus(), staleTime: Infinity });
export const statusQuery = queryOptions({ queryKey: ["status"], queryFn: () => api.status(), staleTime: Infinity });

// ------------------------------------------------------------------ prefetch (gitfaster-style "just in time")

const hinted = new Map<string, number>();

/** Warm a thread on hover / keyboard focus. Cheap: the server answers from SQLite. */
export function prefetchThread(id: string) {
  void queryClient.prefetchQuery(threadQuery(id));
}

/** Warm a mailbox on hover: starts its collection sync and asks the server to fill it from Gmail if needed. */
export function prefetchLabel(labelId: string) {
  void threadsCollection(labelId).preload();
  const last = hinted.get(labelId) ?? 0;
  if (Date.now() - last > 60_000) {
    hinted.set(labelId, Date.now());
    void api.prefetch({ labelIds: [labelId] });
  }
}

// ------------------------------------------------------------------ optimistic actions

/** Applies a thread action to every loaded mailbox, the open thread and label counts instantly. */
export const runThreadAction = createOptimisticAction<{ threadIds: string[]; action: ThreadAction }>({
  onMutate: ({ threadIds, action }) => {
    const delta = actionDelta(action);
    const ids = new Set(threadIds);

    // Find current rows (from any loaded mailbox) to compute new label sets.
    const current = new Map<string, ThreadRow>();
    for (const c of threadCollections.values()) {
      for (const id of ids) {
        const row = c.get(id);
        if (row && !current.has(id)) current.set(id, row);
      }
    }

    for (const [labelId, c] of threadCollections) {
      for (const id of ids) {
        const row = current.get(id);
        if (!row) continue;
        const next = applyDelta(row.labelIds, delta);
        const inside = c.has(id);
        if (inside && !belongs(labelId, next)) c.delete(id);
        else if (inside) {
          c.update(id, (d) => {
            d.labelIds = next;
            d.unread = next.includes("UNREAD");
            d.starred = next.includes("STARRED");
            d.important = next.includes("IMPORTANT");
          });
        } else if (belongs(labelId, next) && c.status === "ready") {
          c.insert({ ...row, labelIds: next, unread: next.includes("UNREAD"), starred: next.includes("STARRED") });
        }
      }
    }

    // Unread badge counts.
    for (const row of current.values()) {
      const next = applyDelta(row.labelIds, delta);
      const wasUnread = row.labelIds.includes("UNREAD");
      const isUnread = next.includes("UNREAD");
      const touched = new Set([...row.labelIds, ...next]);
      for (const l of touched) {
        if (!labelsCollection.has(l)) continue;
        const before = wasUnread && row.labelIds.includes(l) ? 1 : 0;
        const after = isUnread && next.includes(l) ? 1 : 0;
        if (before !== after)
          labelsCollection.update(l, (d) => void (d.unread = Math.max(0, d.unread + after - before)));
      }
    }

    // Open thread detail (Query cache).
    for (const id of ids) {
      queryClient.setQueryData<ThreadDetail>(["thread", id], (old) => {
        if (!old) return old;
        const labelIds = applyDelta(old.thread.labelIds, delta);
        return {
          ...old,
          thread: {
            ...old.thread,
            labelIds,
            unread: labelIds.includes("UNREAD"),
            starred: labelIds.includes("STARRED"),
          },
          messages: old.messages.map((m) => {
            const l = applyDelta(m.labelIds, delta);
            return { ...m, labelIds: l, unread: l.includes("UNREAD"), starred: l.includes("STARRED") };
          }),
        };
      });
    }
  },
  mutationFn: async ({ threadIds, action }) => {
    // The server applies the change to SQLite synchronously and queues the Gmail call,
    // so reading back now returns confirmed local state.
    await api.act(threadIds, action);
    await Promise.all([
      ...[...threadCollections.values()].filter((c) => c.status === "ready").map((c) => c.utils.refetch()),
      labelsCollection.utils.refetch(),
    ]);
    for (const id of threadIds) void queryClient.invalidateQueries({ queryKey: ["thread", id] });
  },
});

// ------------------------------------------------------------------ server events

let source: EventSource | null = null;

/** Subscribes to the sidecar's SSE stream and invalidates exactly what changed. */
export function connectEvents() {
  if (source) return () => {};
  source = new EventSource("/api/events");
  source.onmessage = (e) => {
    const ev = JSON.parse(e.data as string) as import("@mailfast/shared").ServerEvent;
    switch (ev.type) {
      case "status":
        queryClient.setQueryData(["status"], ev.status);
        if (ev.status.phase === "signed-out") void queryClient.invalidateQueries({ queryKey: ["auth"] });
        break;
      case "threads-changed":
        for (const l of ev.labelIds) {
          if (threadCollections.has(l)) void queryClient.invalidateQueries({ queryKey: ["threads", l], exact: true });
        }
        void queryClient.invalidateQueries({ queryKey: ["search"] });
        break;
      case "thread-updated":
        void queryClient.invalidateQueries({ queryKey: ["thread", ev.threadId] });
        break;
      case "labels-changed":
        void labelsCollection.utils.refetch();
        break;
    }
  };
  return () => {
    source?.close();
    source = null;
  };
}
