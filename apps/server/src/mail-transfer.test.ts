import { expect, test, spyOn } from "bun:test";
import { Gmail } from "@/gmail.ts";
import { exportMail, importMail, parseMailFile, toMboxRecord, MAX_MAIL_FILE_BYTES } from "@/mail-transfer.ts";

const source = Buffer.from(
  "From: Alice <alice@example.com>\r\nTo: bob@example.com\r\nSubject: Archive\r\n" +
    'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="part"\r\n\r\n' +
    "--part\r\nContent-Type: text/plain\r\n\r\nFrom a body line\r\n>From quoted\r\n" +
    "--part\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n" +
    'Content-Disposition: attachment; filename="test.bin"\r\n\r\nAAEC/w==\r\n--part--\r\n',
);

test("EML and MBOX preserve MIME attachments, From lines, and legacy bytes", () => {
  const legacy = Buffer.concat([Buffer.from("Subject: Legacy\n\n"), Buffer.from([0xe9, 0xff, 0x0d])]);
  expect(parseMailFile(source, "eml")).toEqual([source]);
  expect(parseMailFile(Buffer.concat([toMboxRecord(source), toMboxRecord(legacy)]), "mbox")).toEqual([source, legacy]);
  expect(toMboxRecord(source).toString()).toContain(">>From quoted");
});

test("invalid files and excessive message counts are rejected before importing", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("not an email"), Buffer.alloc(MAX_MAIL_FILE_BYTES + 1)]) {
    expect(() => parseMailFile(bytes, "eml")).toThrow();
  }
  expect(() => parseMailFile(source, "mbox")).toThrow("envelope");
  expect(() => parseMailFile(Buffer.concat(Array.from({ length: 501 }, () => toMboxRecord(source))), "mbox")).toThrow(
    "500",
  );
});

test("import reports partial success and syncs only successful messages", async () => {
  let calls = 0;
  const synced: string[] = [];
  const res = await importMail(
    new Request("http://localhost/api/mail/import?format=mbox", {
      method: "POST",
      body: Buffer.concat([toMboxRecord(source), toMboxRecord(source)]),
    }),
    {
      async importMessage(raw) {
        expect(Buffer.from(raw, "base64url")).toEqual(source);
        if (++calls === 2) throw new Error("Gmail unavailable");
        return { id: "m1", threadId: "t1" };
      },
    },
    async (id) => {
      synced.push(id);
    },
  );
  expect(await res.json()).toEqual({ imported: 1, total: 2, failed: [{ index: 2, error: "Gmail unavailable" }] });
  expect(synced).toEqual(["t1"]);
  let touched = false;
  const invalid = await importMail(
    new Request("http://localhost/?format=eml", { method: "POST", body: "bad" }),
    {
      async importMessage() {
        touched = true;
        return { id: "", threadId: "" };
      },
    },
    async () => {},
  );
  expect(invalid.status).toBe(400);
  expect(touched).toBe(false);
});

test("exports original source as EML and deduplicates messages in selected threads", async () => {
  const request = (selection: unknown) =>
    new Request("http://localhost/api/mail/export", {
      method: "POST",
      body: JSON.stringify(selection),
    });
  const gmail = {
    async rawMessage(id: string) {
      expect(id).toBe("m1");
      return { raw: source.toString("base64url") };
    },
  };
  const eml = await exportMail(request({ messageId: "m1" }), { ...gmail, thread: async () => [] });
  expect(eml.headers.get("content-type")).toBe("message/rfc822");
  expect(Buffer.from(await eml.arrayBuffer())).toEqual(source);
  const mbox = await exportMail(request({ threadIds: ["t1", "t1"] }), {
    ...gmail,
    thread: async () => [
      {
        id: "m1",
        threadId: "t1",
        date: 0,
        fromName: "",
        fromEmail: "",
        to: "",
        cc: "",
        subject: "",
        snippet: "",
        labelIds: [],
      },
    ],
  });
  expect(parseMailFile(new Uint8Array(await mbox.arrayBuffer()), "mbox")).toEqual([source]);
  expect((await exportMail(request({ threadIds: [] }), { ...gmail, thread: async () => [] })).status).toBe(400);
});

test("Gmail imports raw MIME without sending it and exports using format=raw", async () => {
  const calls: { url: string; body: unknown }[] = [];
  let fail = false;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = input instanceof Request ? input.url : input.toString();
        calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        if (fail) return new Response("Uncertain server failure", { status: 500 });
        return Response.json(
          url.includes("/import") ? { id: "m1", threadId: "t1" } : { raw: source.toString("base64url") },
        );
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const gmail = new Gmail({ token: async () => "test-token", invalidate() {} });
    await gmail.importMessage(source.toString("base64url"));
    expect(calls[0]).toEqual({
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/import?internalDateSource=dateHeader",
      body: { raw: source.toString("base64url") },
    });
    expect(await gmail.rawMessage("m1")).toEqual({ raw: source.toString("base64url") });
    expect(calls[1]?.url).toEndWith("/messages/m1?format=raw&fields=raw");
    fail = true;
    let failure: unknown;
    try {
      await gmail.importMessage(source.toString("base64url"));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error && failure.message).toContain("500");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    fetchMock.mockRestore();
  }
});
