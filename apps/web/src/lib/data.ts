import { clearContactCache } from "@/lib/contact-cache";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { createCollection, createOptimisticAction } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import {
  actionDelta,
  belongsInMailbox,
  INBOX_TABS,
  applyDelta,
  type Label,
  type ConnectionStatus,
  type ServerEvent,
  type ThreadAction,
  type ThreadDetail,
  type ThreadRow,
  type ThreadDateRange,
} from "@mailfast/shared";
import { ApiError, api, getActiveAccountId, setActiveAccountId } from "@/lib/api";

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
      retry: (failureCount, error) => !(error instanceof ApiError && error.status === 401) && failureCount < 1,
    },
  },
});

export const connectionQuery = queryOptions({
  queryKey: ["connection"],
  queryFn: () => api.connection(),
  staleTime: Infinity,
  retry: false,
});

if (typeof window !== "undefined") {
  window.addEventListener("mailfast:session-invalid", () => {
    queryClient.setQueryData<ConnectionStatus>(["connection"], (old) => (old ? { ...old, paired: false } : old));
    void queryClient.invalidateQueries({ queryKey: ["connection"] });
  });
}

// ------------------------------------------------------------------ labels

function createLabelsCollection(accountId: string | null) {
  return createCollection(
    queryCollectionOptions<Label>({
      id: `labels:${accountId}`,
      queryKey: ["labels", accountId],
      queryFn: ({ signal }) => api.labels(signal, accountId),
      queryClient,
      getKey: (l) => l.id,
      // Sync starts when a live query subscribes, not at import (keeps prerender inert).
      startSync: false,
    }),
  );
}
const labelCollections = new Map<string | null, ReturnType<typeof createLabelsCollection>>();
function accountLabels(accountId: string | null) {
  let collection = labelCollections.get(accountId);
  if (!collection) {
    collection = createLabelsCollection(accountId);
    labelCollections.set(accountId, collection);
  }
  return collection;
}
export let labelsCollection = accountLabels(getActiveAccountId());

// ------------------------------------------------------------------ threads per mailbox

const PAGE = 200;
const limits = new Map<string, number>();
const hasMoreByLabel = new Map<string, boolean>();

const threadScopes = new Map<string, { accountId: string | null; labelId: string; range: ThreadDateRange }>();
const threadsKey = (accountId: string | null, labelId: string, range: ThreadDateRange) =>
  JSON.stringify([accountId, labelId, range.after ?? null, range.before ?? null]);
const withinRange = (date: number, range: ThreadDateRange) =>
  (range.after === undefined || date >= range.after) && (range.before === undefined || date < range.before);

function createThreadsCollection(labelId: string, accountId: string | null, range: ThreadDateRange) {
  const key = threadsKey(accountId, labelId, range);
  return createCollection(
    queryCollectionOptions<ThreadRow>({
      id: `threads:${key}`,
      queryKey: ["threads", accountId, labelId, range],
      queryFn: async ({ signal }) => {
        // Route preload can run before AuthGate has resolved the saved account ID.
        const auth = await queryClient.ensureQueryData(authQuery).catch(() => null);
        if (!auth?.accounts.some((account) => account.id === accountId)) return [];
        const res = await api.threads(labelId, limits.get(key) ?? PAGE, signal, accountId, range);
        hasMoreByLabel.set(key, res.hasMore);
        queryClient.setQueryData(threadTotalQuery(labelId, range, accountId).queryKey, res.total ?? res.threads.length);
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

/** One stable collection per account, mailbox and normalized range. */
export function threadsCollection(labelId: string, range?: ThreadDateRange): ThreadsCollection;
export function threadsCollection(accountId: string, labelId: string, range?: ThreadDateRange): ThreadsCollection;
export function threadsCollection(
  accountOrLabel: string,
  labelOrRange?: string | ThreadDateRange,
  requestedRange: ThreadDateRange = {},
): ThreadsCollection {
  const accountId = typeof labelOrRange === "string" ? accountOrLabel : getActiveAccountId();
  const labelId = typeof labelOrRange === "string" ? labelOrRange : accountOrLabel;
  const range = typeof labelOrRange === "string" ? requestedRange : (labelOrRange ?? {});
  const key = threadsKey(accountId, labelId, range);
  let c = threadCollections.get(key);
  if (!c) {
    c = createThreadsCollection(labelId, accountId, range);
    threadCollections.set(key, c);
    threadScopes.set(key, { accountId, labelId, range });
  }
  return c;
}

function activeCollections(accountId = getActiveAccountId()) {
  return [...threadCollections].flatMap(([key, collection]) => {
    const scope = threadScopes.get(key);
    return scope?.accountId === accountId ? [[scope, collection] as const] : [];
  });
}

export function hasMore(labelId: string, range: ThreadDateRange = {}) {
  return hasMoreByLabel.get(threadsKey(getActiveAccountId(), labelId, range)) ?? false;
}

export function threadTotalQuery(labelId: string, range: ThreadDateRange, accountId = getActiveAccountId()) {
  return queryOptions({
    queryKey: ["thread-total", accountId, labelId, range],
    queryFn: () => 0,
    enabled: false,
  });
}

const loadingMore = new Set<string>();
export async function loadMore(labelId: string, range: ThreadDateRange = {}) {
  const key = threadsKey(getActiveAccountId(), labelId, range);
  if (!hasMore(labelId, range) || loadingMore.has(key)) return;
  loadingMore.add(key);
  limits.set(key, (limits.get(key) ?? PAGE) + PAGE);
  try {
    await threadsCollection(labelId, range).utils.refetch();
  } finally {
    loadingMore.delete(key);
  }
}

/** Whether a thread with these labels belongs in a mailbox view. */
function belongs(labelId: string, labelIds: string[]): boolean {
  return belongsInMailbox(labelId, labelIds);
}

// ------------------------------------------------------------------ queries

export const threadQuery = (id: string, accountId = getActiveAccountId()) =>
  queryOptions({
    queryKey: ["thread", accountId, id],
    queryFn: ({ signal }) => api.thread(id, signal, accountId),
    staleTime: 60_000,
  });

export const searchQuery = (q: string, accountId = getActiveAccountId()) =>
  queryOptions({
    queryKey: ["search", accountId, q],
    queryFn: ({ signal }) => api.search(q, signal, accountId),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  });

let accountRevision = 0;
export const authQuery = queryOptions({
  queryKey: ["auth"],
  queryFn: async () => {
    const revision = accountRevision;
    const status = await api.authStatus();
    if (revision === accountRevision) activateAccount(status.activeAccountId);
    return status;
  },
  staleTime: Infinity,
  // Once signed in, the event stream pushes `accounts-changed` (added/removed accounts) and status updates,
  // so polling is only needed before the first sign-in, when no event stream is open yet.
  refetchInterval: (query) => (query.state.data?.signedIn ? false : 5000),
});
function accountStatusQuery(accountId: string | null) {
  return queryOptions({ queryKey: ["status", accountId], queryFn: () => api.status(accountId), staleTime: Infinity });
}
export let statusQuery = accountStatusQuery(getActiveAccountId());

function activateAccount(id: string | null) {
  if (id === getActiveAccountId()) return;
  setActiveAccountId(id);
  labelsCollection = accountLabels(id);
  statusQuery = accountStatusQuery(id);
  hinted.clear();
}

export async function switchAccount(id: string) {
  accountRevision++;
  await queryClient.cancelQueries({ queryKey: ["auth"] });
  const status = await api.setActiveAccount(id);
  await queryClient.cancelQueries({
    predicate: (query) => !["auth", "connection"].includes(String(query.queryKey[0])),
  });
  activateAccount(status.activeAccountId);
  queryClient.setQueryData(["auth"], status);
  void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === id });
  disconnectEvents();
  connectEvents();
  window.dispatchEvent(new Event("mailfast:account-switched"));
}

export async function signOutAccount(id: string) {
  accountRevision++;
  await queryClient.cancelQueries({ queryKey: ["auth"] });
  const status = await api.logoutAccount(id);
  activateAccount(status.activeAccountId);
  queryClient.setQueryData(["auth"], status);
  disconnectEvents();
  if (status.signedIn) connectEvents();
  window.dispatchEvent(new Event("mailfast:account-switched"));
}

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
export function runThreadAction(args: { threadIds: string[]; action: ThreadAction }) {
  return runAccountAction({ ...args, accountId: getActiveAccountId() });
}
const runAccountAction = createOptimisticAction<{
  threadIds: string[];
  action: ThreadAction;
  accountId: string | null;
}>({
  onMutate: ({ threadIds, action, accountId }) => {
    const labelsCollection = accountLabels(accountId);
    const delta = actionDelta(action);
    const ids = new Set(threadIds);

    // Find current rows (from any loaded mailbox) to compute new label sets.
    const current = new Map<string, ThreadRow>();
    for (const [, c] of activeCollections(accountId)) {
      for (const id of ids) {
        const row = c.get(id);
        if (row && !current.has(id)) current.set(id, row);
      }
    }

    for (const [{ labelId, range }, c] of activeCollections(accountId)) {
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
        } else if (belongs(labelId, next) && withinRange(row.lastDate, range) && c.status === "ready") {
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
      queryClient.setQueryData<ThreadDetail>(["thread", accountId, id], (old) => {
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
  mutationFn: async ({ threadIds, action, accountId }) => {
    const labelsCollection = accountLabels(accountId);
    // The server applies the change to SQLite synchronously and queues the Gmail call,
    // so reading back now returns confirmed local state.
    await api.act(threadIds, action, accountId);
    await Promise.all([
      ...activeCollections(accountId)
        .map(([, c]) => c)
        .filter((c) => c.status === "ready")
        .map((c) => c.utils.refetch()),
      labelsCollection.utils.refetch(),
    ]);
    for (const id of threadIds) void queryClient.invalidateQueries({ queryKey: ["thread", accountId, id] });
  },
});

// ------------------------------------------------------------------ server events

let eventController: AbortController | null = null;

function disconnectEvents() {
  eventController?.abort();
  eventController = null;
}

function receiveEvent(ev: ServerEvent) {
  const id = ev.accountId ?? getActiveAccountId();
  if (ev.type === "contacts-changed") {
    clearContactCache(id);
    void queryClient.invalidateQueries({ queryKey: ["managed-contacts", id] });
    return;
  }
  if (ev.type === "account-settings-changed") {
    void queryClient.invalidateQueries({ queryKey: ["account-settings", id] });
    void queryClient.invalidateQueries({ queryKey: ["auth"] });
    return;
  }
  if (ev.type === "accounts-changed") {
    void queryClient.invalidateQueries({ queryKey: ["auth"] });
    return;
  }
  if (ev.type === "status" || ev.type === "labels-changed") {
    // Auth status includes each account's authoritative INBOX unread count.
    void queryClient.invalidateQueries({ queryKey: ["auth"] });
  }
  if (ev.type === "status") queryClient.setQueryData(["status", id], ev.status);
  if (ev.type === "thread-updated") void queryClient.invalidateQueries({ queryKey: ["thread", id, ev.threadId] });
  if (ev.type === "threads-changed") {
    for (const label of new Set([...ev.labelIds, ...INBOX_TABS.map((tab) => tab.id)])) {
      void queryClient.invalidateQueries({ queryKey: ["threads", id, label] });
    }
    void queryClient.invalidateQueries({ queryKey: ["search", id] });
  }
  if (ev.type === "chat-spaces-changed") {
    void queryClient.invalidateQueries({ queryKey: ["chat-spaces", id] });
    return;
  }
  if (ev.type === "chat-messages-changed") {
    void queryClient.invalidateQueries({ queryKey: ["chat-messages", id, ev.spaceId] });
    void queryClient.invalidateQueries({ queryKey: ["chat-spaces", id] });
    return;
  }
  if (ev.type === "labels-changed" && id === getActiveAccountId()) void labelsCollection.utils.refetch();
}

export const chatSpacesQuery = (accountId = getActiveAccountId()) =>
  queryOptions({
    queryKey: ["chat-spaces", accountId],
    queryFn: () => api.chatSpaces(accountId),
    refetchInterval: 15_000,
  });

export const chatMessagesQuery = (spaceId: string, accountId = getActiveAccountId()) =>
  queryOptions({
    queryKey: ["chat-messages", accountId, spaceId],
    queryFn: () => api.chatMessages(spaceId, accountId),
    refetchInterval: 5_000,
  });

/** Fetch SSE allows the account header and retains Electron/pairing authentication. */
export function connectEvents() {
  if (eventController) return disconnectEvents;
  const controller = new AbortController();
  eventController = controller;
  const { signal } = controller;
  void (async () => {
    while (!signal.aborted) {
      try {
        const response = await api.events(signal);
        if (!response.ok || !response.body) throw new Error("Event stream unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true }).replace(/\r/g, "");
          let end: number;
          while ((end = pending.indexOf("\n\n")) >= 0) {
            const event = pending.slice(0, end);
            pending = pending.slice(end + 2);
            const data = event
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (data) receiveEvent(JSON.parse(data) as ServerEvent);
          }
        }
      } catch {
        /* Retry temporary disconnections; abort closes this subscription. */
      }
      if (!signal.aborted)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
    }
  })();
  return disconnectEvents;
}
