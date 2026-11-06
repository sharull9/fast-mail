import { expect, test, type Page } from "@playwright/test";

async function mockMail(page: Page) {
  const syncRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    switch (path) {
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
        body = { phase: "idle", messagesStored: 1709, pendingActions: 0, backfillDone: true };
        break;
      case "/api/events":
        await route.fulfill({ contentType: "text/event-stream", body: "" });
        return;
      case "/api/labels":
        body = [];
        break;
      case "/api/threads":
        body = { threads: [], hasMore: false };
        break;
      case "/api/sync":
        syncRequests.push(route.request().method());
        body = { ok: true };
        break;
      case "/api/prefetch":
        body = { ok: true };
        break;
      default:
        throw new Error(`Unexpected API request: ${path}`);
    }
    await route.fulfill({ json: body });
  });
  return { syncRequests };
}

const sidebar = '[data-slot="sidebar"][data-state]';
const container = '[data-slot="sidebar-container"]';

async function dragRail(page: Page, delta: number) {
  const rail = page.getByRole("button", { name: "Resize sidebar", exact: true });
  const bounds = await rail.boundingBox();
  if (!bounds) throw new Error("Sidebar rail is not visible");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 12 });
  await page.mouse.up();
}

test("dragging changes and persists sidebar width, with limits and reset", async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.locator(container)).toHaveCSS("width", "256px");
  await dragRail(page, 64);
  await expect(page.locator(container)).toHaveCSS("width", "320px");
  expect(await page.evaluate(() => localStorage.getItem("mailfast.sidebar-width"))).toBe("320");
  await page.reload();
  await expect(page.locator(container)).toHaveCSS("width", "320px");
  await dragRail(page, 100);
  await expect(page.locator(container)).toHaveCSS("width", "360px");
  await dragRail(page, -180);
  await expect(page.locator(container)).toHaveCSS("width", "200px");
  await page.getByRole("button", { name: "Resize sidebar", exact: true }).dblclick();
  await expect(page.locator(container)).toHaveCSS("width", "256px");
});

test("dragging below the threshold collapses and outward dragging restores expanded width", async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.locator(sidebar)).toHaveAttribute("data-state", "expanded");
  await dragRail(page, 64);
  await expect(page.locator(container)).toHaveCSS("width", "320px");
  await dragRail(page, -180);
  await expect(page.locator(sidebar)).toHaveAttribute("data-state", "collapsed");
  await expect(page.locator(container)).toHaveCSS("width", "48px");
  expect(await page.evaluate(() => localStorage.getItem("mailfast.sidebar-width"))).toBe("320");
  await expect(page.getByText("1,709 messages cached")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(sidebar)).toHaveAttribute("data-state", "collapsed");
  await dragRail(page, 140);
  await expect(page.locator(sidebar)).toHaveAttribute("data-state", "expanded");
  await expect(page.locator(container)).toHaveCSS("width", "320px");
  await page.getByRole("button", { name: "Resize sidebar", exact: true }).click();
  await expect(page.locator(sidebar)).toHaveAttribute("data-state", "collapsed");
});

test("Sync now calls the sync endpoint", async ({ page }) => {
  const { syncRequests } = await mockMail(page);
  await page.goto("/mail/INBOX");
  await expect(page.getByText("1,709 messages cached")).toBeVisible();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => syncRequests).toEqual(["POST"]);
});

test("collapsed search matches the navigation icons and opens the command menu", async ({ page }) => {
  await mockMail(page);
  await page.goto("/mail/INBOX");
  const search = page.getByRole("button", { name: "Search mail", exact: true });
  await expect(search).toHaveCSS("border-top-width", "1px");
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.locator(container)).toHaveCSS("width", "48px");
  await expect(search).toHaveCSS("width", "32px");
  await expect(search).toHaveCSS("height", "32px");
  await expect(search).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const inboxIcon = page.getByRole("link", { name: "Inbox", exact: true }).locator("svg");
  const inboxBounds = await inboxIcon.boundingBox();
  if (!inboxBounds) throw new Error("Inbox icon is not visible");
  const inboxCenter = inboxBounds.x + inboxBounds.width / 2;
  for (const control of [
    search,
    page.getByRole("button", { name: "Account menu", exact: true }),
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ]) {
    const bounds = await control.boundingBox();
    if (!bounds) throw new Error("Sidebar control is not visible");
    expect(Math.abs(bounds.x + bounds.width / 2 - inboxCenter)).toBeLessThanOrEqual(1);
  }
  expect(
    await search.evaluate((element) => {
      const style = getComputedStyle(element);
      return ["Top", "Right", "Bottom", "Left"].every((side) => {
        const width = style.getPropertyValue(`border-${side.toLowerCase()}-width`);
        const color = style.getPropertyValue(`border-${side.toLowerCase()}-color`);
        return parseFloat(width) === 0 || color === "transparent" || color === "rgba(0, 0, 0, 0)";
      });
    }),
  ).toBe(true);
  await search.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Search mail (Ctrl K)");
  await search.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
