import { expect, test } from "bun:test";
import { rewriteCidUrls } from "@/lib/cid";
import type { AttachmentMeta } from "@mailfast/shared";

test("rewriteCidUrls rewrites src, background, and url() cid references", () => {
  const attachments: AttachmentMeta[] = [
    {
      id: "att_hero_123",
      filename: "hero.png",
      mimeType: "image/png",
      size: 1024,
      contentId: "hero_logo@domain.com",
      inline: true,
    },
    {
      id: "att_bg_456",
      filename: "background.jpg",
      mimeType: "image/jpeg",
      size: 2048,
      contentId: "bg_pattern",
      inline: true,
    },
  ];

  const html = [
    '<p><img src="cid:hero_logo@domain.com" alt="Hero"></p>',
    '<p><img src="cid:<hero_logo@domain.com>" alt="Angle Hero"></p>',
    '<table background="cid:bg_pattern"><tr><td>Content</td></tr></table>',
    '<div style="background-image: url(cid:bg_pattern)">Div1</div>',
    "<div style=\"background-image: url('cid:bg_pattern')\">Div2</div>",
    '<div style="background-image: url(&quot;cid:bg_pattern&quot;)">Div3</div>',
    '<img src="cid:unmatched@domain.com">',
  ].join("\n");

  const rewritten = rewriteCidUrls(html, "msg_test_001", attachments);

  expect(rewritten).toContain(
    'src="/api/messages/msg_test_001/attachments/att_hero_123?filename=hero.png&mimeType=image%2Fpng" alt="Hero"',
  );
  expect(rewritten).toContain(
    'src="/api/messages/msg_test_001/attachments/att_hero_123?filename=hero.png&mimeType=image%2Fpng" alt="Angle Hero"',
  );
  expect(rewritten).toContain(
    'background="/api/messages/msg_test_001/attachments/att_bg_456?filename=background.jpg&mimeType=image%2Fjpeg"',
  );
  expect(rewritten).toContain(
    "url(/api/messages/msg_test_001/attachments/att_bg_456?filename=background.jpg&mimeType=image%2Fjpeg)",
  );
  expect(rewritten).toContain(
    "url('/api/messages/msg_test_001/attachments/att_bg_456?filename=background.jpg&mimeType=image%2Fjpeg')",
  );
  expect(rewritten).toContain(
    "url(&quot;/api/messages/msg_test_001/attachments/att_bg_456?filename=background.jpg&mimeType=image%2Fjpeg&quot;)",
  );
  expect(rewritten).toContain('<img src="cid:unmatched@domain.com">');
});

test("rewriteCidUrls handles empty html or attachments gracefully", () => {
  expect(rewriteCidUrls("", "msg_1")).toBe("");
  expect(rewriteCidUrls("<p>Test</p>", "msg_1", [])).toBe("<p>Test</p>");
  expect(rewriteCidUrls("<p>Test</p>", "msg_1", undefined)).toBe("<p>Test</p>");
});
