import type { MailStore, MessageInput } from "@mailfast/db";
import { actionDelta, isInboxCategory, type SyncPhase, type SyncStatus, type ThreadAction } from "@mailfast/shared";
import type { Auth } from "@/auth.ts";
import type { Events } from "@/events.ts";
import { GmailError, type Gmail } from "@/gmail.ts";
import { Priority } from "@/limiter.ts";

const POLL_MS = 15_000;
const LABEL_COUNTS_MS = 120_000;
const INITIAL_INBOX = 100;
const BACKFILL_PAGE = 500;
/** Labels that backfill never covers (it excludes spam/trash), so they are synced on demand. */
const ON_DEMAND_LABELS = new Set(["SPAM", "TRASH"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Keeps the local cache in step with Gmail:
 *  - initial: profile + labels + newest inbox page, so the UI fills in ~1s
 *  - realtime loop: outbox (user actions) then history.list deltas, every 15s or on wake
 *  - backfill loop: walks all mail newest-first in the background at low priority
 *  - prefetch: on-demand thread / label / search fetches at interactive priority
 */
export class SyncEngine {
  private phase: SyncPhase = "idle";
  private error: string | null = null;
  private lastSyncAt: number | null = null;
  private running = false;
  private wakeRealtime: (() => void) | null = null;
  private labelCountsAt = 0;
  private inflight = new Map<string, Promise<void>>();
  private generation = 0;

  constructor(
    private readonly store: MailStore,
    private readonly gmail: Gmail,
    private readonly auth: Auth,
    private readonly events: Events,
  ) {
    auth.onSignedIn(() => this.restart());
  }

  private get me() {
    return this.auth.account();
  }

  status(): SyncStatus {
    const signedIn = this.auth.status().signedIn;
    return {
      phase: signedIn ? this.phase : "signed-out",
      account: this.me,
      messagesStored: this.store.messageCount(),
      backfillDone: this.store.kvGet("backfill_done") === "1",
      lastSyncAt: this.lastSyncAt,
      pendingActions: this.store.outboxCount(),
      error: this.error,
    };
  }

  private setPhase(phase: SyncPhase, error: string | null = null) {
    this.phase = phase;
    this.error = error;
    this.events.send({ type: "status", status: this.status() });
  }

  start() {
    if (this.running || !this.auth.status().signedIn) return;
    this.running = true;
    const gen = ++this.generation;
    void this.realtimeLoop(gen);
    void this.backfillLoop(gen);
  }

  stop() {
    this.running = false;
    this.generation++;
    this.wake();
  }

  restart() {
    this.stop();
    this.start();
  }

  /** Run the realtime loop now (window focus, user action). */
  wake() {
    this.wakeRealtime?.();
  }

  // ---------------------------------------------------------------- storage

  /**
   * Stores fetched messages, then re-applies pending outbox actions for the
   * touched threads so a fetch that raced an optimistic action can't undo it.
   */
  private store_(msgs: MessageInput[], opts: { onlyNew?: boolean } = {}) {
    const rows = opts.onlyNew ? msgs.filter((m) => !this.store.hasMessage(m.id)) : msgs;
    if (rows.length === 0) return;
    const changed = this.store.upsertMessages(rows, this.me);
    for (const threadId of new Set(rows.map((m) => m.threadId))) {
      for (const action of this.store.outboxActionsFor(threadId)) {
        const d = actionDelta(action);
        for (const l of this.store.modifyThreadLabels(threadId, d.add, d.remove, this.me)) changed.add(l);
      }
    }
    this.events.threadsChanged(changed);
  }

  private async fetchMissing(ids: string[], priority: Priority, opts: { onlyNew?: boolean } = {}) {
    const missing = this.store.missingMessages(ids);
    if (missing.length === 0) return;
    const { messages } = await this.gmail.messages(missing, priority);
    this.store_(messages, opts);
  }

  // ---------------------------------------------------------------- loops

  private async realtimeLoop(gen: number) {
    while (this.running && gen === this.generation) {
      try {
        if (!this.store.kvGet("history_id")) await this.initialSync();
        else {
          this.setPhase(this.store.kvGet("backfill_done") === "1" ? "incremental" : "backfill");
          await this.flushOutbox();
          await this.incremental();
        }
        if (Date.now() - this.labelCountsAt > LABEL_COUNTS_MS) void this.refreshLabelCounts();
        this.lastSyncAt = Date.now();
        this.setPhase(this.store.kvGet("backfill_done") === "1" ? "idle" : "backfill");
      } catch (e) {
        this.handleError(e);
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_MS);
        this.wakeRealtime = () => {
          clearTimeout(t);
          resolve();
        };
      });
      this.wakeRealtime = null;
    }
  }

  private async backfillLoop(gen: number) {
    while (this.running && gen === this.generation && this.store.kvGet("backfill_done") !== "1") {
      if (!this.store.kvGet("history_id")) {
        await sleep(500); // wait for initial sync to record the history cursor
        continue;
      }
      try {
        const pageToken = this.store.kvGet("backfill_token") ?? undefined;
        const page = await this.gmail.listMessageIds({ pageToken, maxResults: BACKFILL_PAGE }, Priority.Background);
        // onlyNew: realtime sync owns updates to messages we already have.
        await this.fetchMissing(
          (page.messages ?? []).map((m) => m.id),
          Priority.Background,
          { onlyNew: true },
        );
        if (gen !== this.generation) return;
        if (page.nextPageToken) this.store.kvSet("backfill_token", page.nextPageToken);
        else {
          this.store.kvSet("backfill_done", "1");
          this.store.kvDel("backfill_token");
        }
        this.events.send({ type: "status", status: this.status() });
      } catch (e) {
        if (e instanceof GmailError && e.status === 400) this.store.kvDel("backfill_token"); // stale page token
        this.handleError(e);
        await sleep(10_000);
      }
    }
  }

  private handleError(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync]", msg);
    if (!this.auth.status().signedIn) {
      this.stop();
      this.setPhase("signed-out", "Signed out. Please sign in again.");
    } else this.setPhase("error", msg);
  }

  // ---------------------------------------------------------------- phases

  private async initialSync() {
    this.setPhase("initial");
    const profile = await this.gmail.profile();
    // Record the cursor first: anything that changes from here on arrives via history.
    this.store.kvSet("history_id", profile.historyId);
    this.store.replaceLabels(await this.gmail.labels());
    this.events.labelsChanged();
    const page = await this.gmail.listMessageIds({ labelId: "INBOX", maxResults: INITIAL_INBOX }, Priority.Interactive);
    await this.fetchMissing(
      (page.messages ?? []).map((m) => m.id),
      Priority.Interactive,
    );
    this.store.kvSet("label_synced:INBOX", "1");
    void this.refreshLabelCounts();
  }

  private async incremental() {
    const start = this.store.kvGet("history_id")!;
    let pageToken: string | undefined;
    let latest = start;
    const added = new Map<string, true>();
    const labelSets = new Map<string, string[]>();
    const deleted = new Set<string>();
    try {
      do {
        const page = await this.gmail.history(start, pageToken);
        for (const h of page.history ?? []) {
          for (const a of h.messagesAdded ?? []) {
            added.set(a.message.id, true);
            deleted.delete(a.message.id);
          }
          for (const d of h.messagesDeleted ?? []) {
            deleted.add(d.message.id);
            added.delete(d.message.id);
            labelSets.delete(d.message.id);
          }
          for (const l of [...(h.labelsAdded ?? []), ...(h.labelsRemoved ?? [])]) {
            if (!deleted.has(l.message.id)) labelSets.set(l.message.id, l.message.labelIds ?? []);
          }
        }
        latest = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (e instanceof GmailError && e.status === 404) {
        // History cursor too old (> ~1 week offline): start over; known messages are kept.
        console.warn("[sync] history expired, re-running initial sync");
        this.store.kvDel("history_id");
        this.store.kvDel("backfill_done");
        this.store.kvDel("backfill_token");
        return;
      }
      throw e;
    }

    if (deleted.size > 0) this.events.threadsChanged(this.store.deleteMessages([...deleted], this.me));
    // Label-only changes for known messages apply without a fetch.
    const { changed, unknown } = this.store.setMessageLabels(
      [...labelSets].filter(([id]) => !added.has(id)).map(([id, labelIds]) => ({ id, labelIds })),
      this.me,
    );
    this.events.threadsChanged(changed);
    const toFetch = [...new Set([...added.keys(), ...unknown])];
    if (toFetch.length > 0) {
      const { messages, gone } = await this.gmail.messages(toFetch, Priority.Realtime);
      this.store_(messages);
      if (gone.length) this.events.threadsChanged(this.store.deleteMessages(gone, this.me));
    }
    this.store.kvSet("history_id", latest);
    if (latest !== start) {
      this.events.labelsChanged();
      this.labelCountsAt = 0; // counts may have moved
    }
  }

  private async refreshLabelCounts() {
    this.labelCountsAt = Date.now();
    const labels = this.store.labels();
    // System labels the sidebar shows first, then user labels.
    await Promise.all(
      labels.map(async (l) => {
        try {
          const c = await this.gmail.labelCounts(l.id, l.id === "INBOX" ? Priority.Realtime : Priority.Background);
          this.store.setLabelCounts(l.id, c.threadsUnread ?? 0, c.threadsTotal ?? 0);
        } catch {
          /* label may have been deleted; next labels.list fixes it */
        }
      }),
    );
    this.events.labelsChanged();
  }

  // ---------------------------------------------------------------- actions

  /** Optimistic: local DB first (instant), Gmail via the durable outbox. */
  applyAction(threadIds: string[], action: ThreadAction) {
    const d = actionDelta(action);
    const changed = new Set<string>();
    for (const id of threadIds) {
      for (const l of this.store.modifyThreadLabels(id, d.add, d.remove, this.me)) changed.add(l);
      this.store.outboxAdd(id, action);
      this.events.threadUpdated(id);
    }
    this.events.threadsChanged(changed);
    this.labelCountsAt = 0;
    this.wake();
  }

  private async flushOutbox() {
    for (const item of this.store.outboxDue(Date.now())) {
      const a = item.action;
      try {
        if (a.kind === "trash" || a.kind === "untrash")
          await this.gmail.trashThread(item.threadId, a.kind === "untrash");
        else {
          const d = actionDelta(a);
          await this.gmail.modifyThread(item.threadId, d.add, d.remove);
        }
        this.store.outboxDone(item.id);
      } catch (e) {
        const attempts = item.attempts + 1;
        if ((e instanceof GmailError && e.status === 404) || attempts >= 8) {
          // Thread is gone or the action keeps failing: drop it and resync the thread from Gmail.
          this.store.outboxDone(item.id);
          void this.ensureThread(item.threadId, true);
        } else {
          this.store.outboxRetry(item.id, attempts, Date.now() + Math.min(300_000, 2000 * 2 ** attempts), String(e));
        }
      }
    }
  }

  // ---------------------------------------------------------------- prefetch

  private once(key: string, fn: () => Promise<void>): Promise<void> {
    let p = this.inflight.get(key);
    if (!p) {
      p = fn()
        .catch((e) => console.warn(`[prefetch] ${key}:`, e instanceof Error ? e.message : e))
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  /**
   * Make sure every message of a thread is local. Skipped when backfill has
   * finished (everything is local) or the thread was already fetched whole.
   */
  ensureThread(threadId: string, force = false): Promise<void> {
    if (!this.auth.status().signedIn) return Promise.resolve();
    const local = this.store.getThread(threadId);
    if (!force && (local?.complete || (local && this.store.kvGet("backfill_done") === "1"))) return Promise.resolve();
    return this.once(`thread:${threadId}`, async () => {
      const msgs = await this.gmail.thread(threadId, Priority.Interactive);
      this.store_(msgs);
      this.store.markThreadComplete(threadId);
      this.events.threadUpdated(threadId);
    });
  }

  /** Pull the newest page of a label that backfill hasn't covered yet. */
  ensureLabel(labelId: string): Promise<void> {
    // Inbox category tabs (Primary/Social/Updates) are virtual: they page the INBOX listing.
    if (isInboxCategory(labelId)) labelId = "INBOX";
    if (!this.auth.status().signedIn || labelId === "ALL") return Promise.resolve();
    const covered = this.store.kvGet("backfill_done") === "1" && !ON_DEMAND_LABELS.has(labelId);
    if (covered || this.store.kvGet(`label_synced:${labelId}`)) return Promise.resolve();
    return this.once(`label:${labelId}`, async () => {
      const page = await this.gmail.listMessageIds(
        { labelId, maxResults: 50, includeSpamTrash: ON_DEMAND_LABELS.has(labelId) },
        Priority.Interactive,
      );
      await this.fetchMissing(
        (page.messages ?? []).map((m) => m.id),
        Priority.Interactive,
      );
      this.store.kvSet(`label_synced:${labelId}`, "1");
    });
  }
}
