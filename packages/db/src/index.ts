import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { and, asc, count, desc, eq, gte, inArray, lt, lte, notInArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { Label, MessageMeta, Participant, ThreadAction, ThreadDateRange, ThreadRow } from "@mailfast/shared";
import { inboxCategoryLabel, isInboxCategory, NON_PRIMARY_CATEGORY_LABELS } from "@mailfast/shared";
import * as schema from "./schema.ts";
import { account, kv, labels, messages, outbox, threadLabels, threads, user } from "./schema.ts";

export * as schema from "./schema.ts";
/** Better Auth tables keyed by model name, for `drizzleAdapter(db, { schema: authSchema })`. */
export * as authSchema from "./auth-schema.ts";

/** A message as parsed from Gmail metadata, ready to store. */
export interface MessageInput {
  id: string;
  threadId: string;
  date: number;
  fromName: string;
  fromEmail: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  labelIds: string[];
}

export interface OpenOptions {
  /** SQLite file path, or ":memory:". */
  path: string;
  /** Folder with Drizzle migrations. Defaults to this package's ./migrations (override in compiled builds). */
  migrationsFolder?: string;
}

const DEFAULT_MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/** Turns free text into a safe FTS5 prefix query: `foo bar` -> `"foo"* "bar"*`. */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, "").trim())
    .filter(Boolean)
    .slice(0, 12);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(" ");
}

type ThreadSelect = typeof threads.$inferSelect;
type MessageSelect = typeof messages.$inferSelect;

function toThreadRow(r: ThreadSelect): ThreadRow {
  return {
    id: r.id,
    lastDate: r.lastDate,
    subject: r.subject,
    snippet: r.snippet,
    senders: r.senders,
    messageCount: r.messageCount,
    unread: r.unread,
    starred: r.starred,
    important: r.important,
    labelIds: r.labelIds,
  };
}

function toMessageMeta(r: MessageSelect): MessageMeta {
  return {
    id: r.id,
    threadId: r.threadId,
    date: r.internalDate,
    from: { name: r.fromName, email: r.fromEmail },
    to: r.to,
    cc: r.cc,
    subject: r.subject,
    snippet: r.snippet,
    labelIds: r.labelIds,
    unread: r.labelIds.includes("UNREAD"),
    starred: r.labelIds.includes("STARRED"),
  };
}

/** Virtual label backing the "All Mail" view (Gmail has no label id for it). */
export const ALL_MAIL = "ALL";

/** Both the page and count begin with the (label_id, last_date) index. */
function threadRangeWhere(labelId: string, { after, before }: ThreadDateRange) {
  const excluded = sql.join(
    NON_PRIMARY_CATEGORY_LABELS.map((l) => sql`${l}`),
    sql`, `,
  );
  const category = !isInboxCategory(labelId)
    ? undefined
    : labelId === "INBOX_PRIMARY"
      ? sql`NOT EXISTS (SELECT 1 FROM thread_labels c WHERE c.thread_id = ${threadLabels.threadId}
          AND c.label_id IN (${excluded}))`
      : sql`EXISTS (SELECT 1 FROM thread_labels c WHERE c.thread_id = ${threadLabels.threadId}
          AND c.label_id = ${inboxCategoryLabel(labelId)})`;
  return and(
    eq(threadLabels.labelId, isInboxCategory(labelId) ? "INBOX" : labelId),
    after === undefined ? undefined : gte(threadLabels.lastDate, after),
    before === undefined ? undefined : lt(threadLabels.lastDate, before),
    category,
  );
}

export function openMailStore(opts: OpenOptions) {
  const sqlite = new Database(opts.path, { create: true, strict: true });
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA mmap_size = 268435456;
    PRAGMA cache_size = -65536;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: opts.migrationsFolder ?? DEFAULT_MIGRATIONS });

  // The thread/date index cannot serve an account-wide MIN(internal_date).
  sqlite.exec("CREATE INDEX IF NOT EXISTS messages_date ON messages (internal_date)");
  const oldestQuery = db
    .select({ date: sql<number | null>`MIN(${messages.internalDate})` })
    .from(messages)
    .prepare();
  let oldestMessageDate: number | null | undefined;

  // Hot-path prepared statements.
  const p = {
    kvGet: db
      .select({ value: kv.value })
      .from(kv)
      .where(eq(kv.key, sql.placeholder("key")))
      .prepare(),
    messagesOfThread: db
      .select()
      .from(messages)
      .where(eq(messages.threadId, sql.placeholder("threadId")))
      .orderBy(asc(messages.internalDate))
      .prepare(),
    messageRef: db
      .select({ rowid: sql<number>`rowid`, threadId: messages.threadId, labelIds: messages.labelIds })
      .from(messages)
      .where(eq(messages.id, sql.placeholder("id")))
      .prepare(),
    threadLabelIds: db
      .select({ labelId: threadLabels.labelId })
      .from(threadLabels)
      .where(eq(threadLabels.threadId, sql.placeholder("threadId")))
      .prepare(),
    threadPage: db
      .select({ t: threads })
      .from(threadLabels)
      .innerJoin(threads, eq(threads.id, threadLabels.threadId))
      .where(
        and(
          eq(threadLabels.labelId, sql.placeholder("labelId")),
          gte(threadLabels.lastDate, sql.placeholder("after")),
          lt(threadLabels.lastDate, sql.placeholder("before")),
        ),
      )
      .orderBy(desc(threadLabels.lastDate))
      .limit(sql.placeholder("limit"))
      .prepare(),
    threadById: db
      .select()
      .from(threads)
      .where(eq(threads.id, sql.placeholder("id")))
      .prepare(),
  };

  function writeFts(rowid: number, m: MessageInput) {
    db.run(sql`DELETE FROM messages_fts WHERE rowid = ${rowid}`);
    db.run(sql`INSERT INTO messages_fts(rowid, subject, from_name, from_email, to_addr, snippet)
      VALUES (${rowid}, ${m.subject}, ${m.fromName}, ${m.fromEmail}, ${m.to}, ${m.snippet})`);
  }

  /**
   * Rebuilds the denormalised thread row from its messages. Called for every
   * thread touched by a write. Returns label ids whose lists changed.
   */
  function recomputeThread(threadId: string, me: string | null): string[] {
    const before = p.threadLabelIds.all({ threadId }).map((r) => r.labelId);
    const msgs = p.messagesOfThread.all({ threadId });
    db.delete(threadLabels).where(eq(threadLabels.threadId, threadId)).run();
    if (msgs.length === 0) {
      db.delete(threads).where(eq(threads.id, threadId)).run();
      return before;
    }
    const set = new Set<string>();
    const senders: Participant[] = [];
    const seen = new Set<string>();
    const meLower = me?.toLowerCase() ?? null;
    for (const m of msgs) {
      for (const l of m.labelIds) set.add(l);
      const key = m.fromEmail.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        senders.push({ name: key === meLower ? "me" : m.fromName || m.fromEmail, email: m.fromEmail });
      }
    }
    const first = msgs[0]!;
    const last = msgs[msgs.length - 1]!;
    const labelIds = [...set];
    const row = {
      lastDate: last.internalDate,
      subject: first.subject,
      snippet: last.snippet,
      senders,
      messageCount: msgs.length,
      unread: set.has("UNREAD"),
      starred: set.has("STARRED"),
      important: set.has("IMPORTANT"),
      labelIds,
    };
    db.insert(threads)
      .values({ id: threadId, ...row })
      .onConflictDoUpdate({ target: threads.id, set: row })
      .run();
    const listed = set.has("SPAM") || set.has("TRASH") ? labelIds : [...labelIds, ALL_MAIL];
    db.insert(threadLabels)
      .values(listed.map((labelId) => ({ labelId, threadId, lastDate: last.internalDate })))
      .run();
    return [...new Set([...before, ...listed])];
  }

  function recomputeAll(threadIds: Iterable<string>, me: string | null): Set<string> {
    const changed = new Set<string>();
    for (const t of threadIds) for (const l of recomputeThread(t, me)) changed.add(l);
    return changed;
  }

  return {
    sqlite,
    db,

    // ---- key/value -------------------------------------------------------
    kvGet(key: string): string | null {
      return p.kvGet.get({ key })?.value ?? null;
    },
    kvSet(key: string, value: string) {
      db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
    },
    kvDel(key: string) {
      db.delete(kv).where(eq(kv.key, key)).run();
    },

    // ---- messages --------------------------------------------------------
    hasMessage(id: string): boolean {
      return p.messageRef.get({ id }) !== undefined;
    },
    /** Ids from `ids` that are not stored yet. */
    missingMessages(ids: string[]): string[] {
      if (ids.length === 0) return [];
      const have = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        for (const r of db.select({ id: messages.id }).from(messages).where(inArray(messages.id, chunk)).all())
          have.add(r.id);
      }
      return ids.filter((id) => !have.has(id));
    },
    oldestMessageDate(): number | null {
      if (oldestMessageDate === undefined) oldestMessageDate = oldestQuery.get()?.date ?? null;
      return oldestMessageDate;
    },
    messageCount(): number {
      return db.select({ n: count() }).from(messages).get()!.n;
    },

    /** Upserts messages and refreshes their threads atomically. Returns changed label ids. */
    upsertMessages(msgs: MessageInput[], me: string | null): Set<string> {
      if (msgs.length === 0) return new Set();
      oldestMessageDate = undefined;
      return db.transaction(() => {
        const touched = new Set<string>();
        for (const m of msgs) {
          const prev = p.messageRef.get({ id: m.id });
          if (prev && prev.threadId !== m.threadId) touched.add(prev.threadId);
          const row = {
            threadId: m.threadId,
            internalDate: m.date,
            fromName: m.fromName,
            fromEmail: m.fromEmail,
            to: m.to,
            cc: m.cc,
            subject: m.subject,
            snippet: m.snippet,
            labelIds: m.labelIds,
          };
          db.insert(messages)
            .values({ id: m.id, ...row })
            .onConflictDoUpdate({ target: messages.id, set: row })
            .run();
          writeFts(p.messageRef.get({ id: m.id })!.rowid, m);
          touched.add(m.threadId);
        }
        return recomputeAll(touched, me);
      });
    },

    /** Sets full label sets on known messages (history label events). Unknown ids are returned. */
    setMessageLabels(updates: { id: string; labelIds: string[] }[], me: string | null) {
      return db.transaction(() => {
        const touched = new Set<string>();
        const unknown: string[] = [];
        for (const u of updates) {
          const ref = p.messageRef.get({ id: u.id });
          if (!ref) {
            unknown.push(u.id);
            continue;
          }
          db.update(messages).set({ labelIds: u.labelIds }).where(eq(messages.id, u.id)).run();
          touched.add(ref.threadId);
        }
        return { changed: recomputeAll(touched, me), unknown };
      });
    },

    deleteMessages(ids: string[], me: string | null): Set<string> {
      if (ids.length === 0) return new Set();
      oldestMessageDate = undefined;
      return db.transaction(() => {
        const touched = new Set<string>();
        for (const id of ids) {
          const ref = p.messageRef.get({ id });
          if (!ref) continue;
          db.run(sql`DELETE FROM messages_fts WHERE rowid = ${ref.rowid}`);
          db.delete(messages).where(eq(messages.id, id)).run();
          touched.add(ref.threadId);
        }
        return recomputeAll(touched, me);
      });
    },

    /** Applies a label delta to every message of a thread (mirrors threads.modify). */
    modifyThreadLabels(threadId: string, add: string[], remove: string[], me: string | null): Set<string> {
      return db.transaction(() => {
        for (const m of p.messagesOfThread.all({ threadId })) {
          const set = new Set(m.labelIds);
          for (const l of remove) set.delete(l);
          for (const l of add) set.add(l);
          db.update(messages)
            .set({ labelIds: [...set] })
            .where(eq(messages.id, m.id))
            .run();
        }
        return new Set(recomputeThread(threadId, me));
      });
    },

    // ---- threads ---------------------------------------------------------
    markThreadComplete(threadId: string) {
      db.update(threads).set({ complete: true }).where(eq(threads.id, threadId)).run();
    },
    getThread(threadId: string): { thread: ThreadRow; complete: boolean } | null {
      const r = p.threadById.get({ id: threadId });
      return r ? { thread: toThreadRow(r), complete: r.complete } : null;
    },
    threadMessages(threadId: string): MessageMeta[] {
      return p.messagesOfThread.all({ threadId }).map(toMessageMeta);
    },
    /** Keyset page of a label, newest first. `before` is an exclusive lastDate cursor. */
    listThreads(labelId: string, before: number, limit: number, after = -Number.MAX_SAFE_INTEGER): ThreadRow[] {
      if (isInboxCategory(labelId)) {
        return db
          .select({ t: threads })
          .from(threadLabels)
          .innerJoin(threads, eq(threads.id, threadLabels.threadId))
          .where(threadRangeWhere(labelId, { after, before }))
          .orderBy(desc(threadLabels.lastDate))
          .limit(limit)
          .all()
          .map((r) => toThreadRow(r.t));
      }
      return p.threadPage.all({ labelId, after, before, limit }).map((r) => toThreadRow(r.t));
    },
    countThreads(labelId: string, range: ThreadDateRange = {}): number {
      return db.select({ n: count() }).from(threadLabels).where(threadRangeWhere(labelId, range)).get()!.n;
    },
    searchThreads(text: string, limit: number): ThreadRow[] {
      const users: string[] = [];
      const rest = text.replace(
        /(?<!\S)@user:(?:"([^"]*)"|(\S*))/gi,
        (_match, quoted: string | undefined, plain: string | undefined) => {
          const user = toFtsQuery(quoted ?? plain ?? "");
          if (user) users.push(`{from_name from_email} : (${user})`);
          return " ";
        },
      );
      const freeText = toFtsQuery(rest);
      const fts = [...users, ...(freeText ? [freeText] : [])].join(" AND ");
      if (!fts) return [];
      return db
        .select()
        .from(threads)
        .where(
          sql`${threads.id} IN (
            SELECT m.thread_id FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
            WHERE messages_fts MATCH ${fts}
            ORDER BY bm25(messages_fts, 8.0, 4.0, 4.0, 1.0, 1.0) LIMIT 2000)`,
        )
        .orderBy(desc(threads.lastDate))
        .limit(limit)
        .all()
        .map(toThreadRow);
    },

    // ---- labels ----------------------------------------------------------
    replaceLabels(next: Label[]) {
      db.transaction(() => {
        const ids = next.map((l) => l.id);
        if (ids.length > 0) db.delete(labels).where(notInArray(labels.id, ids)).run();
        else db.delete(labels).run();
        for (const l of next) {
          db.insert(labels)
            .values(l)
            .onConflictDoUpdate({ target: labels.id, set: { name: l.name, type: l.type, color: l.color } })
            .run();
        }
      });
    },
    setLabelCounts(id: string, unread: number, total: number) {
      db.update(labels).set({ unread, total }).where(eq(labels.id, id)).run();
    },
    labels(): Label[] {
      return db.select().from(labels).all();
    },

    // ---- outbox ----------------------------------------------------------
    outboxAdd(threadId: string, action: ThreadAction) {
      db.insert(outbox).values({ threadId, action }).run();
    },
    outboxDue(now: number) {
      return db.select().from(outbox).where(lte(outbox.nextAt, now)).orderBy(asc(outbox.id)).limit(20).all();
    },
    outboxDone(id: number) {
      db.delete(outbox).where(eq(outbox.id, id)).run();
    },
    outboxRetry(id: number, attempts: number, nextAt: number, error: string) {
      db.update(outbox).set({ attempts, nextAt, lastError: error }).where(eq(outbox.id, id)).run();
    },
    outboxCount(): number {
      return db.select({ n: count() }).from(outbox).get()!.n;
    },
    outboxActionsFor(threadId: string): ThreadAction[] {
      return db
        .select({ action: outbox.action })
        .from(outbox)
        .where(eq(outbox.threadId, threadId))
        .orderBy(asc(outbox.id))
        .all()
        .map((r) => r.action);
    },

    // ---- auth (Better Auth tables) -----------------------------------------
    googleAccounts() {
      return db
        .select({
          userId: account.userId,
          accountId: account.id,
          email: user.email,
          name: user.name,
          image: user.image,
          scope: account.scope,
        })
        .from(account)
        .innerJoin(user, eq(user.id, account.userId))
        .where(and(eq(account.providerId, "google"), sql`${account.refreshToken} IS NOT NULL`))
        .orderBy(asc(account.createdAt), asc(account.id))
        .all();
    },
    deleteGoogleAccount(id: string) {
      const row = db.select().from(account).where(eq(account.id, id)).get();
      if (row) db.delete(user).where(eq(user.id, row.userId)).run();
    },
    /** Removes users and (via cascade) their sessions and OAuth accounts. */
    clearAuth() {
      db.transaction(() => {
        db.delete(user).run();
        db.run(sql`DELETE FROM verification`);
      });
    },

    /** Wipes mailbox data (sign-out / account switch). OAuth client config in kv is kept. */
    clearMailbox() {
      oldestMessageDate = undefined;
      db.transaction(() => {
        for (const t of [messages, threads, threadLabels, labels, outbox]) db.delete(t).run();
        db.run(sql`DELETE FROM messages_fts`);
        db.delete(kv)
          .where(sql`${kv.key} NOT LIKE 'oauth_client%' AND ${kv.key} NOT LIKE 'secret_key%'`)
          .run();
      });
    },

    close() {
      sqlite.close(true);
    },
  };
}

export type MailStore = ReturnType<typeof openMailStore>;

/** App/auth database retains the legacy schema, but never reads its mailbox cache. */
export function openAppStore(opts: OpenOptions) {
  const store = openMailStore(opts);
  return {
    db: store.db,
    sqlite: store.sqlite,
    kvGet: store.kvGet.bind(store),
    kvSet: store.kvSet.bind(store),
    kvDel: store.kvDel.bind(store),
    googleAccounts: store.googleAccounts.bind(store),
    deleteGoogleAccount: store.deleteGoogleAccount.bind(store),
    clearAuth: store.clearAuth.bind(store),
    close: store.close.bind(store),
  };
}
export type AppStore = ReturnType<typeof openAppStore>;
