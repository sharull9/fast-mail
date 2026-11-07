export function withSignature(bodyHtml: string, signature: string): string {
  if (!signature) return bodyHtml;
  const escaped = signature
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br>");
  return `${bodyHtml}<p><br></p><p>${escaped}</p>`;
}
