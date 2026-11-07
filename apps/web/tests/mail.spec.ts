import { expect, test, type Page } from "@playwright/test";
import { belongsInMailbox, type ThreadRow } from "@mailfast/shared";

// Recent timestamps keep fixtures in the expanded "Today" group (older months start collapsed).
const NOW = Date.now();

const threads: ThreadRow[] = [
  {
    id: "primary",
    subject: "Invoice for November",
    snippet: "\u034f Your\u200b invoice \u3164 is\u2060 ready \ufeff",
    senders: [{ name: "Alice", email: "alice@example.com" }],
    lastDate: NOW - 1_000,
    messageCount: 1,
    unread: false,
    starred: false,
    important: false,
    labelIds: ["INBOX", "CATEGORY_PERSONAL"],
  },
  {
    id: "social",
    subject: "Your network update",
    snippet: "New connections",
    senders: [{ name: "LinkedIn", email: "news@linkedin.com" }],
    lastDate: NOW - 2_000,
    messageCount: 1,
    unread: false,
    starred: false,
    important: false,
    labelIds: ["INBOX", "CATEGORY_SOCIAL"],
  },
  {
    id: "updates",
    subject: "Package shipped",
    snippet: "On its way",
    senders: [{ name: "Shop", email: "shop@example.com" }],
    lastDate: NOW - 3_000,
    messageCount: 1,
    unread: false,
    starred: false,
    important: false,
    labelIds: ["INBOX", "CATEGORY_UPDATES"],
  },
];

async function mockMail(
  page: Page,
  options: {
    authGate?: Promise<void>;
    paired?: boolean;
    configured?: boolean;
    signedIn?: boolean;
    invalidPairingCode?: boolean;
    unauthorized?: boolean;
  } = {},
) {
  const searches: string[] = [];
  const actions: unknown[] = [];
  const eventConnections: string[] = [];
  const connectionOrder: string[] = [];
  const requests: string[] = [];
  const pairingExchanges: { body: unknown; header: string | undefined; url: string }[] = [];
  const pairingGrants: unknown[] = [];
  let paired = options.paired ?? true;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    let body: unknown;
    switch (url.pathname) {
      case "/api/connection":
        connectionOrder.push("connection");
        body = {
          server: {
            product: "mailfast",
            protocolVersion: 1,
            instanceId: "test-server",
            mode: "desktop",
            origin: "http://localhost:5299",
          },
          paired,
        };
        break;
      case "/api/auth/status":
        connectionOrder.push("auth-request");
        if (options.unauthorized) {
          paired = false;
          await route.fulfill({ status: 401, json: { error: "Browser session expired." } });
          return;
        }
        await options.authGate;
        connectionOrder.push("auth-resolved");
        body = {
          configured: options.configured ?? true,
          signedIn: options.signedIn ?? true,
          account: options.signedIn === false ? null : "me@example.com",
        };
        break;
      case "/api/session":
        if (route.request().method() === "DELETE") {
          paired = false;
          await route.fulfill({ status: 204 });
          return;
        }
        pairingExchanges.push({
          body: route.request().postDataJSON(),
          header: route.request().headers()["x-mailfast-ui"],
          url: page.url(),
        });
        if (options.invalidPairingCode) {
          await route.fulfill({ status: 400, json: { error: "That pairing code is invalid or expired." } });
          return;
        }
        paired = true;
        await route.fulfill({ status: 204 });
        return;
      case "/api/pairing-grants":
        pairingGrants.push(route.request().postDataJSON());
        body = {
          code: "0123456789abcdef0123456789abcdef",
          expiresAt: (await page.evaluate(() => Date.now())) + 5 * 60_000,
          url: "http://localhost:5299/#pair=0123456789abcdef0123456789abcdef",
        };
        break;
      case "/api/status":
        body = { phase: "idle", messagesStored: 3, pendingActions: 0, backfillDone: true };
        break;
      case "/api/events":
        connectionOrder.push("events");
        eventConnections.push("connected");
        await route.fulfill({ contentType: "text/event-stream", body: "" });
        return;
      case "/api/labels":
        body = ["INBOX", "STARRED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH"].map((id) => ({
          id,
          name: id,
          type: "system",
          unread: 0,
          total: 3,
          color: null,
        }));
        break;
      case "/api/threads":
        body = {
          threads: threads.filter((thread) =>
            belongsInMailbox(url.searchParams.get("label") ?? "INBOX", thread.labelIds),
          ),
          hasMore: false,
        };
        break;
      case "/api/search": {
        const query = url.searchParams.get("q") ?? "";
        searches.push(query);
        body = { threads: query.includes("alice") ? [threads[0]] : [], hasMore: false };
        break;
      }
      case "/api/threads/actions":
        actions.push(route.request().postDataJSON());
        body = { ok: true };
        break;
      case "/api/browser-sessions":
        body = [
          {
            id: "session-1",
            createdAt: Date.now() - 60_000,
            lastSeenAt: Date.now(),
            origin: "http://localhost:5199",
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            current: true,
          },
        ];
        break;
      case "/api/prefetch":
      case "/api/sync":
        body = { ok: true };
        break;
      default: {
        const thread = threads.find((thread) => url.pathname === `/api/threads/${thread.id}`);
        if (!thread) throw new Error(`Unexpected API request: ${url.pathname}`);
        body = {
          thread,
          complete: true,
          messages: [
            {
              id: `message-${thread.id}`,
              threadId: thread.id,
              date: thread.lastDate,
              from: thread.senders[0],
              to: "me@example.com",
              cc: "team@example.com",
              subject: thread.subject,
              snippet: thread.snippet,
              labelIds: thread.labelIds,
              unread: thread.unread,
              starred: thread.starred,
            },
          ],
        };
      }
    }
    await route.fulfill({ json: body });
  });
  return { searches, actions, eventConnections, connectionOrder, requests, pairingExchanges, pairingGrants };
}

test("mocked auth status resolves before the SSE connection starts", async ({ page }) => {
  let releaseAuth!: () => void;
  const authGate = new Promise<void>((resolve) => {
    releaseAuth = resolve;
  });
  const { eventConnections, connectionOrder } = await mockMail(page, { authGate });
  await page.goto("/mail/INBOX");
  releaseAuth();
  await expect(page.getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Inbox/ })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => eventConnections.length).toBeGreaterThan(0);
  expect(connectionOrder.indexOf("connection")).toBeLessThan(connectionOrder.indexOf("auth-request"));
  expect(connectionOrder.indexOf("auth-resolved")).toBeLessThan(connectionOrder.indexOf("events"));
});

test("unpaired browsers see pairing first and make no account API requests", async ({ page }) => {
  const { requests } = await mockMail(page, { paired: false });
  await page.goto("/mail/INBOX");
  await expect(page.getByText("Pair this browser", { exact: true })).toBeVisible();
  await expect(page.getByText("Mailfast desktop")).toBeVisible();
  expect(requests).toEqual(["/api/connection"]);
});

test("incoming pairing fragments are stripped before the one-time exchange", async ({ page }) => {
  const { pairingExchanges } = await mockMail(page, { paired: false });
  await page.goto("/#pair=PAIR-123");
  await expect(page.getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await expect.poll(() => pairingExchanges).toHaveLength(1);
  expect(pairingExchanges[0]).toEqual({
    body: { code: "PAIR-123" },
    header: "1",
    url: "http://localhost:5299/mail/INBOX",
  });
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
});

test("invalid pairing codes show an error without checking account status", async ({ page }) => {
  const { requests } = await mockMail(page, { paired: false, invalidPairingCode: true });
  await page.goto("/mail/INBOX");
  await page.getByLabel("Pairing code").fill("BAD-CODE");
  await page.getByRole("button", { name: "Pair browser", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  expect(requests).not.toContain("/api/auth/status");
});

test("Google setup is shown only after a successful pairing", async ({ page }) => {
  const { requests, pairingExchanges } = await mockMail(page, {
    paired: false,
    configured: false,
    signedIn: false,
  });
  await page.goto("/mail/INBOX");
  await expect(page.getByText("Pair this browser", { exact: true })).toBeVisible();
  expect(requests).not.toContain("/api/auth/status");
  await page.getByLabel("Pairing code").fill("PAIR-123");
  await page.getByRole("button", { name: "Pair browser", exact: true }).click();
  await expect(page.getByText("1. Connect a Google OAuth client")).toBeVisible();
  expect(pairingExchanges).toHaveLength(1);
  expect(requests).toContain("/api/auth/status");
});

test("401 invalidates the pairing gate instead of retrying protected requests", async ({ page }) => {
  const { requests } = await mockMail(page, { unauthorized: true });
  await page.goto("/mail/INBOX");
  await expect(page.getByText("Pair this browser", { exact: true })).toBeVisible();
  expect(requests.filter((path) => path === "/api/auth/status")).toHaveLength(1);
});

test("@pair issues a one-use grant and offers copy feedback", async ({ page }) => {
  const { pairingGrants } = await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await page.getByRole("button", { name: "Search mail", exact: true }).click();
  await page.getByRole("combobox").fill("@pair");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Create pairing code" }).click();
  await expect(page.getByText("0123456789abcdef0123456789abcdef")).toBeVisible();
  expect(pairingGrants).toEqual([{}]);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("button", { name: "Code copied" })).toBeVisible();
});

test("pair browser dialog shows connected list in browser and allows only itself to disconnect", async ({ page }) => {
  const { requests } = await mockMail(page);
  await page.route("**/api/browser-sessions", async (route) => {
    await route.fulfill({
      status: 200,
      json: [
        {
          id: "session-current",
          createdAt: Date.now() - 60_000,
          lastSeenAt: Date.now(),
          origin: "http://localhost:5199",
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          current: true,
        },
        {
          id: "session-other",
          createdAt: Date.now() - 120_000,
          lastSeenAt: Date.now() - 60_000,
          origin: "http://localhost:5199",
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        },
      ],
    });
  });

  await page.goto("/mail/INBOX");
  await page.getByRole("button", { name: "Search mail", exact: true }).click();
  await page.getByRole("combobox").fill("@pair");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();

  // Connected list is shown
  await expect(page.getByText("Paired browsers")).toBeVisible();
  await expect(page.getByText("Chrome on Windows")).toBeVisible();
  await expect(page.getByText("Safari on macOS")).toBeVisible();
  await expect(page.getByText("This browser", { exact: true })).toBeVisible();

  // Only itself can be disconnected
  const disconnectButtons = page.getByRole("button", { name: "Disconnect" });
  await expect(disconnectButtons).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);

  // Disconnecting disconnects this browser
  await disconnectButtons.click();
  await expect(page.getByText("Pair this browser", { exact: true })).toBeVisible();
  expect(requests).toContain("/api/session");
});

test("disconnect browser revokes only the browser session", async ({ page }) => {
  const { requests } = await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await page.getByRole("button", { name: "Search mail", exact: true }).click();
  await page.getByRole("combobox").fill("@disconnect");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Pair this browser", { exact: true })).toBeVisible();
  expect(requests).toContain("/api/session");
  expect(requests).not.toContain("/api/auth/logout");
});

test("Ctrl+F selects search; sender search and clearing reset the view", async ({ page }) => {
  const { searches } = await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await page.keyboard.press("Control+f");
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("@user:alice invoice");
  await expect(page.getByRole("option", { name: /Invoice for November/ })).toBeVisible();
  expect(searches).toContain("@user:alice invoice");
  await page.keyboard.press("Control+f");
  expect(await input.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe(
    "@user:alice invoice".length,
  );
  await page.getByRole("option", { name: /Show all mail results/ }).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page).toHaveURL(/\/mail\/INBOX$/);

  await page.keyboard.press("Control+f");
  await input.fill("@user:alice invoice");
  await page.getByRole("option", { name: /Show all mail results/ }).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await page.keyboard.press("Control+f");
  await expect(input).toHaveValue("@user:alice invoice");
  await input.fill("");
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await expect(page.getByRole("option", { name: /Invoice for November/ })).toHaveCount(0);

  await page.keyboard.press("Control+f");
  await input.fill("@user:alice invoice");
  await page.getByRole("option", { name: /Show all mail results/ }).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await page.keyboard.press("Control+f");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await expect(input).toHaveValue("");
  await expect(page.getByRole("option", { name: /Invoice for November/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("inbox tabs, @ commands, and persistent icon sidebar", async ({ page }) => {
  const { searches } = await mockMail(page);
  await page.goto("/mail/INBOX");
  await page.getByRole("tab", { name: "Social", exact: true }).click();
  await expect(page).toHaveURL(/INBOX_SOCIAL$/);
  await expect(page.locator(".row")).toHaveCount(1);
  await expect(page.locator(".row")).toContainText("network update");
  await page.getByRole("tab", { name: "Primary", exact: true }).click();
  await expect(page.locator(".row")).toContainText("Invoice for November");
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
  const searchButton = page.getByRole("button", { name: "Search mail", exact: true });
  await searchButton.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(searchButton).toBeFocused();

  await searchButton.click();
  await page.getByRole("combobox").fill("@updates");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/INBOX_UPDATES$/);
  await expect(page.locator(".row")).toContainText("Package shipped");
  expect(searches).toEqual([]);
  await expect(searchButton).toBeFocused();
  await page.screenshot({ path: "test-results/mail-desktop.png" });
});

test("command actions target the open thread; dialog traps focus on mobile", async ({ page }) => {
  const { actions } = await mockMail(page);
  await page.goto("/mail/INBOX/primary");
  await expect(page.getByRole("heading", { name: "Invoice for November" })).toBeVisible();
  await page.keyboard.press("Control+f");
  await page.getByRole("combobox").fill("@archive");
  await page.keyboard.press("Enter");
  await expect.poll(() => actions).toContainEqual({ threadIds: ["primary"], action: { kind: "archive" } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Control+f");
  await page.getByRole("combobox").fill("@user:alice");
  await expect(page.getByRole("option", { name: /Invoice for November/ })).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mail-mobile-search.png" });
});

test("avatar checkbox and shift click select a range and bulk actions target it", async ({ page }) => {
  const { actions } = await mockMail(page);
  await page.goto("/mail/INBOX");
  await page.getByRole("checkbox", { name: "Select Invoice for November", exact: true }).click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Package shipped", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select all", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Archive", exact: true }).first().click();
  await expect
    .poll(() => actions)
    .toContainEqual({ threadIds: ["primary", "social", "updates"], action: { kind: "archive" } });
  await expect(page.getByText("3 selected", { exact: true })).toHaveCount(0);
});

test("right click opens a custom row menu and respects multi selection", async ({ page }) => {
  const { actions } = await mockMail(page);
  await page.goto("/mail/INBOX");
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await page.locator(".row").first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menu").getByText("3 conversations", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: /Archive/ }).click();
  await expect
    .poll(() => actions)
    .toContainEqual({ threadIds: ["primary", "social", "updates"], action: { kind: "archive" } });
});

test("pairing code wraps inside its box on a narrow screen", async ({ page }) => {
  await mockMail(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mail/INBOX");
  await expect(page.getByRole("tablist", { name: "Inbox categories" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("@pair");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Create pairing code" }).click();
  const code = page.locator('code[aria-label="Pairing code"]');
  await expect(code).toHaveText("0123456789abcdef0123456789abcdef");
  expect(await code.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("timer")).toContainText("remaining");
});

test("selection shortcuts clear selection before closing the pane and reset on navigation", async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX/primary");
  await expect(page.getByRole("heading", { name: "Invoice for November" })).toBeVisible();
  await page.keyboard.press("x");
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("1 selected", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invoice for November" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/mail\/INBOX$/);
  await page.keyboard.press("Control+a");
  await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Inbox categories" })).toHaveCount(0);
  await page.getByRole("radio", { name: /^Starred/ }).click();
  await expect(page.getByText("3 selected", { exact: true })).toHaveCount(0);
});

test("right clicking outside a selection targets only that conversation", async ({ page }) => {
  const { actions } = await mockMail(page);
  await page.goto("/mail/INBOX");
  await page.getByRole("checkbox", { name: "Select Invoice for November", exact: true }).click();
  await page.locator('[data-thread-id="social"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: /Archive/ }).click();
  await expect.poll(() => actions).toContainEqual({ threadIds: ["social"], action: { kind: "archive" } });
});

test("global context menus open search with selected text and offer editable actions", async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX");
  const heading = page.getByText("No conversation selected", { exact: true });
  await heading.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await heading.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Search mail for “No conversation selected”" }).click();
  const input = page.getByRole("combobox");
  await expect(input).toHaveValue("No conversation selected");
  await expect(input).toBeFocused();
  await input.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Cut", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Select all", exact: true })).toBeVisible();
});

test("expired pairing codes offer regeneration", async ({ page }) => {
  await mockMail(page);
  await page.clock.install();
  await page.goto("/mail/INBOX");
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Pair another browser…" }).click();
  await page.getByRole("button", { name: "Create pairing code" }).click();
  await expect(page.locator('code[aria-label="Pairing code"]')).toBeVisible();
  await page.clock.fastForward(301_000);
  await expect(page.getByRole("timer")).toHaveText("Code expired");
  await expect(page.getByRole("button", { name: "Copy code" })).toBeDisabled();
  await page.getByRole("button", { name: "Create new code" }).click();
  await expect(page.getByRole("timer")).toContainText("remaining");
});

test("previews clean invisible padding and search highlights matching terms", async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.locator('[data-thread-id="primary"] .snippet')).toHaveText("Your invoice is ready");
  await page.locator('[data-thread-id="primary"]').click();
  await expect(page.locator(".pane section")).toContainText("Your invoice is ready");
  // The header summarises recipients; the full addresses live in the expandable details card.
  await page.locator(".pane section").getByRole("button", { name: /^to / }).click();
  await expect(page.locator(".pane section dl")).toContainText("me@example.com");
  await expect(page.locator(".pane section dl")).toContainText("team@example.com");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("@user:alice invoice");
  const result = page.getByRole("option", { name: /Invoice for November/ });
  await expect(result.locator("mark")).toHaveCount(2);
  await expect(result).toContainText("Your invoice is ready");
});

test("plain row clicks set a range anchor and ctrl clicks toggle without opening", async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX");
  await page.locator('[data-thread-id="primary"]').click();
  await expect(page).toHaveURL(/INBOX\/primary$/);
  await page.locator('[data-thread-id="updates"]').click({ modifiers: ["Shift"] });
  await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
  await page.locator('[data-thread-id="social"]').click({ modifiers: ["Control"] });
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/INBOX\/primary$/);
  await page.locator('[data-thread-id="primary"]').click({ button: "right" });
  await expect(page.getByRole("menu").getByText("2 conversations", { exact: true })).toBeVisible();
});
