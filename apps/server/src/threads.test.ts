import { afterEach, expect, mock, test } from "bun:test";
import { openMailStore, type MessageInput } from "@mailfast/db";
import type { AuthStatus } from "@mailfast/shared";
import type { AccountRuntime } from "@/accounts.ts";
import { Events } from "@/events.ts";
import { Gmail } from "@/gmail.ts";
import { Priority } from "@/limiter.ts";
import { SyncEngine } from "@/sync.ts";
import { listThreadsResponse } from "@/threads.ts";

const stores: ReturnType<typeof openMailStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function fixture() {
  const store = openMailStore({ path: ":memory:" });
  stores.push(store);
  return store;
}
function message(id: string, date: number, labelIds = ["INBOX"]): MessageInput {
  return {
    id,
    threadId: id,
    date,
    labelIds,
    fromName: "Alice",
    fromEmail: "alice@example.com",
    to: "",
    cc: "",
    subject: id,
    snippet: "",
  };
}
const authStatus: AuthStatus = {
  accounts: [],
  activeAccountId: null,
  configured: true,
  signedIn: true,
  account: "me@example.com",
};
function runtime(store: ReturnType<typeof fixture>) {
  const gmail = new Gmail({ token: async () => "test", invalidate() {} });
  const events = new Events();
  const sync = new SyncEngine(store, gmail, { status: () => authStatus, account: () => "me@example.com" }, events);
  return { store, gmail, sync, events };
}

test("store bounds include after, exclude before, count and page only matching label threads", () => {
  const store = fixture();
  store.upsertMessages(
    [
      message("old", 99),
      message("lower", 100),
      message("middle", 150),
      message("upper", 200),
      message("other-label", 125, ["SENT"]),
    ],
    null,
  );
  expect(store.listThreads("INBOX", 200, 10, 100).map((t) => t.id)).toEqual(["middle", "lower"]);
  expect(store.listThreads("INBOX", 200, 1, 100).map((t) => t.id)).toEqual(["middle"]);
  expect(store.listThreads("INBOX", 150, 1, 100).map((t) => t.id)).toEqual(["lower"]);
  expect(store.listThreads("INBOX", 100, 1, 100)).toEqual([]);
  expect(store.countThreads("INBOX", { after: 100, before: 200 })).toBe(2);
  expect(store.countThreads("INBOX", { after: 200 })).toBe(1);
  expect(store.countThreads("INBOX", { before: 100 })).toBe(1);
  expect(store.countThreads("INBOX", { after: 200, before: 100 })).toBe(0);
  const plan = store.sqlite
    .query(
      "EXPLAIN QUERY PLAN SELECT count(*) FROM thread_labels WHERE label_id = ? AND last_date >= ? AND last_date < ?",
    )
    .all("INBOX", 100, 200);
  expect(JSON.stringify(plan)).toContain("COVERING INDEX");
  expect(JSON.stringify(plan)).toContain("last_date>?");
});

test("virtual inbox categories use the same range for pages and totals", () => {
  const store = fixture();
  store.upsertMessages(
    [message("primary", 100), message("social", 150, ["INBOX", "CATEGORY_SOCIAL"]), message("outside", 200)],
    null,
  );
  for (const [label, expected] of [
    ["INBOX_PRIMARY", "primary"],
    ["INBOX_SOCIAL", "social"],
  ]) {
    expect(store.listThreads(label!, 200, 10, 100).map((t) => t.id)).toEqual([expected]);
    expect(store.countThreads(label!, { after: 100, before: 200 })).toBe(1);
  }
});

test("threads route passes bounds to store and sync, returns accurate hasMore and total without waiting", async () => {
  const { store, sync } = runtime(fixture());
  store.upsertMessages(
    [message("old", 99), message("lower", 100), message("middle", 150), message("upper", 200)],
    null,
  );
  const ensure = mock(() => new Promise<void>(() => {}));
  const scoped: Pick<AccountRuntime, "store" | "sync"> = {
    store,
    sync: {
      start() {},
      stop: async () => {},
      wake() {},
      status: () => sync.status(),
      ensureLabel: ensure,
      ensureThread: async () => {},
      applyAction() {},
    },
  };
  const response = listThreadsResponse(
    new URL("http://localhost/api/threads?label=INBOX&limit=1&after=100&before=200"),
    scoped,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ threads: [{ id: "middle" }], hasMore: true, total: 2 });
  expect(ensure).toHaveBeenCalledWith("INBOX", { limit: 1, after: 100, before: 200 });
  const last = listThreadsResponse(
    new URL("http://localhost/api/threads?label=INBOX&limit=2&after=100&before=200"),
    scoped,
  );
  expect(await last.json()).toMatchObject({ hasMore: false, total: 2 });
  const empty = listThreadsResponse(new URL("http://localhost/api/threads?after=200&before=100"), scoped);
  expect(await empty.json()).toMatchObject({ threads: [], hasMore: false, total: 0 });
  for (const param of ["after=NaN", "before=Infinity", "after=", "limit=-1", "limit=1.5"])
    expect(listThreadsResponse(new URL(`http://localhost/api/threads?${param}`), scoped).status).toBe(400);
});

test("window fallback paginates Gmail at interactive priority, stores full threads, emits changes and deduplicates", async () => {
  const { store, sync, gmail, events } = runtime(fixture());
  store.kvSet("label_synced:INBOX", "1"); // A newest-page cache must not suppress an older window.
  const changed = mock(events.threadsChanged.bind(events));
  events.threadsChanged = changed;
  const list = mock<typeof gmail.listMessageIds>(async (opts) =>
    opts.pageToken
      ? { messages: [{ id: "second", threadId: "second" }] }
      : { messages: [{ id: "first", threadId: "first" }], nextPageToken: "next" },
  );
  gmail.listMessageIds = list;
  gmail.thread = mock(async (id) => [message(id, id === "first" ? 100_000 : 150_000)]);
  const range = { after: 100_000, before: 200_000, limit: 10 };
  await Promise.all([sync.ensureLabel("INBOX", range), sync.ensureLabel("INBOX", range)]);
  expect(list).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[0]).toEqual([
    { labelId: "INBOX", q: "after:99 before:200", pageToken: undefined, maxResults: 500, includeSpamTrash: false },
    Priority.Interactive,
  ]);
  expect(list.mock.calls[1]?.[0].pageToken).toBe("next");
  expect(store.listThreads("INBOX", 200_000, 10, 100_000)).toHaveLength(2);
  expect(changed).toHaveBeenCalled();
  await sync.ensureLabel("INBOX", range);
  expect(list).toHaveBeenCalledTimes(2);
  store.kvSet("backfill_done", "1");
  await sync.ensureLabel("INBOX", { after: 0 });
  expect(list).toHaveBeenCalledTimes(2);
  await sync.ensureLabel("TRASH", { after: 0 });
  expect(list.mock.calls[2]?.[0]).toMatchObject({ labelId: "TRASH", includeSpamTrash: true });
});

test("oldest cached message date is indexed, cached and refreshed after writes and deletes", () => {
  const store = fixture();
  expect(store.oldestMessageDate()).toBeNull();
  store.upsertMessages([message("new", 200), message("old", 100, ["TRASH"])], null);
  expect(store.oldestMessageDate()).toBe(100);
  expect(store.oldestMessageDate()).toBe(100);
  const plan = store.sqlite.query("EXPLAIN QUERY PLAN SELECT MIN(internal_date) FROM messages").all();
  expect(JSON.stringify(plan)).toContain("COVERING INDEX messages_date");
  store.upsertMessages([message("earliest", 50)], null);
  expect(store.oldestMessageDate()).toBe(50);
  store.upsertMessages([message("earliest", 300)], null);
  expect(store.oldestMessageDate()).toBe(100);
  store.deleteMessages(["old"], null);
  expect(store.oldestMessageDate()).toBe(200);
  store.clearMailbox();
  expect(store.oldestMessageDate()).toBeNull();
});

test("sync status and status events expose the oldest cached message date", async () => {
  const { store, sync, gmail, events } = runtime(fixture());
  const send = mock(events.send.bind(events));
  events.send = send;
  expect(sync.status().oldestMessageDate).toBeNull();
  gmail.thread = mock(async (id) => [message(id, id === "old" ? 100 : 200)]);
  await sync.ensureThread("new");
  expect(sync.status().oldestMessageDate).toBe(200);
  await sync.ensureThread("old");
  expect(sync.status().oldestMessageDate).toBe(100);
  expect(send).toHaveBeenCalledWith({ type: "status", status: expect.objectContaining({ oldestMessageDate: 100 }) });
  store.deleteMessages(["new", "old"], null);
  expect(sync.status().oldestMessageDate).toBeNull();
});
