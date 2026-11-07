import { afterEach, expect, test } from "bun:test";
import { openMailStore } from "@mailfast/db";
import { Events } from "@/events.ts";
import { handleSettingsRequest } from "@/settings.ts";

const stores: ReturnType<typeof openMailStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
test("settings validates writes, lists recommendations and emits scoped events", async () => {
  const store = openMailStore({ path: ":memory:" });
  stores.push(store);
  const received: unknown[] = [];
  const events = new Events("account-a", (event) => received.push(event));
  const call = async (path: string, method = "GET", body?: unknown) => {
    const res = await handleSettingsRequest(
      new Request(`http://localhost/api/settings/${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { store, events },
    );
    if (!res) throw new Error("Missing settings handler");
    return res;
  };
  expect((await call("account", "PUT", { displayName: "Work", signature: "Alice" })).status).toBe(200);
  expect(await (await call("account")).json()).toEqual({ displayName: "Work", signature: "Alice" });
  expect((await call("contacts", "POST", { email: "bad", name: "A" })).status).toBe(400);
  expect((await call("contacts?limit=0")).status).toBe(400);
  await call("contacts", "POST", { email: "Alice@Example.com", name: "Alice" });
  expect(await (await call("contacts")).json()).toEqual({
    contacts: [{ email: "alice@example.com", name: "Alice", hidden: false }],
    nextOffset: null,
  });
  await call("contacts", "PATCH", { email: "alice@example.com", hidden: true });
  expect(store.searchContacts("")).toEqual([]);
  expect((await call("contacts", "PATCH", { email: "missing@example.com", hidden: true })).status).toBe(404);
  expect((await call("account", "DELETE")).status).toBe(405);
  expect(received).toContainEqual({ type: "contacts-changed", accountId: "account-a" });
});
