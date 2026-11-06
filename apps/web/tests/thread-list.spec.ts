import { expect, test, type Page } from "@playwright/test";
import type { ThreadRow } from "@mailfast/shared";

const threads: ThreadRow[] = [
  ["today", "2026-11-18T09:00:00"],
  ["yesterday", "2026-11-17T09:00:00"],
  ["week", "2026-11-16T09:00:00"],
  ["month", "2026-11-05T09:00:00"],
  ["october", "2026-10-15T09:00:00"],
  ["september", "2026-09-15T09:00:00"],
].map(([id = "", date = ""]) => ({
  id,
  subject: `Mail ${id}`,
  snippet: "Preview text",
  senders: [{ name: "Alice", email: "alice@example.com" }],
  lastDate: new Date(date).getTime(),
  messageCount: 1,
  unread: false,
  starred: false,
  important: false,
  labelIds: ["INBOX", "CATEGORY_PERSONAL"],
}));

async function mockMail(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-18T12:00:00"));
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
        body = { phase: "idle", messagesStored: threads.length, pendingActions: 0, backfillDone: true };
        break;
      case "/api/events":
        await route.fulfill({ contentType: "text/event-stream", body: "" });
        return;
      case "/api/labels":
        body = [{ id: "INBOX", name: "Inbox", type: "system", unread: 0, total: threads.length, color: null }];
        break;
      case "/api/threads":
        body = { threads, hasMore: false };
        break;
      case "/api/prefetch":
      case "/api/sync":
        body = { ok: true };
        break;
      default: {
        const thread = threads.find((item) => url.pathname === `/api/threads/${item.id}`);
        if (!thread) throw new Error(`Unexpected API request: ${url.pathname}`);
        body = { thread, complete: true, messages: [] };
      }
    }
    await route.fulfill({ json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.locator(".list")).toBeVisible({ timeout: 15_000 });
});

test("calendar months default to collapsed before the current month and retain user overrides", async ({ page }) => {
  for (const label of ["Today", "Yesterday", "This week", "Nov 2026"]) {
    await expect(page.getByRole("button", { name: `${label} 1`, exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  }
  const october = page.getByRole("button", { name: "Oct 2026 1", exact: true });
  await expect(october).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Sep 2026 1", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-thread-id="october"]')).toHaveCount(0);
  await october.click();
  await expect(october).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-thread-id="october"]')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mailfast.list-groups") ?? "{}"))).toEqual({
    "2026-10": false,
  });
  await page.reload();
  await expect(october).toHaveAttribute("aria-expanded", "true");
  await october.click();
  await expect(page.locator('[data-thread-id="october"]')).toHaveCount(0);
});

test("avatar slot reveals a checkbox on hover and selects without opening", async ({ page }) => {
  const row = page.locator('[data-thread-id="today"]');
  const checkbox = page.getByRole("checkbox", { name: "Select Mail today", exact: true });
  const avatar = row.locator('[data-slot="avatar"]');
  await page.mouse.move(0, 0);
  await expect(checkbox).toHaveCSS("opacity", "0");
  await expect(avatar).toBeVisible();
  await row.hover();
  await expect(checkbox).toHaveCSS("opacity", "1");
  await expect(avatar).toBeHidden();
  await row.locator("[data-avatar-slot]").click();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("checkbox", { name: "Select Mail yesterday", exact: true })).toHaveCSS("opacity", "1");
  await page.getByRole("checkbox", { name: "Select Mail month", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
});

test("select all and keyboard navigation skip collapsed rows", async ({ page }) => {
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Today 1", exact: true }).click();
  await page.locator('[data-thread-id="yesterday"]').focus();
  await page.keyboard.press("k");
  await expect(page).toHaveURL(/\/yesterday$/);
});

test("collapsed final month blocks paging until expanded", async ({ page }) => {
  const limits: string[] = [];
  await page.route("**/api/threads?**", async (route) => {
    limits.push(new URL(route.request().url()).searchParams.get("limit") ?? "");
    await route.fulfill({ json: { threads, hasMore: limits.length === 1 } });
  });
  await page.reload();
  const lastGroup = page.getByRole("button", { name: "Sep 2026 1", exact: true });
  await expect(lastGroup).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
  expect(limits).toEqual(["200"]);
  await lastGroup.focus();
  await page.keyboard.press("Enter");
  await expect(lastGroup).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => limits).toEqual(["200", "400"]);
});

test("row layout follows the list width independently of the open thread", async ({ page }) => {
  const list = page.locator(".list");
  const row = page.locator('[data-thread-id="today"]');
  await expect(row).toBeVisible();
  await list.evaluate((element) => {
    element.style.width = "600px";
  });
  await expect(row).not.toHaveClass(/narrow/);
  await expect(row).toHaveCSS("height", "44px");
  await list.evaluate((element) => {
    element.style.width = "500px";
  });
  await expect(row).toHaveClass(/narrow/);
  await expect(row).toHaveCSS("height", "56px");
});
