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
