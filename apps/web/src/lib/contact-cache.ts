import { contactImportSchema, type Contact } from "@mailfast/shared";
const key = (accountId: string) => `mailfast.contacts.${accountId}`;
export function cachedContacts(accountId: string | null): Contact[] {
  if (!accountId) return [];
  try {
    const parsed = contactImportSchema.safeParse(JSON.parse(localStorage.getItem(key(accountId)) ?? "null"));
    return parsed.success ? parsed.data.contacts : [];
  } catch {
    return [];
  }
}
export function cacheContacts(accountId: string | null, values: Contact[], query: string) {
  if (!accountId) return;
  const q = query.toLowerCase();
  const old = cachedContacts(accountId).filter((value) => !`${value.name} ${value.email}`.toLowerCase().includes(q));
  const contacts = [...new Map([...old, ...values].map((value) => [value.email, value])).values()].slice(-100);
  try {
    localStorage.setItem(key(accountId), JSON.stringify({ contacts }));
  } catch {
    /* Offline caching is optional. */
  }
}
export function clearContactCache(accountId: string | null) {
  if (accountId) {
    try {
      localStorage.removeItem(key(accountId));
    } catch {
      /* Storage may be disabled. */
    }
  }
  window.dispatchEvent(new CustomEvent("mailfast:contacts-changed", { detail: accountId }));
}
