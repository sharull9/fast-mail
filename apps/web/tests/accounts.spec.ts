import { expect, test, type Page } from "@playwright/test";
import type { MailAccount, ThreadRow } from "@mailfast/shared";

async function mockAccounts(page: Page, image: string | null = null) {
  let accounts: MailAccount[] = [
    { id: "personal", email: "personal@example.com", name: "Personal", image, unread: 3 },
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
    else if (path === "/api/avatar") body = { google: null, gravatar: null };
    else if (path === "/api/chat/spaces") body = { spaces: [] };
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

const photoImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const googlePhoto = "https://photos.example.com/profile.png";
const gravatarPhoto = "https://www.gravatar.com/avatar/fixture?d=404";

test("signed-in Google photos appear in the account button and account menu", async ({ page }) => {
  await mockAccounts(page, googlePhoto);
  await page.route(googlePhoto, (route) => route.fulfill({ contentType: "image/png", body: photoImage }));
  await page.goto("/mail/INBOX");
  const account = page.getByRole("button", { name: "Account menu" });
  await expect(account.locator("img")).toHaveAttribute("src", googlePhoto);
  await account.click();
  const personal = page.getByRole("menuitem", { name: "personal@example.com, active", exact: true });
  await expect(personal.locator("img")).toHaveAttribute("src", googlePhoto);
});

for (const fallback of ["google", "gravatar", "initials"] as const) {
  test(`account and received mail avatars fall back through Google, Gravatar and initials: ${fallback}`, async ({
    page,
  }) => {
    await mockAccounts(page, fallback === "gravatar" ? googlePhoto : null);
    const requests: string[] = [];
    await page.route("**/api/avatar?**", async (route) => {
      expect(route.request().headers()["x-mailfast-account"]).toBe("personal");
      await route.fulfill({ json: { google: googlePhoto, gravatar: gravatarPhoto } });
    });
    await page.route(googlePhoto, async (route) => {
      requests.push("google");
      await route.fulfill(fallback === "google" ? { contentType: "image/png", body: photoImage } : { status: 404 });
    });
    await page.route(gravatarPhoto, async (route) => {
      requests.push("gravatar");
      await route.fulfill(fallback === "gravatar" ? { contentType: "image/png", body: photoImage } : { status: 404 });
    });
    await page.goto("/mail/INBOX");
    await expect(page.getByText("Personal message", { exact: true })).toBeVisible();
    const account = page.getByRole("button", { name: "Account menu" });
    const sender = page.locator('[data-thread-id="same-id"] [data-slot="avatar"]');
    if (fallback === "initials") {
      await expect.poll(() => requests.includes("gravatar")).toBe(true);
      await expect(account.locator('[data-slot="avatar-fallback"]')).toHaveText("P");
      await expect(sender.locator('[data-slot="avatar-fallback"]')).toHaveText("S");
      await expect(account.locator("img")).toHaveCount(0);
      await expect(sender.locator("img")).toHaveCount(0);
    } else {
      const expected = fallback === "google" ? googlePhoto : gravatarPhoto;
      await expect(account.locator("img")).toHaveAttribute("src", expected);
      await expect(sender.locator("img")).toHaveAttribute("src", expected);
    }
    if (fallback === "google") expect(requests).not.toContain("gravatar");
  });
}
