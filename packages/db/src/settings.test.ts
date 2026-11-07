import { afterEach, expect, test } from "bun:test";
import { openMailStore } from "./index.ts";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stores: ReturnType<typeof openMailStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function fixture() {
  const store = openMailStore({ path: ":memory:" });
  stores.push(store);
  return store;
}

test("manual recommendations survive extraction, removal and restoration", () => {
  const store = fixture();
  store.recordContact("ALICE@example.com", "Extracted");
  store.saveContact({ email: "alice@example.com", name: "My Alice" });
  store.recordContact("alice@example.com", "Later extraction");
  expect(store.searchContacts("alice")).toEqual([{ email: "alice@example.com", name: "My Alice" }]);
  store.setContactHidden("alice@example.com", true);
  store.recordContact("alice@example.com", "Another extraction");
  expect(store.searchContacts("alice")).toEqual([]);
  store.importContacts([{ email: "alice@example.com", name: "Legacy" }]);
  expect(store.searchContacts("alice")).toEqual([]);
  store.setContactHidden("alice@example.com", false);
  expect(store.searchContacts("alice")[0]?.name).toBe("My Alice");
});

test("contact edits normalize duplicates and page removed entries", () => {
  const store = fixture();
  store.saveContact({ email: " Bob@Example.com ", name: "Bob" });
  store.saveContact({ email: "bob@example.com", name: "" });
  store.recordContact("bob@example.com", "Extracted Bob");
  expect(store.searchContacts("bob")).toEqual([{ email: "bob@example.com", name: "" }]);
  store.saveContact({ originalEmail: "bob@example.com", email: "new@example.com", name: "New" });
  expect(store.searchContacts("bob")).toEqual([]);
  expect(store.listContacts({ q: "", hidden: true, offset: 0, limit: 1 }).contacts[0]?.email).toBe("bob@example.com");
  store.saveContact({ email: "z@example.com", name: "Z" });
  const page = store.listContacts({ q: "", hidden: false, offset: 0, limit: 1 });
  expect(page.contacts[0]?.email).toBe("new@example.com");
  expect(page.nextOffset).toBe(1);
  expect(() => store.setContactHidden("missing@example.com", true)).toThrow();
});

test("account details and recommendations stay isolated", () => {
  const a = fixture(),
    b = fixture();
  a.saveAccountSettings({ displayName: "Personal", signature: "Alice\nTeam" });
  a.importContacts([{ email: "alice@example.com", name: "Alice" }]);
  a.importContacts([{ email: "alice@example.com", name: "Alice" }]);
  expect(a.searchContacts("")).toHaveLength(1);
  expect(b.searchContacts("")).toEqual([]);
  expect(b.accountSettings()).toEqual({ displayName: "", signature: "" });
  expect(a.accountSettings().signature).toBe("Alice\nTeam");
});

test("settings migrations adopt a legacy runtime contacts table without losing data", () => {
  const directory = mkdtempSync(join(tmpdir(), "mailfast-settings-"));
  const path = join(directory, "legacy.sqlite");
  let store = openMailStore({ path });
  try {
    store.recordContact("legacy@example.com", "Legacy");
    store.sqlite.exec("ALTER TABLE contacts DROP COLUMN manual_name; ALTER TABLE contacts DROP COLUMN hidden;");
    store.sqlite.exec(
      "DELETE FROM __drizzle_migrations WHERE created_at IN (SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 2)",
    );
    store.close();
    store = openMailStore({ path });
    expect(store.searchContacts("legacy")).toEqual([{ email: "legacy@example.com", name: "Legacy" }]);
    store.saveContact({ email: "legacy@example.com", name: "Manually edited" });
    store.saveAccountSettings({ displayName: "Legacy account", signature: "Saved signature" });
    store.close();
    store = openMailStore({ path });
    expect(store.searchContacts("legacy")[0]?.name).toBe("Manually edited");
    expect(store.accountSettings().signature).toBe("Saved signature");
  } finally {
    store.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
    rmdirSync(directory);
  }
});
