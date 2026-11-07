import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openMailStore, type MailStore } from "@mailfast/db";
import type { AuthStatus } from "@mailfast/shared";
import { Auth, AuthError } from "@/auth.ts";
import { Events } from "@/events.ts";
import { Gmail } from "@/gmail.ts";
import { SyncEngine } from "@/sync.ts";

type Engine = Pick<SyncEngine, "start" | "stop" | "wake" | "status" | "ensureLabel" | "ensureThread" | "applyAction">;
export type AccountRuntime = { store: MailStore; sync: Engine; gmail?: Gmail };

/** Auth owns identities; each runtime owns only one account's rebuildable mailbox. */
export class Accounts {
  private runtimes = new Map<string, AccountRuntime>();
  private removing = new Set<string>();

  constructor(
    private readonly auth: Auth,
    private readonly events: Events,
    private readonly dataDir: string,
    private readonly migrationsFolder?: string,
    private readonly createEngine: (store: MailStore, id: string, events: Events, gmail?: Gmail) => Engine = (
      store,
      id,
      events,
      gmail,
    ) => {
      const scopedAuth = {
        token: () => auth.token(id),
        invalidate: () => auth.invalidate(id),
        account: () => auth.account(id),
        status: () => ({ ...auth.status(), signedIn: auth.account(id) !== null }),
      };
      return new SyncEngine(store, gmail ?? new Gmail(scopedAuth), scopedAuth, events);
    },
  ) {
    mkdirSync(join(dataDir, "accounts"), { recursive: true });
    auth.onSignedIn(() => {
      this.refresh();
      this.events.send({ type: "accounts-changed", accountId: this.auth.activeId() ?? "" });
    });
  }

  refresh() {
    for (const account of this.auth.accounts()) {
      const id = account.accountId;
      if (this.runtimes.has(id) || this.removing.has(id)) continue;
      // IDs originate in Better Auth, but still validate before using one as a filename.
      if (!/^[\w-]+$/.test(id)) throw new AuthError("Invalid account ID");
      const store = openMailStore({ path: this.path(id), migrationsFolder: this.migrationsFolder });
      const events = new Events(id, (event) => this.events.send(event));
      const scopedAuth = {
        token: () => this.auth.token(id),
        invalidate: () => this.auth.invalidate(id),
        account: () => this.auth.account(id),
        status: () => ({ ...this.auth.status(), signedIn: this.auth.account(id) !== null }),
      };
      const gmail = new Gmail(scopedAuth);
      const sync = this.createEngine(store, id, events, gmail);
      this.runtimes.set(id, { store, sync, gmail });
      sync.start();
    }
  }

  private path(id: string) {
    return join(this.dataDir, "accounts", `${id}.sqlite`);
  }

  get(id: string): AccountRuntime | undefined {
    return this.removing.has(id) ? undefined : this.runtimes.get(id);
  }

  resolve(request: Request): AccountRuntime {
    const id = request.headers.get("x-mailfast-account") ?? this.auth.activeId();
    const runtime = id ? this.runtimes.get(id) : undefined;
    if (!runtime || (id && this.removing.has(id))) throw new AuthError("Unknown or signed-out account");
    return runtime;
  }

  status(): AuthStatus {
    const status = this.auth.status();
    return {
      ...status,
      accounts: status.accounts.map((account) => ({
        ...account,
        unread:
          this.runtimes
            .get(account.id)
            ?.store.labels()
            .find((label) => label.id === "INBOX")?.unread ?? 0,
      })),
    };
  }

  async logout(id?: string) {
    const ids = id ? [id] : [...this.runtimes.keys()];
    if (id && !this.runtimes.has(id)) throw new AuthError("Unknown account");
    for (const accountId of ids) {
      this.removing.add(accountId);
      const runtime = this.runtimes.get(accountId);
      if (runtime) await runtime.sync.stop();
      await this.auth.signOut(accountId);
      runtime?.store.close();
      this.runtimes.delete(accountId);
      for (const suffix of ["", "-wal", "-shm"]) rmSync(this.path(accountId) + suffix, { force: true });
      this.removing.delete(accountId);
    }
    if (!id) await this.auth.signOut();
    this.events.send({ type: "accounts-changed", accountId: this.auth.activeId() ?? "" });
    return this.status();
  }

  async close() {
    for (const runtime of this.runtimes.values()) {
      await runtime.sync.stop();
      runtime.store.close();
    }
    this.runtimes.clear();
  }
}
