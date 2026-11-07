import { mailExportRequestSchema, type MailImportResult } from "@mailfast/shared";
import type { Gmail } from "@/gmail.ts";
import { Priority } from "@/limiter.ts";

export const MAX_MAIL_FILE_BYTES = 25 * 1024 * 1024;
// mboxrd uses one extra '>' before every body line matching >*From.
const ENVELOPE = /^From \S+ (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [^\r\n]+\r?\n/gm;

export function parseMailFile(bytes: Uint8Array, format: "eml" | "mbox"): Buffer[] {
  if (!bytes.length || bytes.length > MAX_MAIL_FILE_BYTES) throw new Error("Choose a nonempty file up to 25 MB.");
  // Latin-1 keeps every byte intact, including legacy MIME encodings.
  const text = Buffer.from(bytes).toString("latin1");
  let messages: string[];
  if (format === "eml") messages = [text];
  else {
    const separators = [...text.matchAll(ENVELOPE)];
    if (!separators.length || separators[0]?.index !== 0) throw new Error("Invalid MBOX envelope.");
    messages = separators.map((match, i) => {
      const part = text.slice(match.index + match[0].length, separators[i + 1]?.index);
      // Remove only the record separator added by the MBOX writer.
      return part.replace(/\r?\n$/, "").replace(/^>(>*From )/gm, "$1");
    });
  }
  if (messages.length > 500) throw new Error("Import up to 500 messages per file.");
  return messages.map((message) => {
    const headerEnd = message.search(/\r?\n\r?\n/);
    if (headerEnd < 0 || !/^[\w-]+:[^\r\n]*/m.test(message.slice(0, headerEnd))) {
      throw new Error("Invalid email: expected MIME headers and a blank line before the body.");
    }
    return Buffer.from(message, "latin1");
  });
}

export function toMboxRecord(raw: Uint8Array): Buffer {
  const escaped = Buffer.from(raw)
    .toString("latin1")
    .replace(/^(>*From )/gm, ">$1");
  return Buffer.from(`From mailfast@localhost Thu Jan  1 00:00:00 1970\r\n${escaped}\r\n`, "latin1");
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

export async function importMail(
  req: Request,
  gmail: Pick<Gmail, "importMessage">,
  synced: (id: string) => Promise<void>,
) {
  const format = new URL(req.url).searchParams.get("format");
  if (format !== "eml" && format !== "mbox") return json({ error: "Choose an EML or MBOX file." }, 400);
  // Read with a limit even when Content-Length is absent or incorrect.
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body ?? []) {
    size += chunk.length;
    if (size > MAX_MAIL_FILE_BYTES) return json({ error: "File exceeds 25 MB." }, 413);
    chunks.push(chunk);
  }
  let messages: Buffer[];
  try {
    messages = parseMailFile(Buffer.concat(chunks), format);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid mail file" }, 400);
  }
  const result: MailImportResult = { imported: 0, total: messages.length, failed: [] };
  const threads = new Set<string>();
  for (const [index, raw] of messages.entries()) {
    try {
      const message = await gmail.importMessage(raw.toString("base64url"));
      result.imported++;
      threads.add(message.threadId);
    } catch (error) {
      result.failed.push({ index: index + 1, error: error instanceof Error ? error.message : "Import failed" });
    }
  }
  for (const id of threads) await synced(id).catch(() => undefined);
  return json(result);
}

export async function exportMail(req: Request, gmail: Pick<Gmail, "rawMessage" | "thread">) {
  const parsed = mailExportRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Select a message or up to 500 conversations." }, 400);
  const selection = parsed.data;
  const ids = new Set<string>();
  if ("messageId" in selection) ids.add(selection.messageId);
  else {
    for (const threadId of new Set(selection.threadIds)) {
      const messages = await gmail.thread(threadId, Priority.Interactive);
      for (const message of messages) ids.add(message.id);
    }
  }
  if (!ids.size) return json({ error: "No messages to export." }, 404);
  if (ids.size > 500) return json({ error: "Export up to 500 messages at a time. Select fewer conversations." }, 413);
  const eml = "messageId" in selection;
  const records: Buffer[] = [];
  let size = 0;
  for (const id of ids) {
    const { raw } = await gmail.rawMessage(id);
    const bytes = Buffer.from(raw, "base64url");
    const record = eml ? bytes : toMboxRecord(bytes);
    size += record.length;
    if (size > MAX_MAIL_FILE_BYTES) return json({ error: "Export exceeds 25 MB. Select fewer conversations." }, 413);
    records.push(record);
  }
  return new Response(Buffer.concat(records), {
    headers: {
      "content-type": eml ? "message/rfc822" : "application/mbox",
      "content-disposition": `attachment; filename="mailfast.${eml ? "eml" : "mbox"}"`,
      "cache-control": "no-store",
    },
  });
}
