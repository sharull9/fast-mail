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
  senders: [
    {
      name: id === "today" ? "Matt" : id === "week" ? "AnExtremelyLongSenderNameThatMustTruncate" : "Alice",
      email: "alice@example.com",
    },
  ],
  lastDate: new Date(date).getTime(),
  messageCount: id === "today" || id === "week" ? 2 : 1,
  unread: id === "yesterday" || id === "week",
  starred: false,
  important: id === "yesterday",
  labelIds: ["INBOX", "CATEGORY_PERSONAL"],
}));

async function mockMail(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-18T12:00:00"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    switch (url.pathname) {
      case "/api/chat/spaces":
        body = { spaces: [] };
        break;
      case "/api/avatar":
        body = { google: null, gravatar: null };
        break;
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
      case "/api/threads/actions":
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

test("avatar is the selection control and shift click selects without opening", async ({ page }) => {
  const row = page.locator('[data-thread-id="today"]');
  const checkbox = page.getByRole("checkbox", { name: "Select Mail today", exact: true });
  const avatar = row.locator('[data-slot="avatar"]');
  await page.mouse.move(0, 0);
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toHaveCSS("width", "32px");
  await expect(checkbox).toHaveCSS("height", "32px");
  await expect(avatar).toBeVisible();
  await row.hover();
  await expect(avatar).toBeVisible();
  await expect(row.locator(".lucide-check")).toHaveCount(0);
  await row.locator("[data-avatar-slot]").click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveClass(/bg-primary/);
  await expect(checkbox.locator(".lucide-check")).toBeVisible();
  await expect(checkbox.locator(".lucide-check")).toHaveAttribute("stroke-width", "3");
  await expect(avatar).toHaveCount(0);
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-thread-id="yesterday"] [data-slot="avatar"]')).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Mail month", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
});

test("select all uses visible rows and keyboard navigation expands a collapsed previous group", async ({ page }) => {
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Today 1", exact: true }).click();
  await page.locator('[data-thread-id="yesterday"]').focus();
  await page.keyboard.press("k");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("button", { name: "Today 1", exact: true })).toHaveAttribute("aria-expanded", "true");
});

test("deselecting restores every avatar after the mouse leaves", async ({ page }) => {
  const checkbox = page.getByRole("checkbox", { name: "Select Mail today", exact: true });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await page.mouse.move(0, 0);
  await expect(checkbox).toBeFocused();
  await expect(page.locator('.row [role="checkbox"][aria-checked="true"]')).toHaveCount(0);
  await expect(page.locator(".row .lucide-check")).toHaveCount(0);
  await expect(page.locator(".row.selected")).toHaveCount(0);
  for (const avatar of await page.locator('.row [data-slot="avatar"]').all()) {
    await expect(avatar).toBeVisible();
  }
  await expect(page.locator('.row [data-slot="avatar"]')).toHaveCount(4);
});

test("avatar supports keyboard selection without opening the thread", async ({ page }) => {
  const checkbox = page.getByRole("checkbox", { name: "Select Mail today", exact: true });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await page.keyboard.press("Enter");
  await expect(checkbox).not.toBeChecked();
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
});

for (const key of ["j", "ArrowDown"]) {
  test(`${key} expands and persists the next collapsed group and opens its first thread`, async ({ page }) => {
    await page.locator('[data-thread-id="month"]').focus();
    await page.keyboard.press(key);
    await expect(page).toHaveURL(/\/october$/);
    await expect(page.getByRole("button", { name: "Oct 2026 1", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.locator('[data-thread-id="october"]')).toBeInViewport();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mailfast.list-groups") ?? "{}"))).toEqual({
      "2026-10": false,
    });
    await page.keyboard.press(key);
    await expect(page).toHaveURL(/\/september$/);
    await expect(page.getByRole("button", { name: "Sep 2026 1", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
}

test("hover and keyboard actions notch into the bottom-right corner without hiding dates", async ({ page }) => {
  const row = page.locator('[data-thread-id="today"]');
  const actions = row.locator(".row-actions");
  for (const width of [600, 500]) {
    await page.locator(".list").evaluate((element, width) => {
      element.style.width = `${width}px`;
    }, width);
    await expect(row).toHaveCSS("height", width === 600 ? "72px" : "92px");
    for (const state of ["default", "selected", "opened"]) {
      if (state === "selected") await row.getByRole("checkbox").click();
      if (state === "opened") {
        await row.getByRole("checkbox").click();
        await row.locator(".from").click();
      }
      await row.hover();
      await expect(actions).toBeVisible();
      await expect(row.locator(".date")).toBeVisible();
      const rowBox = await row.boundingBox();
      const actionsBox = await actions.boundingBox();
      if (!rowBox || !actionsBox) throw new Error("Missing row or actions box");
      expect(Math.abs(actionsBox.y + actionsBox.height - rowBox.y - rowBox.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(actionsBox.x + actionsBox.width - rowBox.x - rowBox.width)).toBeLessThanOrEqual(2);
      expect(await actions.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
      );
      expect(await actions.evaluate((element) => getComputedStyle(element, "::before").width)).toBe("12px");
      await page.mouse.move(0, 0);
      await row.focus();
      await expect(actions).toBeVisible();
      await expect(row.locator(".date")).toBeVisible();
      await actions.getByRole("button").first().focus();
      await page.keyboard.press("Tab");
      await expect(actions.getByRole("button").nth(1)).toBeFocused();
    }
    await page.keyboard.press("Escape");
  }
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
  await expect(row).toHaveCSS("height", "72px");
  await list.evaluate((element) => {
    element.style.width = "500px";
  });
  await expect(row).toHaveClass(/narrow/);
  await expect(row).toHaveCSS("height", "92px");
});

test("wide cards stack sender over subject and truncate long unread senders", async ({ page }) => {
  await page.locator(".list").evaluate((element) => {
    element.style.width = "800px";
  });
  const row = page.locator('[data-thread-id="today"]');
  await expect(row).toHaveCSS("height", "72px");
  await expect(row.locator(".from")).toHaveText("Matt (2)");
  // Hierarchy: who/when on the first line, subject and snippet share the second line.
  const layout = await row.evaluate((element) => {
    const box = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
    return { from: box(".from"), subject: box(".subject"), snippet: box(".snippet"), date: box(".date") };
  });
  expect(layout.subject.top).toBeGreaterThanOrEqual(layout.from.bottom - 1);
  expect(Math.abs(layout.subject.left - layout.from.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.snippet.top - layout.subject.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.date.top - layout.from.top)).toBeLessThanOrEqual(2);
  const longSender = page.locator('[data-thread-id="week"] .from');
  await expect(longSender).toHaveText(/\(2\)$/);
  await expect(longSender).toHaveCSS("font-weight", "600");
  await expect(longSender).toHaveCSS("text-overflow", "ellipsis");
  await page.mouse.move(0, 0);
  const rightInset = await row.evaluate((element) => {
    const date = element.querySelector(".date");
    if (!date) throw new Error("Missing date");
    return element.getBoundingClientRect().right - date.getBoundingClientRect().right;
  });
  expect(rightInset).toBeCloseTo(13, 0);
});

test("important icons sit in the right meta group in both layouts and expose a tooltip and accessible name", async ({
  page,
}) => {
  const row = page.locator('[data-thread-id="yesterday"]');
  for (const width of [800, 500]) {
    await page.locator(".list").evaluate((element, width) => {
      element.style.width = `${width}px`;
    }, width);
    await expect(row).toHaveCSS("height", width === 800 ? "72px" : "92px");
    const marker = row.getByRole("button", { name: "Marked important — click to unmark" });
    await expect(marker).toBeVisible();

    await expect(marker).toHaveText("");
    await expect(row).toHaveAccessibleName(/, important$/);
    await expect(row.locator(".row-unread-dot")).toBeVisible();
    // The tag sits in the head line, right after the sender, not in front of the subject.

    await expect(row.locator(".row-head > .row-meta > .row-important:first-child")).toHaveCount(1);
    await marker.hover();

    await expect(page.getByRole("tooltip")).toHaveText("Important");
  }

  await expect(page.locator('[data-thread-id="today"] .row-important')).toHaveCount(0);
});

for (const activation of ["click", "Enter", "Space"]) {
  test(`important marker ${activation} unmarks only its thread without navigating`, async ({ page }) => {
    const marker = page.getByRole("button", { name: "Marked important — click to unmark" });
    const request = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().includes("/api/threads/actions"),
    );
    if (activation === "click") await marker.click();
    else {
      await marker.focus();
      await page.keyboard.press(activation);
    }
    expect((await request).postDataJSON()).toEqual({ threadIds: ["yesterday"], action: { kind: "unimportant" } });
    await expect(page).toHaveURL(/\/mail\/INBOX$/);
  });
}

test("Important label hides the redundant marker but the reading pane shows its badge", async ({ page }) => {
  await page.goto("/mail/IMPORTANT");
  const row = page.locator('[data-thread-id="yesterday"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveAccessibleName(/, important$/);

  await expect(row.locator(".row-important")).toHaveCount(0);
  await row.locator(".subject").click();
  await expect(page.locator(".chips").getByText("Important", { exact: true })).toBeVisible();
  await expect(page.locator(".chips .lucide-circle-alert")).toHaveCSS("stroke", "rgb(232, 176, 75)");
});
