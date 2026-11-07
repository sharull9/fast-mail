import { expect, test, type Page } from "@playwright/test";
import type { AccountSettings, ManagedContact, SaveContact } from "@mailfast/shared";

async function fixture(page: Page) {
  let activeId = "a";
  const values: Record<string, AccountSettings> = {
    a: { displayName: "", signature: "" },
    b: { displayName: "", signature: "" },
  };
  const contacts: Record<string, ManagedContact[]> = {
    a: [{ name: "Extracted Alice", email: "alice@example.com", hidden: false }],
    b: [],
  };
  const writes: { accountId: string; value: unknown }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const id = req.headers()["x-mailfast-account"] ?? activeId;
    let body: unknown;
    switch (url.pathname) {
      case "/api/connection":
        body = {
          paired: true,
          server: {
            product: "mailfast",
            protocolVersion: 1,
            instanceId: "settings",
            mode: "desktop",
            origin: "http://localhost:5299",
          },
        };
        break;
      case "/api/auth/status":
        body = {
          configured: true,
          signedIn: true,
          account: `${activeId}@example.com`,
          activeAccountId: activeId,
          accounts: ["a", "b"].map((accountId) => ({
            id: accountId,
            email: `${accountId}@example.com`,
            name: values[accountId].displayName || accountId.toUpperCase(),
            profileName: accountId.toUpperCase(),
            signature: values[accountId].signature,
            image: null,
            unread: 0,
          })),
        };
        break;
      case "/api/accounts/active":
        activeId = req.postDataJSON().id;
        await route.fulfill({
          json: {
            configured: true,
            signedIn: true,
            account: `${activeId}@example.com`,
            activeAccountId: activeId,
            accounts: ["a", "b"].map((accountId) => ({
              id: accountId,
              email: `${accountId}@example.com`,
              name: accountId.toUpperCase(),
              image: null,
              unread: 0,
              signature: values[accountId].signature,
            })),
          },
        });
        return;
      case "/api/events":
        await route.fulfill({ contentType: "text/event-stream", body: "" });
        return;
      case "/api/status":
        body = { phase: "idle", messagesStored: 0, pendingActions: 0, backfillDone: true };
        break;
      case "/api/labels":
        body = ["INBOX", "SENT", "TRASH"].map((label) => ({
          id: label,
          name: label,
          type: "system",
          unread: 0,
          total: 0,
          color: null,
        }));
        break;
      case "/api/threads":
      case "/api/search":
        body = { threads: [], hasMore: false, total: 0 };
        break;
      case "/api/sync":
      case "/api/prefetch":
        body = { ok: true };
        break;
      case "/api/settings/account":
        if (req.method() === "PUT") {
          values[id] = req.postDataJSON();
          writes.push({ accountId: id, value: values[id] });
        }
        body = values[id];
        break;
      case "/api/settings/contacts/import":
        body = { imported: 0 };
        break;
      case "/api/settings/contacts": {
        if (req.method() === "POST") {
          const value: SaveContact = req.postDataJSON();
          if (value.originalEmail && value.originalEmail !== value.email) {
            const old = contacts[id].find((item) => item.email === value.originalEmail);
            if (old) old.hidden = true;
          }
          const saved = { name: value.name, email: value.email, hidden: false };
          contacts[id] = [...contacts[id].filter((item) => item.email !== value.email), saved];
          writes.push({ accountId: id, value });
          body = saved;
        } else if (req.method() === "PATCH") {
          const value = req.postDataJSON();
          const contact = contacts[id].find((item) => item.email === value.email);
          if (contact) contact.hidden = value.hidden;
          body = { ok: true };
        } else {
          const q = url.searchParams.get("q")?.toLowerCase() ?? "";
          body = {
            contacts: contacts[id].filter(
              (item) =>
                item.hidden === (url.searchParams.get("hidden") === "true") &&
                `${item.name} ${item.email}`.toLowerCase().includes(q),
            ),
            nextOffset: null,
          };
        }
        break;
      }
      case "/api/contacts": {
        const q = url.searchParams.get("q")?.toLowerCase() ?? "";
        body = contacts[id].filter((item) => !item.hidden && `${item.name} ${item.email}`.toLowerCase().includes(q));
        break;
      }
      default:
        throw new Error(`Unexpected settings test request: ${url.pathname}`);
    }
    await route.fulfill({ json: body });
  });
  return { values, contacts, writes };
}

test("settings navigation and theme preferences persist and follow the system", async ({ page }) => {
  await fixture(page);
  await page.goto("/mail/INBOX");
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByText("Light", { exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.screenshot({ path: test.info().outputPath("settings-light.png") });
  await page.reload();
  await expect(page.getByRole("radio", { name: /Light/ })).toBeChecked();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByText("System", { exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByText("Dark", { exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("settings-dark.png") });
});

test("shortcuts record, reject conflicts, persist, disable and reset", async ({ page }) => {
  await fixture(page);
  await page.goto("/settings?section=shortcuts");
  const change = page.getByRole("button", { name: "Change Compose message shortcut", exact: true });
  await change.click();
  await page.keyboard.press("Alt+n");
  await expect(change).toContainText(/Alt.*N/i);
  await page.reload();
  await expect(change).toContainText(/Alt.*N/i);
  await change.click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("alert")).toContainText(/used by|Search mail/i);
  await page.keyboard.press("Escape");
  await expect(change).toContainText(/Alt.*N/i);
  await page.getByRole("link", { name: "Back to mail" }).click();
  await expect(page.getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.getByLabel("Email composer", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Alt+n");
  await expect(page.getByLabel("Email composer", { exact: true })).toBeVisible();
  await page.goto("/settings?section=shortcuts");
  await page.getByRole("button", { name: "Disable Compose message shortcut", exact: true }).click();
  await expect(change).toHaveText("Unassigned");
  await page.getByRole("button", { name: "Reset Compose message shortcut", exact: true }).click();
  await expect(change).toContainText(/C/i);
});

test("contacts can be added manually, edited, removed, restored and selected as recipients", async ({ page }) => {
  await fixture(page);
  await page.goto("/settings?section=contacts");
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  const form = page.getByRole("form", { name: "Add contact", exact: true });
  await form.getByLabel("Name").fill("Manual Bob");
  await form.getByLabel("Email", { exact: true }).fill("bob@example.com");
  await form.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Manual Bob", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit bob@example.com", exact: true }).click();
  await page.getByRole("form", { name: "Edit contact" }).getByLabel("Name").fill("Robert");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Robert", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove alice@example.com", exact: true }).click();
  await expect(page.getByText("Extracted Alice", { exact: true })).toHaveCount(0);
  await page.getByLabel("Show removed").check();
  await page.getByRole("button", { name: "Restore alice@example.com", exact: true }).click();
  await expect(page.getByText("Extracted Alice", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to mail" }).click();
  await page.getByRole("button", { name: "Compose message", exact: true }).click();
  await page.getByPlaceholder("Add recipients...").fill("bob");
  await page.getByText("Robert", { exact: true }).click();
  await expect(page.getByLabel("Email composer", { exact: true })).toContainText("bob@example.com");
});

test("account details save per account and new drafts insert an escaped signature once", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.goto("/settings?section=accounts");
  const account = page.getByRole("region", { name: "a@example.com", exact: true });
  await account.getByLabel("Account name").fill("My work");
  await account.getByLabel("Signature", { exact: true }).fill("Alice <Team>\nExample");
  await account.getByRole("button", { name: "Save changes" }).click();
  await expect(account.getByRole("status")).toHaveText("Account details saved.");
  expect(writes).toContainEqual({
    accountId: "a",
    value: { displayName: "My work", signature: "Alice <Team>\nExample" },
  });
  await expect(
    page.getByRole("region", { name: "b@example.com", exact: true }).getByLabel("Signature", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("link", { name: "Back to mail" }).click();
  await page.getByRole("button", { name: "Compose message", exact: true }).click();
  await expect(page.locator(".tiptap")).toContainText("Alice <Team>");
  await expect(page.locator(".tiptap")).toContainText("Example");
  expect(await page.locator(".tiptap").innerHTML()).toContain("&lt;Team&gt;");
});

test("settings stays usable on mobile and reports failed preference persistence", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // oxlint-disable-next-line typescript/unbound-method -- Preserve the receiver when calling the original below.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "mailfast.preferences.v1") throw new Error("Storage full");
      return original.call(this, key, value);
    };
  });
  await page.goto("/settings");
  await page.getByText("Light", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await expect(page.getByRole("form", { name: "Add contact", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("settings-mobile.png") });
});
