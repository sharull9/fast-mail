import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authSchema, openAppStore, openMailStore } from "@mailfast/db";
import { Accounts } from "@/accounts.ts";
import { Auth } from "@/auth.ts";
import { Events } from "@/events.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "mailfast-accounts-"));
  const app = openAppStore({ path: join(dir, "mail.sqlite") });
  const now = new Date();
  for (const id of ["first", "second"]) {
    app.db
      .insert(authSchema.user)
      .values({ id, name: id, email: `${id}@example.com`, createdAt: now, updatedAt: now })
      .run();
    app.db
      .insert(authSchema.account)
      .values({
        id,
        userId: id,
        accountId: `google-${id}`,
        providerId: "google",
        refreshToken: "fixture",
        scope: "https://www.googleapis.com/auth/gmail.modify",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    app.db
      .insert(authSchema.session)
      .values({ id, userId: id, token: id, expiresAt: new Date(Date.now() + 60_000), createdAt: now, updatedAt: now })
      .run();
  }
  const auth = new Auth(app, "http://127.0.0.1:47821", "test-secret-key-0123456789abcdef");
  // No Google grant is available in a local fixture; sign-out still removes the identity.
  auth.token = async () => {
    throw new Error("offline");
  };
  const started: string[] = [];
  const stopped: string[] = [];
  const accounts = new Accounts(auth, new Events(), dir, undefined, (_store, id) => ({
    start() {
      started.push(id);
    },
    async stop() {
      stopped.push(id);
    },
    wake() {},
    status: () => ({
      phase: "idle",
      account: auth.account(id),
      messagesStored: 0,
      oldestMessageDate: null,
      backfillDone: true,
      lastSyncAt: null,
      pendingActions: 0,
      error: null,
    }),
    ensureLabel: async () => {},
    ensureThread: async () => {},
    applyAction() {},
  }));
  accounts.refresh();
  cleanup.push(async () => {
    await accounts.close();
    app.close();
    // This is a test-created absolute directory under the OS temp directory.
    rmSync(dir, { recursive: true, force: true });
  });
  const request = (id?: string) =>
    new Request("http://localhost/api/threads", { headers: id ? { "x-mailfast-account": id } : {} });
  return { accounts, auth, app, dir, request, started, stopped };
}

test("accounts open separate stores and start every background engine, preserving existing auth", () => {
  const { accounts, request, started, app } = fixture();
  expect(started).toEqual(["first", "second"]);
  const first = accounts.resolve(request("first")).store;
  const second = accounts.resolve(request("second")).store;
  expect(first).not.toBe(second);
  first.kvSet("history_id", "first-history");
  expect(second.kvGet("history_id")).toBeNull();
  expect(app.kvGet("history_id")).toBeNull();
  expect(accounts.status().accounts.map((a) => a.email)).toEqual(["first@example.com", "second@example.com"]);
});

test("legacy mailbox rows are ignored while OAuth config, secret and signed-in identities survive", () => {
  const { app, dir, accounts, request } = fixture();
  app.kvSet("oauth_client", JSON.stringify({ clientId: "saved", clientSecret: "saved-secret" }));
  app.kvSet("secret_key_fallback", "saved-encryption-key");
  const legacy = openMailStore({ path: join(dir, "mail.sqlite") });
  legacy.upsertMessages(
    [
      {
        id: "old",
        threadId: "old",
        date: 1,
        fromName: "",
        fromEmail: "first@example.com",
        to: "",
        cc: "",
        subject: "Legacy cache",
        snippet: "",
        labelIds: ["INBOX"],
      },
    ],
    null,
  );
  legacy.close();
  expect(accounts.resolve(request("first")).store.messageCount()).toBe(0);
  expect(accounts.status().signedIn).toBe(true);
  expect(app.kvGet("secret_key_fallback")).toBe("saved-encryption-key");
  expect(app.kvGet("oauth_client")).toContain("saved-secret");
});

test("SSE forwards the originating account on background account events", async () => {
  const events = new Events();
  const reader = events.stream().body!.getReader();
  await reader.read(); // retry directive
  const first = new Events("first", (event) => events.send(event));
  const second = new Events("second", (event) => events.send(event));
  first.threadUpdated("shared-id");
  second.labelsChanged();
  const decoder = new TextDecoder();
  const one = decoder.decode((await reader.read()).value);
  const two = decoder.decode((await reader.read()).value);
  expect(one).toContain('"accountId":"first"');
  expect(two).toContain('"accountId":"second"');
  await reader.cancel();
});

test("header-scoped reads isolate identical Gmail thread IDs and missing headers use persisted active account", async () => {
  const { accounts, auth, app, request } = fixture();
  for (const id of ["first", "second"]) {
    accounts.resolve(request(id)).store.upsertMessages(
      [
        {
          id: "same-message",
          threadId: "same-thread",
          date: 1,
          fromName: id,
          fromEmail: `${id}@example.com`,
          to: "",
          cc: "",
          subject: id,
          snippet: "",
          labelIds: ["INBOX"],
        },
      ],
      null,
    );
  }
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { store } = accounts.resolve(req);
      return Response.json(store.listThreads("INBOX", Number.MAX_SAFE_INTEGER, 10));
    },
  });
  try {
    for (const id of ["first", "second"]) {
      const rows = await (await fetch(server.url, { headers: { "x-mailfast-account": id } })).json();
      expect(rows).toMatchObject([{ subject: id }]);
    }
    auth.setActive("second");
    expect(app.kvGet("active_account")).toBe("second");
    expect(await (await fetch(server.url)).json()).toMatchObject([{ subject: "second" }]);
    expect(() => accounts.resolve(request("missing"))).toThrow("Unknown");
  } finally {
    await server.stop(true);
  }
});

test("logging out one account deletes its file, user and sessions and leaves the other syncing", async () => {
  const { accounts, auth, app, dir, request, stopped } = fixture();
  auth.setActive("first");
  const second = accounts.resolve(request("second")).store;
  second.kvSet("history_id", "keep");
  const status = await accounts.logout("first");
  expect(status.activeAccountId).toBe("second");
  expect(status.account).toBe("second@example.com");
  expect(stopped).toEqual(["first"]);
  expect(second.kvGet("history_id")).toBe("keep");
  expect(existsSync(join(dir, "accounts", "first.sqlite"))).toBe(false);
  expect(
    app.db
      .select()
      .from(authSchema.session)
      .all()
      .map((s) => s.userId),
  ).toEqual(["second"]);
  expect(app.googleAccounts().map((a) => a.accountId)).toEqual(["second"]);
  expect((await accounts.logout()).signedIn).toBe(false);
});
