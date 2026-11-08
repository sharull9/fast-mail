import { expect, test } from "bun:test";
import {
  decodeEntities,
  extractBodyAndAttachments,
  parseAddress,
  parseBatchResponse,
  toMessageInput,
} from "@/gmail.ts";
import { Limiter, Priority } from "@/limiter.ts";

test("parses batch responses", () => {
  const b = "batch_abc";
  const text = [
    `--${b}\r\nContent-Type: application/http\r\nContent-ID: <response-m1>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":"m1","threadId":"t1"}\r\n`,
    `--${b}\r\nContent-Type: application/http\r\nContent-ID: <response-m2>\r\n\r\nHTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\r\n{"error":{}}\r\n`,
    `--${b}--`,
  ].join("");
  const r = parseBatchResponse(text, b);
  expect(r.get("m1")).toEqual({ status: 200, body: '{"id":"m1","threadId":"t1"}' });
  expect(r.get("m2")?.status).toBe(404);
});

test("parses addresses and snippets", () => {
  expect(parseAddress('"Doe, Jane" <jane@x.com>')).toEqual({ name: "Doe, Jane", email: "jane@x.com" });
  expect(parseAddress("bob@x.com")).toEqual({ name: "", email: "bob@x.com" });
  expect(decodeEntities("it&#39;s &amp; &lt;b&gt; &#x1F600;")).toBe("it's & <b> 😀");
  const m = toMessageInput({
    id: "m",
    threadId: "t",
    internalDate: "1700000000000",
    labelIds: ["INBOX"],
    snippet: "hi",
    payload: {
      headers: [
        { name: "From", value: "Al <al@x.com>" },
        { name: "Subject", value: "Yo" },
      ],
    },
  });
  expect(m).toMatchObject({ fromName: "Al", fromEmail: "al@x.com", subject: "Yo", date: 1700000000000 });
  expect(m.bodyHtml).toBeNull();
  expect(m.bodyText).toBeNull();
});

test("extracts message bodies and attachments from full payload", () => {
  const htmlEncoded = Buffer.from("<p>Hello <b>World</b></p>").toString("base64url");
  const textEncoded = Buffer.from("Hello World").toString("base64url");
  const m = toMessageInput({
    id: "m_full",
    threadId: "t_full",
    internalDate: "1700000000000",
    labelIds: ["INBOX"],
    snippet: "Hello World",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "Bob <bob@x.com>" },
        { name: "To", value: "alice@x.com" },
        { name: "Subject", value: "Test" },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: textEncoded, size: 11 },
            },
            {
              mimeType: "text/html",
              body: { data: htmlEncoded, size: 26 },
            },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "statement.pdf",
          body: { attachmentId: "att_123", size: 4096 },
        },
      ],
    },
  });

  expect(m.bodyHtml).toBe("<p>Hello <b>World</b></p>");
  expect(m.bodyText).toBe("Hello World");
  expect(m.attachments).toEqual([
    { id: "att_123", filename: "statement.pdf", mimeType: "application/pdf", size: 4096 },
  ]);
});

test("limiter serves interactive work before background", async () => {
  const l = new Limiter(1000, 10);
  await l.acquire(10, Priority.Background); // drain the bucket
  const order: string[] = [];
  const bg = l.acquire(5, Priority.Background).then(() => order.push("bg"));
  const ui = l.acquire(5, Priority.Interactive).then(() => order.push("ui"));
  await Promise.all([bg, ui]);
  expect(order).toEqual(["ui", "bg"]);
});

test("builds MIME message without attachments", () => {
  const { buildMimeMessage, htmlToPlainText } = require("@/gmail.ts");
  const raw = buildMimeMessage({
    to: ["alice@example.com"],
    cc: ["bob@example.com"],
    subject: "Meeting Tomorrow",
    bodyHtml: "<p>Hi Alice,<br>Let's meet at 10.</p>",
  });

  expect(raw).toContain("Subject: Meeting Tomorrow");
  expect(raw).toContain("To: alice@example.com");
  expect(raw).toContain("Cc: bob@example.com");
  expect(raw).toContain("Content-Type: multipart/alternative");
  expect(raw).toContain("Content-Type: text/plain");
  expect(raw).toContain("Content-Type: text/html");

  expect(htmlToPlainText("<p>Hello<br>World</p>")).toBe("Hello\nWorld");
});

test("builds MIME message with attachments and utf-8 subject", () => {
  const { buildMimeMessage } = require("@/gmail.ts");
  const raw = buildMimeMessage({
    to: ["recipient@example.com"],
    subject: "Héllo World 🚀",
    bodyHtml: "<p>Check the attached note</p>",
    attachments: [
      {
        filename: "test.txt",
        mimeType: "text/plain",
        content: Buffer.from("Hello attachment").toString("base64"),
      },
    ],
  });

  expect(raw).toContain("=?UTF-8?B?");
  expect(raw).toContain("Content-Type: multipart/mixed");
  expect(raw).toContain('Content-Disposition: attachment; filename="test.txt"');
});

test("extracts inline image part with Content-ID marked inline with contentId", () => {
  const htmlBody = Buffer.from('<p>Hello <img src="cid:img_hero@domain.com"></p>').toString("base64url");
  const extracted = extractBodyAndAttachments({
    mimeType: "multipart/related",
    parts: [
      {
        mimeType: "text/html",
        body: { data: htmlBody, size: htmlBody.length },
      },
      {
        mimeType: "image/png",
        filename: "hero.png",
        headers: [
          { name: "Content-Type", value: 'image/png; name="hero.png"' },
          { name: "Content-ID", value: "<img_hero@domain.com>" },
          { name: "Content-Disposition", value: 'inline; filename="hero.png"' },
        ],
        body: { attachmentId: "att_hero_123", size: 8192 },
      },
    ],
  });

  expect(extracted.bodyHtml).toBe('<p>Hello <img src="cid:img_hero@domain.com"></p>');
  expect(extracted.attachments).toEqual([
    {
      id: "att_hero_123",
      filename: "hero.png",
      mimeType: "image/png",
      size: 8192,
      contentId: "img_hero@domain.com",
      inline: true,
    },
  ]);
});

test("substitutes cid image with inline body.data as a data URI directly into HTML", () => {
  const imgData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const htmlBody = Buffer.from('<p>Hero: <img src="cid:qr_logo_123"></p>').toString("base64url");
  const extracted = extractBodyAndAttachments({
    mimeType: "multipart/related",
    parts: [
      {
        mimeType: "text/html",
        body: { data: htmlBody, size: htmlBody.length },
      },
      {
        mimeType: "image/png",
        headers: [
          { name: "Content-ID", value: "<qr_logo_123>" },
          { name: "Content-Disposition", value: "inline" },
        ],
        body: { data: imgData, size: imgData.length },
      },
    ],
  });

  expect(extracted.bodyHtml).toBe(`<p>Hero: <img src="data:image/png;base64,${imgData}"></p>`);
  expect(extracted.attachments).toEqual([]);
});

test("leaves normal attachments unaffected and not marked inline", () => {
  const textBody = Buffer.from("Please find attached statement").toString("base64url");
  const extracted = extractBodyAndAttachments({
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "text/plain",
        body: { data: textBody, size: textBody.length },
      },
      {
        mimeType: "application/pdf",
        filename: "statement.pdf",
        headers: [{ name: "Content-Disposition", value: 'attachment; filename="statement.pdf"' }],
        body: { attachmentId: "att_pdf_456", size: 65536 },
      },
    ],
  });

  expect(extracted.bodyText).toBe("Please find attached statement");
  expect(extracted.attachments).toEqual([
    {
      id: "att_pdf_456",
      filename: "statement.pdf",
      mimeType: "application/pdf",
      size: 65536,
    },
  ]);
  expect(extracted.attachments[0]?.inline).toBeFalsy();
  expect(extracted.attachments[0]?.contentId).toBeUndefined();
});

test("renders additional text/html parts as isolated blocks", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const { bodyHtml } = extractBodyAndAttachments({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/html", body: { data: b64("<style>body{line-height:0}</style><table></table>") } },
      { mimeType: "text/html", body: { data: b64("Line one\n\nLine two") } },
    ],
  });
  expect(bodyHtml).toContain("<table></table>");
  expect(bodyHtml).toContain(
    '<div style="line-height:normal;font-size:14px;margin-top:12px;white-space:pre-wrap;">Line one\n\nLine two</div>',
  );
});
