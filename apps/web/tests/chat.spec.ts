import { expect, test, type Page } from "@playwright/test";
import type { ChatMessage, ChatSpace } from "@mailfast/shared";

const spaces: ChatSpace[] = [
  { id: "spaces/team", name: "Design Team", type: "SPACE", unreadCount: 0 },
  { id: "spaces/dm", name: "Alice", type: "DIRECT_MESSAGE", unreadCount: 0 },
  { id: "spaces/group", name: "Group conversation", type: "GROUP_CHAT", unreadCount: 0 },
];
const meetingUri = "https://meet.google.com/abc-defg-hij";

async function mockChat(page: Page, meetError = false) {
  const messages: ChatMessage[] = spaces.map((space) => ({
    id: `${space.id}/messages/root`,
    spaceId: space.id,
    sender: { name: "users/alice", displayName: "Alice" },
    createTime: Date.now(),
    text: "Can we review this?",
    threadId: `${space.id}/threads/root`,
  }));
  const sent: Array<{ spaceId: string; text: string; threadId?: string }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
        body = { phase: "idle", messagesStored: 0, pendingActions: 0, backfillDone: true };
        break;
      case "/api/events":
        await route.fulfill({ contentType: "text/event-stream", body: "" });
        return;
      case "/api/labels":
      case "/api/contacts":
        body = [];
        break;
      case "/api/chat/spaces":
        body = { spaces, apiStatus: { connected: true } };
        break;
      case "/api/chat/messages":
        if (request.method() === "POST") {
          const input = request.postDataJSON();
          sent.push(input);
          const message: ChatMessage = {
            ...input,
            id: `${input.spaceId}/messages/${sent.length}`,
            sender: { name: "users/me", displayName: "You", isSelf: true },
            createTime: Date.now(),
          };
          messages.push(message);
          body = message;
        } else {
          body = { messages: messages.filter((message) => message.spaceId === url.searchParams.get("spaceId")) };
        }
        break;
      case "/api/chat/meet":
        await route.fulfill({
          status: meetError ? 502 : 200,
          json: meetError ? { error: "Reconnect your Google account to allow Meet access." } : { meetingUri },
        });
        return;
      case "/api/account/settings":
        body = {};
        break;
      default:
        throw new Error(`Unexpected API request: ${url.pathname}`);
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?space=spaces%2Fteam");
  await expect(page.getByRole("combobox", { name: "Message Design Team" })).toBeVisible();
  return sent;
}

for (const selection of ["click", "keyboard"]) {
  test(`Meet slash command can be selected by ${selection} and inserts a link before sending`, async ({ page }) => {
    const sent = await mockChat(page);
    const composer = page.getByRole("combobox", { name: "Message Design Team" });
    await composer.fill("/");
    const commands = page.getByRole("listbox", { name: "Chat commands" });
    await expect(commands.getByRole("option")).toHaveCount(1);
    await expect(commands.getByRole("option")).toContainText("Send a Meet link");
    await composer.press("Escape");
    await expect(commands).toHaveCount(0);
    await expect(composer).toHaveValue("/");
    await composer.fill("/drive");
    await expect(commands).toHaveCount(0);
    await composer.fill("https://example.com/");
    await expect(commands).toHaveCount(0);
    await composer.fill("Let's meet /me");
    if (selection === "click") await commands.getByRole("option").click();
    else await composer.press("Enter");
    await expect(composer).toHaveValue(`Let's meet ${meetingUri} `);
    expect(sent).toHaveLength(0);
    await composer.press("Enter");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ spaceId: "spaces/team", text: `Let's meet ${meetingUri}` });
    await expect(page.getByText("Join video meeting", { exact: true })).toBeVisible();
  });
}

test("Meet errors preserve the draft and explain how to recover", async ({ page }) => {
  const sent = await mockChat(page, true);
  const composer = page.getByRole("combobox", { name: "Message Design Team" });
  await composer.fill("/meet");
  await composer.press("Tab");
  await expect(page.getByRole("alert")).toHaveText("Reconnect your Google account to allow Meet access.");
  await expect(composer).toHaveValue("/meet");
  await expect(composer).toBeEnabled();
  await expect(composer).toBeFocused();
  expect(sent).toHaveLength(0);
});

test("thread reply appears on hover in spaces and is removed when switching conversations", async ({ page }) => {
  const sent = await mockChat(page);
  const message = page.locator('[id="chat-msg-spaces_team_messages_root"]');
  const reply = message.getByRole("button", { name: "Reply in thread", exact: true });
  const toolbar = reply.locator("../..");
  await expect(page.getByTitle("View thread replies")).toHaveCount(0);
  await page.getByRole("combobox").hover();
  await expect(toolbar).toHaveCSS("opacity", "0");
  await reply.focus();
  await expect(toolbar).toHaveCSS("opacity", "1");
  await page.getByRole("combobox").focus();
  await message.hover();
  await expect(toolbar).toHaveCSS("opacity", "1");
  await reply.click();
  await page.getByPlaceholder("Reply in thread...").fill("Looks good");
  await page.getByPlaceholder("Reply in thread...").press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ spaceId: "spaces/team", text: "Looks good", threadId: "spaces/team/threads/root" });
  await page.getByRole("button", { name: /Alice/ }).click();
  await expect(page.getByRole("combobox", { name: "Message Alice" })).toBeVisible();
  await expect(page.getByPlaceholder("Reply in thread...")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reply in thread", exact: true })).toHaveCount(0);
  await page.locator('[id="chat-msg-spaces_dm_messages_root"]').hover();
  await page.getByRole("button", { name: "Quote in reply", exact: true }).click();
  await expect(page.getByText("Replying to Alice:", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Group conversation/ }).click();
  await expect(page.getByRole("combobox", { name: "Message Group conversation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply in thread", exact: true })).toHaveCount(0);
});
