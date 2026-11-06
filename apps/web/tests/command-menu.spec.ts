import { expect, test, type Page } from "@playwright/test";
import type { ThreadRow } from "@mailfast/shared";

const thread: ThreadRow = {
  id: "primary",
  subject: "Invoice for November",
  snippet: "Your invoice is ready",
  senders: [{ name: "Alice", email: "alice@example.com" }],
  lastDate: 300,
  messageCount: 1,
  unread: false,
  starred: false,
  important: false,
  labelIds: ["INBOX", "CATEGORY_PERSONAL"],
};

async function mockMail(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    switch (url.pathname) {
      case "/api/connection":
        body = {
          server: {
            product: "mailfast",
            protocolVersion: 1,
            instanceId: "test-server",
            mode: "desktop",
            origin: "http://localhost:5299",
          },
          paired: true,
        };
        break;
      case "/api/auth/status":
        body = { configured: true, signedIn: true, account: "me@example.com" };
        break;
      case "/api/status":
        body = { phase: "idle", messagesStored: 1, pendingActions: 0, backfillDone: true };
        break;
      case "/api/events":
        await route.fulfill({ contentType: "text/event-stream", body: "" });
        return;
      case "/api/labels":
        body = ["INBOX", "STARRED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH"].map((id) => ({
          id,
          name: id,
          type: "system",
          unread: 0,
          total: 1,
          color: null,
        }));
        break;
      case "/api/threads":
        body = { threads: [thread], hasMore: false };
        break;
      case "/api/search":
        body = { threads: /invoice|alice/i.test(url.searchParams.get("q") ?? "") ? [thread] : [], hasMore: false };
        break;
      case "/api/prefetch":
        body = { ok: true };
        break;
      case "/api/threads/primary":
        body = {
          thread,
          complete: true,
          messages: [
            {
              id: "message-primary",
              threadId: thread.id,
              date: thread.lastDate,
              from: thread.senders[0],
              to: "me@example.com",
              subject: thread.subject,
              snippet: thread.snippet,
              labelIds: thread.labelIds,
              unread: false,
              starred: false,
            },
          ],
        };
        break;
      default:
        throw new Error(`Unexpected API request: ${url.pathname}`);
    }
    await route.fulfill({ json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.getByRole("button", { name: "Search mail", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox")).toBeFocused();
});

test("empty palette has compact guidance without a hint row or result count", async ({ page }) => {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByPlaceholder("Search mail or type @ for commands", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Go to", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Actions", { exact: true })).toBeVisible();
  await expect(dialog.locator(".command-examples")).toHaveCount(0);
  await expect(dialog).not.toContainText("Try @inbox");
  await expect(dialog.locator("footer")).toContainText("Type @ for commands");
  await expect(dialog.locator("footer")).not.toContainText("0 results");
  await expect(dialog.getByRole("button", { name: "Clear search", exact: true })).toHaveCount(0);
});

test("commands show their name and token on one 36px line", async ({ page }) => {
  const inbox = page.getByRole("option", { name: "Inbox @inbox", exact: true });
  await expect(inbox).toBeVisible();
  const name = inbox.getByText("Inbox", { exact: true });
  const token = inbox.getByText("@inbox", { exact: true });
  await expect(token).toBeVisible();
  const nameBox = await name.boundingBox();
  const tokenBox = await token.boundingBox();
  expect(nameBox).not.toBeNull();
  expect(tokenBox).not.toBeNull();
  if (nameBox && tokenBox)
    expect(Math.abs(nameBox.y + nameBox.height / 2 - tokenBox.y - tokenBox.height / 2)).toBeLessThan(2);
  expect((await inbox.boundingBox())?.height).toBe(36);
  await expect(page.getByRole("option", { name: "Archive @archive e", exact: true }).locator("kbd")).toHaveText("e");
});

test("a query shows compact highlighted mail and a footer result count", async ({ page }) => {
  await page.getByRole("combobox").fill("@user:alice invoice");
  const result = page.getByRole("option", { name: /Invoice for November/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText("Your invoice is ready");
  await expect(result.locator("mark")).toHaveCount(2);
  expect((await result.boundingBox())?.height).toBe(52);
  await expect(page.getByRole("dialog").locator("footer")).toContainText("1 results");
  await expect(page.getByRole("button", { name: "Clear search", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("combobox")).toHaveValue("");
  await expect(page.getByRole("combobox")).toBeFocused();
});

test("an unmatched query shows the query in the empty state", async ({ page }) => {
  await page.getByRole("combobox").fill("missing-conversation");
  await expect(page.getByText("No results for “missing-conversation”", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").locator("footer")).toContainText("0 results");
});

for (const [token, labelId] of [
  ["starred", "STARRED"],
  ["important", "IMPORTANT"],
  ["all", "ALL"],
]) {
  test(`@${token} still opens its scope`, async ({ page }) => {
    await page.getByRole("combobox").fill(`@${token}`);
    await page.getByRole("option").first().click();
    await expect(page).toHaveURL(new RegExp(`/mail/${labelId}$`));
    await expect(page.getByRole("radio", { checked: true })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Inbox categories" })).toHaveCount(0);
  });
}
