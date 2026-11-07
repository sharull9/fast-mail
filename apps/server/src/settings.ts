import type { MailStore } from "@mailfast/db";
import {
  accountSettingsSchema,
  contactImportSchema,
  contactPageSchema,
  contactVisibilitySchema,
  saveContactSchema,
} from "@mailfast/shared";
import type { Events } from "@/events.ts";

export async function handleSettingsRequest(
  req: Request,
  { store, events }: { store: MailStore; events: Events },
): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/settings/")) return null;
  const path = url.pathname.slice("/api/settings/".length);
  if (!["account", "contacts", "contacts/import"].includes(path))
    return Response.json({ error: "Not found" }, { status: 404 });
  const invalid = (error: string) => Response.json({ error }, { status: 400 });
  if (path === "account" && req.method === "GET") return Response.json(store.accountSettings());
  if (path === "contacts" && req.method === "GET") {
    const parsed = contactPageSchema.safeParse(Object.fromEntries(url.searchParams));
    return parsed.success
      ? Response.json(store.listContacts(parsed.data))
      : invalid(parsed.error.issues[0]?.message ?? "Invalid search");
  }
  if (path === "account" && req.method === "PUT") {
    const parsed = accountSettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid account details");
    store.saveAccountSettings(parsed.data);
    events.send({ type: "account-settings-changed" });
    return Response.json(store.accountSettings());
  }
  if (path === "contacts" && req.method === "POST") {
    const parsed = saveContactSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid contact");
    const saved = store.saveContact(parsed.data);
    events.send({ type: "contacts-changed" });
    return Response.json(saved);
  }
  if (path === "contacts" && req.method === "PATCH") {
    const parsed = contactVisibilitySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid contact");
    const existing = store.db.query.contacts
      .findFirst({ where: (contacts, { eq }) => eq(contacts.email, parsed.data.email) })
      .sync();
    if (!existing) return Response.json({ error: "Contact not found" }, { status: 404 });
    store.setContactHidden(parsed.data.email, parsed.data.hidden);
    events.send({ type: "contacts-changed" });
    return Response.json({ ok: true });
  }
  if (path === "contacts/import" && req.method === "POST") {
    const parsed = contactImportSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid contacts");
    const imported = store.importContacts(parsed.data.contacts);
    events.send({ type: "contacts-changed" });
    return Response.json({ imported });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
