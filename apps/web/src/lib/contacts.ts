import { contactImportSchema, type Contact } from "@mailfast/shared";
import { api } from "@/lib/api";
const samples = new Set([
  "sarah.connor@cyberdyne.com",
  "john.connnor@resistance.org",
  "john.connor@resistance.org",
  "kyle.reese@resistance.org",
  "alex.chen@mailfast.io",
  "elena.rostova@techcorp.com",
  "david.kim@designstudio.io",
  "sophia.m@globalenterprise.com",
  "support@hikvision.com",
]);
export async function migrateLocalContacts(accountId: string) {
  const marker = "mailfast.contacts-migrated";
  if (localStorage.getItem(marker)) return;
  const raw = localStorage.getItem("mailfast.local-contacts");
  if (!raw) return;
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value))
    throw new Error("Saved recommendations could not be read. Your original data has been kept.");
  const contacts: Contact[] = [];
  for (const item of value) {
    const parsed = contactImportSchema.shape.contacts.element.safeParse(item);
    if (parsed.success && !samples.has(parsed.data.email)) contacts.push(parsed.data);
  }
  for (let i = 0; i < contacts.length; i += 100) await api.importContacts(contacts.slice(i, i + 100), accountId);
  localStorage.setItem(marker, accountId);
}
