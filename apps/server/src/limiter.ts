/**
 * Priority token bucket sized to Gmail's per-user quota (250 units/s).
 * Interactive work (user actions, hover prefetch, incremental sync) always
 * jumps ahead of background backfill, so the UI never waits behind a bulk sync.
 */
export const Priority = {
  Interactive: 0,
  Realtime: 1,
  Background: 2,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

interface Waiter {
  units: number;
  priority: Priority;
  seq: number;
  resolve: () => void;
}

export class Limiter {
  private tokens: number;
  private last = performance.now();
  private queue: Waiter[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number,
  ) {
    this.tokens = capacity;
  }

  acquire(units: number, priority: Priority): Promise<void> {
    const cost = Math.min(units, this.capacity);
    return new Promise((resolve) => {
      this.queue.push({ units: cost, priority, seq: this.seq++, resolve });
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      this.drain();
    });
  }

  /** Called after a 429: drain the bucket so everyone backs off together. */
  penalize(ms: number) {
    this.refill();
    this.tokens = Math.min(this.tokens, -(this.ratePerSec * ms) / 1000);
    this.drain();
  }

  private refill() {
    const now = performance.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
  }

  private drain() {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= this.queue[0]!.units) {
      const w = this.queue.shift()!;
      this.tokens -= w.units;
      w.resolve();
    }
    if (this.queue.length > 0 && this.timer === null) {
      const need = this.queue[0]!.units - this.tokens;
      const wait = Math.max(5, (need / this.ratePerSec) * 1000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, wait);
    }
  }
}
