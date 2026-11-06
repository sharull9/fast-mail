import { expect, test, type Page } from "@playwright/test";
import type { ThreadRow } from "@mailfast/shared";

const thread: ThreadRow = {
  id: "primary",
  subject: "Layout test conversation",
  snippet: "Preview text",
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
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    switch (path) {
      case "/api/connection":
        body = {
          server: {
            product: "mailfast",
            protocolVersion: 1,
            instanceId: "layout-test",
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
        body = ["INBOX", "STARRED", "CATEGORY_PERSONAL"].map((id) => ({
          id,
          name: id,
          type: "system",
          total: 1200,
          unread: 10,
          color: null,
        }));
        break;
      case "/api/threads":
      case "/api/search":
        body = { threads: [thread], hasMore: false };
        break;
      case "/api/threads/primary":
        body = { thread, complete: true, messages: [] };
        break;
      case "/api/prefetch":
      case "/api/sync":
        body = { ok: true };
        break;
      default:
        throw new Error(`Unexpected API request: ${path}`);
    }
    await route.fulfill({ json: body });
  });
}

async function expectCenteredTabs(page: Page) {
  const tabs = page.getByRole("tablist", { name: "Inbox categories" });
  const toolbar = page.locator(".list-head");
  await expect(tabs).toBeVisible();
  const metrics = await tabs.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
  const tabBounds = await tabs.boundingBox();
  const toolbarBounds = await toolbar.boundingBox();
  if (!tabBounds || !toolbarBounds) throw new Error("Missing toolbar or tab bounds");
  expect(tabBounds.height).toBe(32);
  expect(Math.abs(tabBounds.y + tabBounds.height / 2 - toolbarBounds.y - toolbarBounds.height / 2)).toBeLessThanOrEqual(
    1,
  );
}

test.beforeEach(async ({ page }) => {
  await mockMail(page);
});

test("one compact toolbar contains categories and counts, with an empty preview", async ({ page }) => {
  // Next to the category tabs the counts only show once the list panel is >= 560px wide.
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/mail/INBOX");
  const toolbar = page.locator(".list-head");
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toHaveCount(0);
  await expect(toolbar.getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await expect(toolbar.getByText("1,200 conversations · 10 unread", { exact: true })).toBeVisible();
  expect(await toolbar.evaluate((element) => element.getBoundingClientRect().height)).toBe(44);
  await expectCenteredTabs(page);
  await expect(page.getByText("No conversation selected", { exact: true })).toBeVisible();
  await expect(page.getByText("Pick one from the list, or press j / k")).toBeVisible();
});

test("list starts at forty percent and both panels stop at thirty percent", async ({ page }) => {
  await page.goto("/mail/INBOX");
  const group = page.locator('[data-slot="resizable-panel-group"]');
  const list = page.locator(".list-col");
  const handle = page.getByRole("separator", { name: "Resize conversation panels" });
  await expect(handle).toBeVisible();
  const bounds = await group.boundingBox();
  if (!bounds) throw new Error("Missing split bounds");
  const fraction = () =>
    list.evaluate((element) => element.getBoundingClientRect().width).then((width) => width / bounds.width);
  await expect.poll(fraction).toBeGreaterThan(0.39);
  await expect.poll(fraction).toBeLessThan(0.41);
  await expectCenteredTabs(page);
  for (const [x, expected] of [
    [bounds.x, 0.3],
    [bounds.x + bounds.width, 0.7],
  ]) {
    const grip = await handle.boundingBox();
    if (!grip) throw new Error("Missing separator bounds");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, grip.y + grip.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(fraction).toBeGreaterThan(expected - 0.01);
    await expect.poll(fraction).toBeLessThan(expected + 0.01);
    await expectCenteredTabs(page);
  }
  const saved = await fraction();
  await page.reload();
  await expect.poll(fraction).toBeGreaterThan(saved - 0.01);
  await expect.poll(fraction).toBeLessThan(saved + 0.01);
  await expect(page.locator(".list-head").getByText("1,200 conversations · 10 unread")).toBeVisible();
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".list-head").getByText("1,200 conversations · 10 unread")).toBeHidden();
});

test("search shares the split and mobile conversations fill the mailbox", async ({ page }) => {
  await page.goto("/search?q=invoice");
  await expect(page.locator(".list-head")).toContainText("Search: invoice");
  await expect(page.locator(".list-head").getByRole("button", { name: "Clear search" })).toBeVisible();
  await expect(page.getByText("No conversation selected", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mail/INBOX/primary");
  await expect(page.getByRole("heading", { name: thread.subject })).toBeVisible();
  await expect(page.locator('[data-slot="resizable-panel-group"]')).toHaveCount(0);
  await expect(page.locator(".list-col")).toHaveCount(0);
  await page.getByRole("button", { name: "Close conversation" }).click();
  await expect(page.locator(".list-col")).toBeVisible();
});
