import type { AttachmentMeta } from "@mailfast/shared";
import { getActiveAccountId, getAttachmentUrl } from "@/lib/api";

/**
 * Rewrites cid: references in HTML (e.g. src="cid:...", background="cid:...", url(cid:...))
 * to the Mailfast attachment endpoint for the corresponding attachment.
 */
export function rewriteCidUrls(html: string, messageId: string, attachments?: AttachmentMeta[]): string {
  if (!html || !attachments || attachments.length === 0) return html;

  const cidMap = new Map<string, AttachmentMeta>();
  for (const att of attachments) {
    if (att.contentId && att.id) {
      const clean = att.contentId.trim().replace(/^<|>$/g, "");
      cidMap.set(clean, att);
      cidMap.set(clean.toLowerCase(), att);
      try {
        const decoded = decodeURIComponent(clean);
        cidMap.set(decoded, att);
        cidMap.set(decoded.toLowerCase(), att);
      } catch {}
    }
  }

  if (cidMap.size === 0) return html;

  return html.replace(/cid:(?:<([^>]+)>|([^"'\s)>]+))/gi, (match, angleCid?: string, bareCid?: string) => {
    let raw = (angleCid ?? bareCid ?? "").trim();
    let suffix = "";
    for (const ent of ["&quot;", "&#39;", "&apos;", "&gt;"]) {
      if (raw.endsWith(ent)) {
        raw = raw.slice(0, -ent.length);
        suffix = ent + suffix;
      }
    }
    const clean = raw.replace(/^<|>$/g, "");
    let att = cidMap.get(clean) ?? cidMap.get(clean.toLowerCase());
    if (!att) {
      try {
        const decoded = decodeURIComponent(clean);
        att = cidMap.get(decoded) ?? cidMap.get(decoded.toLowerCase());
      } catch {}
    }

    if (att && att.id) {
      const url = getAttachmentUrl(messageId, att.id, att.filename, att.mimeType);
      const account = getActiveAccountId();
      const withAccount = account
        ? `${url}${url.includes("?") ? "&" : "?"}account=${encodeURIComponent(account)}`
        : url;
      return withAccount + suffix;
    }
    return match;
  });
}
