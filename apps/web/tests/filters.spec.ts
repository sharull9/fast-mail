import { expect, test, type Page } from "@playwright/test";
import type { ThreadRow } from "@mailfast/shared";

const today = new Date();
today.setHours(12, 0, 0, 0);
function dayOffset(offset: number, end = false) {
  const date = new Date(today);
  date.setDate(date.getDate() + offset);
  date.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return date;
}
const dateKey = (date: Date) => new Intl.DateTimeFormat("en-CA").format(date);
const query = `from=${dateKey(dayOffset(-6))}&to=${dateKey(today)}`;
const threads: ThreadRow[] = [
  { id: "recent", lastDate: dayOffset(0, true).getTime() },
  { id: "boundary", lastDate: dayOffset(-6).getTime() },
  { id: "older", lastDate: dayOffset(-7, true).getTime() },
].map((thread) => ({
  ...thread,
  subject: `Mail ${thread.id}`,
  snippet: "Preview",
  senders: [{ name: "Alice", email: "alice@example.com" }],
  messageCount: 1,
  unread: true,
  starred: true,
  important: true,
  labelIds: ["INBOX", "IMPORTANT", "STARRED"],
}));

async function mockMail(page: Page, oldestMessageDate: number | null = null) {
  await page.clock.setFixedTime(today);
  const overrides = Object.fromEntries(
    threads.map((thread) => {
      const date = new Date(thread.lastDate);
      return [`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, false];
    }),
  );
  await page.addInitScript(
    (overrides) => localStorage.setItem("mailfast.list-groups", JSON.stringify(overrides)),
    overrides,
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown;
    switch (path) {
      case "/api/connection":
        body = {
          server: {
            product: "mailfast",
            protocolVersion: 1,
            instanceId: "filters-test",
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
        body = { phase: "idle", messagesStored: 3, pendingActions: 0, backfillDone: true, oldestMessageDate };
        break;
      case "/api/events":
        await route.fulfill({ contentType: "text/event-stream", body: "" });
        return;
      case "/api/labels":
        body = ["INBOX", "ALL", "STARRED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH"].map((id) => ({
          id,
          name: id,
          type: "system",
          total: 3,
          unread: 3,
          color: null,
        }));
        break;
      case "/api/threads": {
        const after = Number(url.searchParams.get("after") ?? -Infinity);
        const before = Number(url.searchParams.get("before") ?? Infinity);
        const filtered = threads.filter((t) => t.lastDate >= after && t.lastDate < before);
        const limit = Number(url.searchParams.get("limit") ?? 200);
        body = { threads: filtered.slice(0, limit), hasMore: filtered.length > limit, total: filtered.length };
        break;
      }
      case "/api/prefetch":
      case "/api/sync":
      case "/api/threads/actions":
        body = { ok: true };
        break;
      case "/api/chat/spaces":
        body = { spaces: [] };
        break;
      default: {
        const thread = threads.find((item) => path === `/api/threads/${item.id}`);
        if (!thread) throw new Error(`Unexpected API request: ${path}`);
        body = { thread, complete: true, messages: [] };
      }
    }
    await route.fulfill({ json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await mockMail(page);
});

test("Inbox is the default scope and scopes are absent from the sidebar", async ({ page }) => {
  await page.goto("/mail/INBOX");
  await expect(page.getByRole("combobox", { name: /Filter: Inbox/ })).toBeVisible();
  for (const labelId of ["ALL", "STARRED", "IMPORTANT"])
    await expect(page.locator(`[data-slot="sidebar"] a[href="/mail/${labelId}"]`)).toHaveCount(0);
  await expect(page.locator(".selection-bar").getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await page.getByRole("combobox", { name: /Filter: Inbox/ }).click();
  await expect(page.getByRole("radiogroup", { name: "Mail filter options" })).toBeVisible();
  await page.getByRole("radio", { name: /^All mail/ }).click();
  await expect(page).toHaveURL(/\/mail\/ALL$/);
  await expect(page.getByRole("combobox", { name: /Filter: All mail/ })).toBeVisible();
});

test("scope changes and thread opening and closing preserve URL dates", async ({ page }) => {
  await page.goto(`/mail/INBOX?${query}`);
  await page.getByRole("combobox", { name: /Filter: Inbox/ }).click();
  await page.getByRole("radio", { name: /^Starred/ }).click();
  await expect(page).toHaveURL(new RegExp(`/mail/STARRED\\?${query}$`));
  await page.locator('[data-thread-id="recent"]').click();
  await expect(page).toHaveURL(new RegExp(`/STARRED/recent\\?${query}$`));
  await page.getByRole("button", { name: "Close conversation" }).click();
  await expect(page).toHaveURL(new RegExp(`/STARRED\\?${query}$`));
});

test("Last 7 days includes local boundary dates and clearing restores older mail", async ({ page }) => {
  await page.goto("/mail/INBOX");
  await expect(page.locator('[data-thread-id="older"]')).toBeVisible();
  await page.getByRole("button", { name: "Date range: Any time" }).click();
  await expect(page.locator('[data-slot="calendar"]')).toBeVisible();
  const request = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/threads" && url.searchParams.has("after") && url.searchParams.has("before");
  });
  await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
  const requested = new URL((await request).url());
  expect(requested.searchParams.get("after")).toBe(String(dayOffset(-6).getTime()));
  expect(requested.searchParams.get("before")).toBe(String(dayOffset(1).getTime()));
  await expect(page).toHaveURL(new RegExp(`${query}$`));
  await expect(page.locator('[data-thread-id="recent"]')).toBeVisible();
  await expect(page.locator('[data-thread-id="boundary"]')).toBeVisible();
  await expect(page.locator('[data-thread-id="older"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Clear date filter", exact: true }).click();
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await expect(page.locator('[data-thread-id="older"]')).toBeVisible();
});

test("a preset finds conversations beyond the first 200 cached rows", async ({ page }) => {
  const source = [
    ...Array.from({ length: 205 }, (_, i) => ({ ...threads[0]!, id: `today-${i}` })),
    { ...threads[0]!, id: "previously-unloaded", lastDate: dayOffset(-1).getTime() },
  ];
  await page.route("**/api/threads/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const thread = source.find((t) => t.id === id);
    return route.fulfill({ json: { thread, messages: [], complete: true } });
  });
  await page.route("**/api/threads?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const after = Number(params.get("after") ?? -Infinity);
    const before = Number(params.get("before") ?? Infinity);
    const filtered = source.filter((t) => t.lastDate >= after && t.lastDate < before);
    const limit = Number(params.get("limit") ?? 200);
    await route.fulfill({
      json: { threads: filtered.slice(0, limit), hasMore: filtered.length > limit, total: filtered.length },
    });
  });
  await page.route("**/api/labels", (route) =>
    route.fulfill({
      json: [{ id: "INBOX", name: "Inbox", type: "system", total: source.length, unread: source.length, color: null }],
    }),
  );
  await page.goto("/mail/INBOX");
  await expect(page.getByText("1–200 of 206", { exact: true })).toHaveCount(1);
  await expect(page.locator('[data-thread-id="previously-unloaded"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Date range: Any time" }).click();
  await page.getByRole("button", { name: "Yesterday", exact: true }).click();
  await expect(page.locator('[data-thread-id="previously-unloaded"]')).toBeVisible();
  await expect(page.getByText("1–1 of 1", { exact: true })).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
});

test("an empty date range offers a clear action", async ({ page }) => {
  await page.goto(`/mail/INBOX?to=${dateKey(dayOffset(-8))}`);
  await expect(page.getByText("No conversations in this date range", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear date filter", exact: true }).last().click();
  await expect(page.locator('[data-thread-id="recent"]')).toBeVisible();
});

test("important is an icon before the star and date in the right meta group", async ({ page }) => {
  await page.goto("/mail/INBOX");
  const row = page.locator('[data-thread-id="recent"]');
  await expect(row.locator(".row-meta > .row-important + .row-star + .date")).toHaveCount(1);
  const marker = row.getByRole("button", { name: "Marked important — click to unmark" });
  await expect(marker).toHaveText("");
  await expect(marker).toHaveCSS("width", "20px");
  await marker.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Important");
});

test("calendar uses one month on mobile and applies a custom range", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mail/INBOX");
  await page.getByRole("button", { name: "Date range: Any time" }).focus();
  await page.keyboard.press("Enter");
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar.getByRole("grid")).toHaveCount(1);
  await expect(calendar.locator(`button[data-day="${dayOffset(1).toLocaleDateString("en-US")}"]`)).toBeDisabled();
  await expect(calendar.getByRole("button", { name: "Go to the Next Month" })).toBeDisabled();
  if (dayOffset(-6).getMonth() !== today.getMonth())
    await calendar.getByRole("button", { name: "Go to the Previous Month" }).click();
  await calendar.locator(`button[data-day="${dayOffset(-6).toLocaleDateString("en-US")}"]`).click();
  if (dayOffset(-6).getMonth() !== today.getMonth())
    await calendar.getByRole("button", { name: "Go to the Next Month" }).click();
  await calendar.locator(`button[data-day="${today.toLocaleDateString("en-US")}"]`).click();
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${query}$`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("URL dates cannot extend into the future", async ({ page }) => {
  await page.goto(`/mail/INBOX?from=${dateKey(dayOffset(1))}&to=${dateKey(dayOffset(30))}`);
  await expect(page.getByRole("button", { name: /^Date range: Until / })).toBeVisible();
  await expect(page.locator('[data-thread-id="recent"]')).toBeVisible();
  await page.getByRole("combobox", { name: /Filter: Inbox/ }).click();
  await page.getByRole("radio", { name: /^Starred/ }).click();
  await expect(page).toHaveURL(new RegExp(`/STARRED\\?to=${dateKey(today)}$`));
});

test("invalid dates are ignored and category labels activate Inbox", async ({ page }) => {
  await page.goto("/mail/CATEGORY_SOCIAL?from=2026-02-30&to=invalid");
  await expect(page.getByRole("combobox", { name: /Filter: Inbox/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Date range: Any time" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Social", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("calendar stops at the oldest mail day and month and shows the bound", async ({ page }) => {
  const oldest = new Date(today.getFullYear(), today.getMonth() - 2, 12);
  const before = new Date(oldest);
  before.setDate(before.getDate() - 1);
  await mockMail(page, oldest.getTime());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/mail/INBOX?from=${dateKey(oldest)}&to=${dateKey(today)}`);
  await page.getByRole("button", { name: /^Date range:/ }).click();
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar.locator(`button[data-day="${before.toLocaleDateString("en-US")}"]`)).toBeDisabled();
  await expect(calendar.getByRole("button", { name: "Go to the Previous Month" })).toBeDisabled();
  const label = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(oldest);
  await expect(page.getByText(`Mail from ${label}`, { exact: true })).toBeVisible();
});

test("URL ranges clamp to the oldest local day and drop wholly older ranges", async ({ page }) => {
  const oldest = dayOffset(-7);
  await mockMail(page, oldest.getTime());
  await page.goto(`/mail/INBOX?from=${dateKey(dayOffset(-30))}&to=${dateKey(today)}`);
  await expect(page).toHaveURL(new RegExp(`from=${dateKey(oldest)}&to=${dateKey(today)}$`));
  await page.goto(`/mail/INBOX?from=${dateKey(dayOffset(-30))}&to=${dateKey(dayOffset(-8))}`);
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await expect(page.locator('[data-thread-id="recent"]')).toBeVisible();
});

test("presets clamp partial ranges and disable ranges before the oldest mail", async ({ page }) => {
  await mockMail(page, today.getTime());
  await page.goto("/mail/INBOX");
  await page.getByRole("button", { name: "Date range: Any time" }).click();
  await expect(page.getByRole("button", { name: "Yesterday", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Last month", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "This year", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`from=${dateKey(today)}&to=${dateKey(today)}$`));
});
