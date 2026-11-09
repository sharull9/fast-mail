import { expect, test, type Page } from "@playwright/test";
import type { ThreadRow } from "@mailfast/shared";

const thread: ThreadRow = {
  id: "primary",
  subject: "Layout test conversation",
  snippet: "Preview text",
  senders: [{ name: "Alice", email: "alice@example.com" }],
  lastDate: Date.now(),
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
      case "/api/chat/spaces":
        body = { spaces: [] };
        break;
      default:
        throw new Error(`Unexpected API request: ${path}`);
    }
    await route.fulfill({ json: body });
  });
}

async function expectCenteredTabs(page: Page) {
  const tabs = page.getByRole("tablist", { name: "Inbox categories" });

  const toolbar = page.locator(".selection-bar");
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

test("two compact rows contain scopes, dates, categories and counts, with an empty preview", async ({ page }) => {
  // Counts fit next to the scope and date filters once the list panel is >= 820px wide.

  await page.setViewportSize({ width: 2600, height: 900 });
  await page.goto("/mail/INBOX");
  const toolbar = page.locator(".list-head");
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toHaveCount(0);

  await expect(page.locator(".selection-bar").getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await expect(toolbar.getByText("1,200 conversations · 10 unread", { exact: true })).toBeVisible();
  expect(await toolbar.evaluate((element) => element.getBoundingClientRect().height)).toBe(44);

  await expect(toolbar.getByRole("combobox", { name: /Filter: Inbox/ })).toBeVisible();
  await expectCenteredTabs(page);
  await expect(page.getByText("No conversation selected", { exact: true })).toBeVisible();
  await expect(page.getByText("Pick a conversation from the list to read it.")).toBeVisible();
  const preview = page.locator(".preview-pane");
  await expect(preview.getByText("Inbox · 1,200 conversations · 10 unread", { exact: true })).toBeVisible();
  await expect(preview.getByRole("region", { name: "Quick shortcuts" })).toBeVisible();
  await expect(preview.getByRole("region", { name: "Mail tips" })).toBeVisible();
  await expect(preview.locator("kbd")).toHaveCount(7);

  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(preview.getByText("All keyboard shortcuts", { exact: true })).toBeVisible();
  const overflow = await preview.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("list starts at forty percent and both panels stop at twenty percent", async ({ page }) => {
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
    [bounds.x + bounds.width * 0.2, 0.2],
    [bounds.x + bounds.width * 0.8, 0.8],
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
  await expect(page.locator(".selection-bar").getByText("1–1 of 1,200")).toBeVisible();
});

test("list can be collapsed to icon strip and expanded with trigger buttons", async ({ page }) => {
  await page.goto("/mail/INBOX");
  const list = page.locator(".list-col");
  await expect(list).toBeVisible();
  await page.getByRole("button", { name: "Collapse list" }).click();
  await expect(page.getByRole("button", { name: "Expand list" })).toBeVisible();

  // In collapsed state, list collapses to 48px icon strip, showing icons instead of hiding all
  const collapsedBounds = await list.boundingBox();
  expect(collapsedBounds?.width).toBe(48);
  await expect(list.getByRole("combobox", { name: /Filter: Inbox/ })).toBeVisible();
  const collapsedRow = list.getByRole("row", { name: /Alice/ });
  await expect(collapsedRow).toBeVisible();

  // Clicking an avatar row in collapsed mode opens the conversation
  await collapsedRow.click();
  await expect(page.getByRole("heading", { name: thread.subject })).toBeVisible();

  // Expanding restores wide list
  await page.getByRole("button", { name: "Expand list" }).click();
  await expect(page.getByRole("button", { name: "Collapse list" })).toBeVisible();
  await expect.poll(async () => (await list.boundingBox())?.width).toBeGreaterThan(200);
});

for (const path of ["/mail/INBOX", "/search?q=layout"]) {
  test(`collapsed conversation avatars keep their virtualized spacing on ${path}`, async ({ page }) => {
    const threads = Array.from({ length: 30 }, (_, index) => ({
      ...thread,
      id: `compact-${index}`,
      subject: `Compact conversation ${index}`,
    }));
    await page.route(/\/api\/(threads|search)(\?|$)/, (route) =>
      route.fulfill({ json: { threads, hasMore: false } }),
    );
    await page.route("**/api/threads/compact-*", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      return route.fulfill({ json: { thread: threads.find((item) => item.id === id), complete: true, messages: [] } });
    });
    await page.goto(path);
    await page.getByRole("button", { name: "Collapse list" }).click();

    const list = page.locator(".list-col");
    const first = list.locator('[data-thread-id="compact-0"]');
    const second = list.locator('[data-thread-id="compact-1"]');
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await expect.poll(async () => {
      const firstBounds = await first.boundingBox();
      const secondBounds = await second.boundingBox();
      if (!firstBounds || !secondBounds) throw new Error("Missing collapsed conversation rows");
      return secondBounds.y - firstBounds.y;
    }).toBe(40);

    await list.locator(".list").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(list.locator('[data-thread-id="compact-29"]')).toBeInViewport();
  });
}

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

test("very narrow viewports start in the single-pane mail layout", async ({ page }) => {
  await page.setViewportSize({ width: 110, height: 1024 });
  await page.goto("/mail/INBOX");

  await expect(page.locator(".mobile-tools")).toBeVisible();
  await expect(page.locator('[data-slot="resizable-panel-group"]')).toHaveCount(0);
  await expect(page.locator(".list-col")).toBeVisible();
  await expect(page.locator('[data-slot="sidebar-container"]')).toHaveCount(0);
});

test("narrow conversation rows avoid oversized vertical gaps", async ({ page }) => {
  const secondThread: ThreadRow = {
    ...thread,
    id: "secondary",
    subject: "Second layout test conversation",
  };
  await page.route("**/api/threads**", (route) =>
    route.fulfill({ json: { threads: [thread, secondThread], hasMore: false } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mail/INBOX");

  const rows = page.getByRole("row");
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  if (!first || !second) throw new Error("Missing conversation rows");
  expect(second.y - first.y).toBeLessThanOrEqual(72);
});
