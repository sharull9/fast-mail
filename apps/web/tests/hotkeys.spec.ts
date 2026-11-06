import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const threads = ["first", "second"].map((id, index) => ({
    id,
    subject: `Conversation ${id}`,
    snippet: "Preview",
    senders: [{ name: "Alice", email: "alice@example.com" }],
    lastDate: Date.now() - (index + 1) * 1000,
    messageCount: 1,
    unread: true,
    starred: false,
    important: false,
    labelIds: ["INBOX", "CATEGORY_PERSONAL", "UNREAD"],
  }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/threads/actions") {
      const { threadIds, action } = route.request().postDataJSON();
      for (const thread of threads.filter((thread) => threadIds.includes(thread.id))) {
        if (action.kind === "read" || action.kind === "unread") {
          thread.unread = action.kind === "unread";
          thread.labelIds = thread.labelIds.filter((label) => label !== "UNREAD");
          if (thread.unread) thread.labelIds.push("UNREAD");
        }
      }
    }
    if (path === "/api/events") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    }
    const thread = threads.find((item) => path === `/api/threads/${item.id}`);
    const body =
      path === "/api/connection"
        ? {
            paired: true,
            server: {
              product: "mailfast",
              protocolVersion: 1,
              instanceId: "test",
              mode: "desktop",
              origin: "http://localhost:5299",
            },
          }
        : path === "/api/auth/status"
          ? { configured: true, signedIn: true, account: "me@example.com" }
          : path === "/api/status"
            ? { phase: "idle", messagesStored: 2, pendingActions: 0, backfillDone: true }
            : path === "/api/labels"
              ? [{ id: "INBOX", name: "INBOX", type: "system", unread: 0, total: 2, color: null }]
              : path === "/api/threads"
                ? { threads, hasMore: false }
                : path === "/api/search"
                  ? { threads: [], hasMore: false }
                  : thread
                    ? { thread, complete: true, messages: [] }
                    : { ok: true };
    await route.fulfill({ json: body });
  });
  await page.goto("/mail/INBOX");
  await expect(page.getByRole("row")).toHaveCount(2);
});

test("Shift+/ opens the grouped cheat sheet and Escape restores list shortcuts", async ({ page }) => {
  await page.keyboard.press("Shift+Slash");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Archive", { exact: true })).toBeVisible();
  for (const group of ["Navigation", "Actions", "Selection", "Search", "Accounts"]) {
    await expect(dialog.getByRole("heading", { name: group, exact: true })).toBeAttached();
  }
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/first/);
});

test("j/k and actions pause even on a button in the command menu", async ({ page }) => {
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/first/);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("@archive");
  await dialog.getByRole("button", { name: "Clear search" }).focus();
  for (const key of ["j", "k", "e", "#", "x"]) await page.keyboard.press(key);
  await expect(page).toHaveURL(/first/);
  await expect(page.locator("[data-thread-id]").first()).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/first/);
});

test("sidebar and action labels use the platform formatter", async ({ page }) => {
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await expect(page.getByRole("button", { name: "Search mail", exact: true }).locator("kbd")).toHaveText(
    mac ? "⌘K" : "Ctrl+K",
  );
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("@read");
  await expect(page.getByRole("option").filter({ hasText: "Mark read" }).locator("kbd")).toHaveText(
    mac ? "⇧I" : "Shift+I",
  );
});

test("Mod+F prevents browser find and selects the search query", async ({ page }) => {
  await page.evaluate(() => {
    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "f" && (event.ctrlKey || event.metaKey)) {
        document.body.dataset.findPrevented = String(event.defaultPrevented);
      }
    });
  });
  await page.keyboard.press("ControlOrMeta+f");
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("alice");
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator("body")).toHaveAttribute("data-find-prevented", "true");
  await expect(input).toBeFocused();
  expect(await input.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe(5);
});

test("account menu and command menu both offer the cheat sheet", async ({ page }) => {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("@shortcuts");
  await page.getByRole("option", { name: /Keyboard shortcuts/ }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("question mark pauses while typing and account dropdown suspends list navigation", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
});

test("shifted action chords and physical # preserve targeting and advance", async ({ page }) => {
  await page.getByRole("row").first().focus();
  for (const [key, kind] of [
    ["Shift+KeyI", "read"],
    ["Shift+KeyU", "unread"],
    ["s", "star"],
    ["Shift+Digit3", "trash"],
  ]) {
    await test.step(key, async () => {
      const request = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/threads/actions", {
        timeout: 5000,
      });
      await page.keyboard.press(key);
      expect((await request).postDataJSON()).toEqual({ threadIds: ["first"], action: { kind } });
    });
  }
  await expect(page).toHaveURL(/second/);
});
