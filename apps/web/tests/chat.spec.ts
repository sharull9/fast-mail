import { expect, test, type Page } from "@playwright/test";
import type { ChatMessage, ChatSpace } from "@mailfast/shared";

const photo = "https://photos.example.com/alice.png";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

async function mockChat(page: Page) {
  const space: ChatSpace = {
    id: "spaces/team",
    name: "Alice",
    type: "DIRECT_MESSAGE",
    avatarUrl: photo,
    unreadCount: 0,
  };
  const messages: ChatMessage[] = [
    {
      id: `${space.id}/messages/1`,
      spaceId: space.id,
      sender: { name: "users/alice", displayName: "Alice", email: "alice@example.com", avatarUrl: photo },
      createTime: Date.now() - 2000,
      text: "Hello from Alice",
      threadId: "spaces/team/threads/1",
      threadReplyCount: 1,
    },
    {
      id: `${space.id}/messages/2`,
      spaceId: space.id,
      sender: { name: "users/bob", displayName: "Bob", email: "bob@example.com", avatarUrl: photo },
      createTime: Date.now() - 1000,
      text: "Hello from Bob",
      threadId: "spaces/team/threads/1",
    },
  ];
  const sent: unknown[] = [];
  await page.route("https://photos.example.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: image }),
  );
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let body: unknown;
    if (path === "/api/connection") body = { paired: true, server: { mode: "desktop", instanceId: "test" } };
    else if (path === "/api/avatar") body = { google: null, gravatar: null };
    else if (path === "/api/auth/status") {
      body = {
        configured: true,
        signedIn: true,
        activeAccountId: "me",
        account: "me@example.com",
        accounts: [{ id: "me", email: "me@example.com", name: "Me", image: photo, unread: 0 }],
      };
    } else if (path === "/api/events") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    } else if (path === "/api/labels") body = [];
    else if (path === "/api/status") body = { phase: "idle", messagesStored: 0, pendingActions: 0, backfillDone: true };
    else if (path === "/api/chat/spaces") body = { spaces: [space], apiStatus: { connected: true } };
    else if (path === "/api/chat/messages" && req.method() === "POST") {
      sent.push(req.postDataJSON());
      body = { ...messages[0], id: `${space.id}/messages/sent`, text: req.postDataJSON().text };
    } else if (path === "/api/chat/messages") body = { messages };
    else if (path === "/api/contacts") body = [];
    else if (path === "/api/threads") body = { threads: [], hasMore: false };
    else throw new Error(`Unexpected request ${path}`);
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?space=spaces%2Fteam");
  await expect(page.getByText("Hello from Alice", { exact: true })).toBeVisible();
  return { sent };
}

test("mention menu supports arrows, Enter, Tab and Escape without sending", async ({ page }) => {
  const { sent } = await mockChat(page);
  const composer = page.getByPlaceholder("Message Alice...");
  await composer.fill("@");
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue("@Bob ");
  expect(sent).toEqual([]);

  await composer.fill("@");
  await composer.press("ArrowUp");
  await composer.press("ArrowDown");
  await composer.press("Tab");
  await expect(composer).toHaveValue("@Alice ");
  await expect(composer).toBeFocused();
  expect(sent).toEqual([]);

  await composer.fill("@Ali");
  await composer.press("Escape");
  await expect(page.getByText("Mention Member", { exact: true })).toBeHidden();
  await expect(composer).toHaveValue("@Ali");
});

test("mention selection resets when filtering and preserves text after the caret", async ({ page }) => {
  const { sent } = await mockChat(page);
  const composer = page.getByPlaceholder("Message Alice...");
  await composer.fill("@");
  await composer.press("ArrowDown");
  await composer.press("l");
  await composer.press("Enter");
  await expect(composer).toHaveValue("@Alice ");
  expect(sent).toEqual([]);

  await composer.fill("Hi @Ali suffix");
  await composer.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 7));
  await composer.press("c");
  await page.getByRole("option", { name: "Alice alice@example.com", exact: true }).click();
  await expect(composer).toHaveValue("Hi @Alice  suffix");
  await expect(composer).toBeFocused();
  expect(await composer.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(10);
});

test("direct message list and header show the available profile photo", async ({ page }) => {
  await mockChat(page);
  const conversation = page.getByRole("button", { name: "Alice", exact: true });
  await expect(conversation.locator('[data-slot="avatar-image"]')).toBeVisible();
  await expect(
    page.locator("header").filter({ hasText: "1-on-1 direct message" }).locator('[data-slot="avatar-image"]'),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("chat.png") });
});

test("thread parent and replies show their sender photos", async ({ page }) => {
  await mockChat(page);
  await page.getByTitle("View thread replies").first().click();
  const thread = page
    .locator("div")
    .filter({ has: page.getByText("Thread", { exact: true }) })
    .filter({ has: page.getByPlaceholder("Reply in thread...") })
    .last();
  await expect(thread.locator('[data-slot="avatar-image"]')).toHaveCount(2);
});

test("Shift+Enter adds a newline and Enter sends normally after dismissing mentions", async ({ page }) => {
  const { sent } = await mockChat(page);
  const composer = page.getByPlaceholder("Message Alice...");
  await composer.fill("Hi");
  await composer.press("Shift+Enter");
  await composer.press("@");
  await composer.press("Escape");
  await expect(composer).toHaveValue("Hi\n@");
  await composer.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ text: "Hi\n@" });
});
