import type { ServerEvent, ServerEventData } from "@mailfast/shared";

/**
 * Server-sent events hub. Label change notifications are coalesced over a
 * short window so a 500-message sync page produces one UI refresh, not 500.
 */
export class Events {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private encoder = new TextEncoder();
  private pendingLabels = new Set<string>();
  private pendingThreads = new Set<string>();
  private labelsDirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly accountId?: string,
    private readonly forward?: (ev: ServerEvent) => void,
  ) {
    if (!forward) setInterval(() => this.write(": keepalive\n\n"), 20_000).unref?.();
  }

  stream(): Response {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        ctrl = c;
        this.clients.add(c);
        c.enqueue(this.encoder.encode("retry: 1000\n\n"));
      },
      cancel: () => {
        this.clients.delete(ctrl);
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
    });
  }

  send(ev: ServerEventData & { accountId?: string }) {
    const scoped = { ...ev, accountId: this.accountId ?? ev.accountId ?? "" };
    if (this.forward) this.forward(scoped);
    else this.write(`data: ${JSON.stringify(scoped)}\n\n`);
  }

  threadsChanged(labelIds: Iterable<string>) {
    for (const l of labelIds) this.pendingLabels.add(l);
    this.schedule();
  }

  threadUpdated(threadId: string) {
    this.pendingThreads.add(threadId);
    this.schedule();
  }

  labelsChanged() {
    this.labelsDirty = true;
    this.schedule();
  }

  private schedule() {
    this.flushTimer ??= setTimeout(() => this.flush(), 60);
  }

  private flush() {
    this.flushTimer = null;
    if (this.pendingLabels.size > 0) {
      this.send({ type: "threads-changed", labelIds: [...this.pendingLabels] });
      this.pendingLabels.clear();
    }
    for (const threadId of this.pendingThreads) this.send({ type: "thread-updated", threadId });
    this.pendingThreads.clear();
    if (this.labelsDirty) {
      this.labelsDirty = false;
      this.send({ type: "labels-changed" });
    }
  }

  private write(chunk: string) {
    const bytes = this.encoder.encode(chunk);
    for (const c of this.clients) {
      try {
        c.enqueue(bytes);
      } catch {
        this.clients.delete(c);
      }
    }
  }
}
