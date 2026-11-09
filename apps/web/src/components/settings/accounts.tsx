import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { accountSettingsSchema, type MailAccount } from "@mailfast/shared";
import { accountSettingsQuery } from "@/lib/settings";
import { api, openExternal } from "@/lib/api";
import { authQuery, queryClient, signOutAccount, switchAccount } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MailAvatar } from "@/components/mail-avatar";

function AccountForm({ account, active }: { account: MailAccount; active: boolean }) {
  const query = useQuery(accountSettingsQuery(account.id));
  const [value, setValue] = useState({ displayName: "", signature: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (query.data && !dirty) setValue(query.data);
  }, [query.data, dirty]);
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Account action failed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="border-t py-6" aria-label={account.email}>
      <div className="mb-5 flex items-center gap-3">
        <MailAvatar name={account.name ?? ""} email={account.email} image={account.image} className="size-9" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{account.name || account.email}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {account.email}
            {active ? " · Active account" : ""}
          </p>
        </div>
      </div>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading account details…
        </p>
      ) : query.error ? (
        <div role="alert">
          <p className="text-sm text-destructive">{query.error.message}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = accountSettingsSchema.safeParse(value);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "Check the account details.");
              return;
            }
            void perform(async () => {
              const saved = await api.saveAccountSettings(parsed.data, account.id);
              queryClient.setQueryData(accountSettingsQuery(account.id).queryKey, saved);
              setValue(saved);
              setDirty(false);
              setMessage("Account details saved.");
              await queryClient.invalidateQueries({ queryKey: ["auth"] });
            });
          }}
        >
          <label className="grid gap-2 text-sm">
            Account name
            <Input
              value={value.displayName}
              maxLength={100}
              placeholder={account.profileName ?? account.email}
              onChange={(event) => {
                setValue({ ...value, displayName: event.target.value });
                setDirty(true);
                setMessage("");
              }}
            />
          </label>
          <p className="-mt-2 text-xs text-muted-foreground">
            A name for this account in Mailfast. Your Google identity stays the same.
          </p>
          <label className="grid gap-2 text-sm">
            Signature
            <textarea
              className="settings-textarea"
              rows={4}
              maxLength={10000}
              value={value.signature}
              placeholder="Your name, role, or a closing line"
              onChange={(event) => {
                setValue({ ...value, signature: event.target.value });
                setDirty(true);
                setMessage("");
              }}
            />
          </label>
          <p className="-mt-2 text-xs text-muted-foreground">
            Added to new messages, replies, and forwards. Open drafts keep their current text.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || !dirty}
              onClick={() => {
                setDirty(false);
                setMessage("");
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {!active && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void perform(() => switchAccount(account.id))}
          >
            Switch to this account
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              const { url } = await api.login();
              openExternal(url);
            })
          }
        >
          Reconnect
        </Button>
        <Button
          size="sm"
          variant="ghost-destructive"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                `Sign out of ${account.email}? This removes its local mail cache, account settings, and recommendations from this server. Your Gmail messages stay in Google.`,
              )
            )
              void perform(() => signOutAccount(account.id));
          }}
        >
          Sign out
        </Button>
      </div>
    </section>
  );
}
export function AccountSettings() {
  const { data } = useQuery(authQuery);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Manage your connected accounts and how they appear in Mailfast.</p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void api
              .login()
              .then(({ url }) => openExternal(url))
              .catch((error: unknown) => setError(error instanceof Error ? error.message : "Sign-in failed."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Opening sign-in…" : "Add account"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {data?.accounts.map((account) => (
        <AccountForm key={account.id} account={account} active={account.id === data.activeAccountId} />
      ))}
    </div>
  );
}
