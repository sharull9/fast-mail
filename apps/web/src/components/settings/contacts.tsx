import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, X } from "lucide-react";
import { saveContactSchema, type ManagedContact } from "@mailfast/shared";
import { api } from "@/lib/api";
import { authQuery } from "@/lib/data";
import { migrateLocalContacts } from "@/lib/contacts";
import { invalidateContactSuggestions } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ContactList({ accountId }: { accountId: string }) {
  const [search, setSearch] = useState("");
  const [hidden, setHidden] = useState(false);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<{ email: string; name: string; originalEmail?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [migrationError, setMigrationError] = useState("");
  const [migrationRetry, setMigrationRetry] = useState(0);
  const query = useQuery({
    queryKey: ["managed-contacts", accountId, search, hidden, offset],
    queryFn: () => api.managedContacts({ q: search, hidden, offset, limit: 50 }, accountId),
  });
  useEffect(() => {
    let current = true;
    void migrateLocalContacts(accountId)
      .then(() => {
        if (current) {
          setMigrationError("");
          invalidateContactSuggestions(accountId);
        }
      })
      .catch((error: unknown) => {
        if (current)
          setMigrationError(error instanceof Error ? error.message : "Could not import saved recommendations.");
      });
    return () => {
      current = false;
    };
  }, [accountId, migrationRetry]);
  async function visibility(contact: ManagedContact) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.setContactHidden(contact.email, !contact.hidden, accountId);
      invalidateContactSuggestions(accountId);
      setMessage(
        contact.hidden ? "Recommendation restored." : "Recommendation removed. It will stay hidden during mail sync.",
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update this recommendation.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
          These addresses appear when you add recipients or mention someone in a message. Mailfast extracts them from
          your mail. You can also add them yourself.
        </p>
        <Button
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={() => {
            setEditing({ email: "", name: "" });
            setError("");
            setMessage("");
          }}
        >
          <Plus className="size-4" />
          Add contact
        </Button>
      </div>
      {migrationError && (
        <div role="alert" className="mb-4 text-sm text-destructive">
          <p>{migrationError} Your original browser data is preserved.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setMigrationRetry((n) => n + 1)}>
            Retry import
          </Button>
        </div>
      )}
      {editing && (
        <form
          className="mb-6 grid gap-4 rounded-lg border bg-card p-5"
          aria-label={editing.originalEmail ? "Edit contact" : "Add contact"}
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = saveContactSchema.safeParse(editing);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
              return;
            }
            setBusy(true);
            setError("");
            setMessage("");
            void api
              .saveContact(parsed.data, accountId)
              .then(() => {
                setEditing(null);
                setMessage("Contact saved. It is now available in recipient recommendations.");
                invalidateContactSuggestions(accountId);
              })
              .catch((error: unknown) =>
                setError(error instanceof Error ? error.message : "Could not save this contact."),
              )
              .finally(() => setBusy(false));
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{editing.originalEmail ? "Edit contact" : "Add contact"}</h3>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Cancel contact editing"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setError("");
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              Name <span className="sr-only">optional</span>
              <Input
                value={editing.name}
                maxLength={200}
                placeholder="Optional"
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>
            <label className="grid gap-2 text-sm">
              Email
              <Input
                type="email"
                required
                maxLength={254}
                value={editing.email}
                placeholder="name@example.com"
                onChange={(event) => setEditing({ ...editing, email: event.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save contact"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Search contacts"
            value={search}
            maxLength={254}
            placeholder="Search by name or email"
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => {
              setHidden(event.target.checked);
              setOffset(0);
            }}
          />
          Show removed
        </label>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {query.isPending ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          Loading recommendations…
        </p>
      ) : query.error ? (
        <div role="alert" className="py-6">
          <p className="text-sm text-destructive">{query.error.message}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : !query.data?.contacts.length ? (
        <div className="border-t py-12 text-center">
          <h3 className="text-sm font-medium">
            {search ? "No matching contacts" : hidden ? "No removed recommendations" : "No recommendations yet"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {search
              ? "Try a different name or address."
              : hidden
                ? "Removed addresses will appear here so you can restore them."
                : "Add a contact above, or let Mailfast find addresses as your mail syncs."}
          </p>
        </div>
      ) : (
        <ul className="divide-y border-y" aria-label="Contact recommendations">
          {query.data.contacts.map((contact) => (
            <li key={contact.email} className="flex flex-wrap items-center gap-3 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{contact.name || contact.email}</p>
                {contact.name && (
                  <p className="truncate text-xs text-muted-foreground" title={contact.email}>
                    {contact.email}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                {!hidden && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Edit ${contact.email}`}
                    onClick={() => {
                      setEditing({ email: contact.email, name: contact.name, originalEmail: contact.email });
                      setError("");
                      setMessage("");
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`${hidden ? "Restore" : "Remove"} ${contact.email}`}
                  onClick={() => void visibility(contact)}
                >
                  {hidden ? "Restore" : "Remove"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(offset > 0 || (query.data?.nextOffset !== null && query.data?.nextOffset !== undefined)) && (
        <div className="mt-4 flex justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={!offset || query.isFetching}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous page
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={query.data?.nextOffset == null || query.isFetching}
            onClick={() => setOffset(query.data?.nextOffset ?? offset)}
          >
            Next page
          </Button>
        </div>
      )}
    </div>
  );
}
export function ContactsSettings() {
  const accountId = useQuery(authQuery).data?.activeAccountId;
  return accountId ? <ContactList key={accountId} accountId={accountId} /> : null;
}
