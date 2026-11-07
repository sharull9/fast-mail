import { expect, test } from "bun:test";
import { decodeEntities, parseAddress, parseBatchResponse, toMessageInput } from "@/gmail.ts";
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
