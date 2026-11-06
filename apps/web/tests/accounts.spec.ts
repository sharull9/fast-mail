import { expect, test, type Page } from "@playwright/test";
import type { MailAccount, ThreadRow } from "@mailfast/shared";

async function mockAccounts(page: Page) {
  let accounts: MailAccount[] = [
    { id: "personal", email: "personal@example.com", name: "Personal", image: null, unread: 3 },
    { id: "work", email: "work@example.com", name: "Work", image: null, unread: 7 },
  ];
  let active = "personal";
  const requests: { path: string; account: string | undefined }[] = [];
  const logouts: string[] = [];
  const status = () => ({
    configured: true,
    signedIn: accounts.length > 0,
    account: accounts.find((a) => a.id === active)?.email ?? null,
    accounts,
    activeAccountId: active,
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const account = req.headers()["x-mailfast-account"];
    requests.push({ path, account });
    let body: unknown;
    if (path === "/api/connection")
      body = {
        paired: true,
        server: {
          product: "mailfast",
          protocolVersion: 1,
          instanceId: "test",
          mode: "desktop",
          origin: "http://localhost:5299",
        },
      };
    else if (path === "/api/auth/status") body = status();
    else if (path === "/api/accounts/active") {
      active = req.postDataJSON().id;
      body = status();
    } else if (/^\/api\/accounts\/[^/]+\/logout$/.test(path)) {
      const id = path.split("/")[3]!;
      logouts.push(id);
      accounts = accounts.filter((a) => a.id !== id);
      if (id === active) active = accounts[0]?.id ?? "";
      body = status();
    } else if (path === "/api/events") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    } else if (path === "/api/status")
      body = {
        phase: "idle",
        account: `${account}@example.com`,
        messagesStored: 1,
        backfillDone: true,
        lastSyncAt: null,
        pendingActions: 0,
        error: null,
      };
    else if (path === "/api/labels")
      body = [{ id: "INBOX", name: "INBOX", type: "system", color: null, unread: 3, total: 1 }];
    else if (path === "/api/threads" || path === "/api/threads/same-id") {
      const thread: ThreadRow = {
        id: "same-id",
        subject: `${account === "work" ? "Work" : "Personal"} message`,
        snippet: "Account-specific mail",
        senders: [{ name: "Sender", email: "sender@example.com" }],
        lastDate: Date.now(),
        messageCount: 1,
        unread: false,
        starred: false,
        important: false,
        labelIds: ["INBOX"],
      };
      body = path === "/api/threads" ? { threads: [thread], hasMore: false } : { thread, messages: [], complete: true };
    } else if (path === "/api/prefetch" || path === "/api/sync") body = { ok: true };
    else if (path === "/api/search") body = { threads: [], hasMore: false };
    else throw new Error(`Unexpected request ${path}`);
    await route.fulfill({ json: body });
  });
  return { requests, logouts };
}

test("account menu lists accounts, unread counts and active check; switching isolates cached mail", async ({
  page,
}) => {
  const { requests } = await mockAccounts(page);
  await page.goto("/mail/INBOX");
  await expect(page.getByText("Personal message", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Account menu" }).click();
  const personal = page.getByRole("menuitem", { name: "personal@example.com, active", exact: true });
  await expect(personal).toBeVisible();
  await expect(personal.getByLabel("Active account")).toBeVisible();
  await expect(personal.getByLabel("3 unread")).toBeVisible();
  const work = page.getByRole("menuitem", { name: "work@example.com", exact: true });
  await expect(work.getByLabel("7 unread")).toBeVisible();
  await work.click();
  await expect(page.getByText("Work message", { exact: true })).toBeVisible();
  await expect(page.getByText("Personal message", { exact: true })).toHaveCount(0);
  expect(requests.some((r) => r.path === "/api/threads" && r.account === "work")).toBe(true);
  expect(requests.some((r) => r.path === "/api/events" && r.account === "work")).toBe(true);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "personal@example.com", exact: true }).click();
  await expect(page.getByText("Personal message", { exact: true })).toBeVisible();
  await expect(page.getByText("Work message", { exact: true })).toHaveCount(0);
});

test("Ctrl+2 switches to the second account and ignores typing", async ({ page }) => {
  await mockAccounts(page);
  await page.goto("/mail/INBOX");
  await expect(page.getByText("Personal message", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Work message", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Search mail", exact: true }).click();
  await page.locator("[cmdk-input]").focus();
  await page.keyboard.press("Control+1");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("work@example.com");
});

test("sign out of the active email uses the per-account endpoint and retains the other mailbox", async ({ page }) => {
  const { logouts } = await mockAccounts(page);
  await page.goto("/mail/INBOX");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out of personal@example.com", exact: true }).click();
  await expect(page.getByText("Work message", { exact: true })).toBeVisible();
  expect(logouts).toEqual(["personal"]);
});
