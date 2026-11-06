import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { PairingGrant } from "@mailfast/shared";
import { api, openExternal } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PairBrowserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [grant, setGrant] = useState<PairingGrant | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!grant || !open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [grant, open]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const seconds = grant ? Math.max(0, Math.ceil((grant.expiresAt - now) / 1000)) : 0;

  const close = (next: boolean) => {
    if (!next) {
      setGrant(null);
      setError("");
      setCopied(false);
    }
    onOpenChange(next);
  };

  const createGrant = async () => {
    setPending(true);
    setError("");
    setCopied(false);
    try {
      setGrant(await api.createPairingGrant());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a pairing code.");
    } finally {
      setPending(false);
    }
  };

  const copyCode = async () => {
    if (!grant) return;
    try {
      await navigator.clipboard.writeText(grant.code);
      setCopied(true);
    } catch {
      setError("Could not copy the pairing code. You can select and copy it manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Pair another browser</DialogTitle>
          <DialogDescription>
            Create a one-use code that expires in five minutes. It grants access to this server’s signed-in mailbox.
          </DialogDescription>
        </DialogHeader>
        {grant && (
          <div className="relative min-w-0 rounded-lg border bg-muted/40 p-4 pt-12 text-center">
            <Button
              className="absolute top-2 right-2"
              variant="ghost"
              size="icon-sm"
              aria-label={copied ? "Code copied" : "Copy code"}
              disabled={!seconds}
              onClick={() => void copyCode()}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
            <code
              className={`block max-w-full font-mono text-base sm:text-lg tracking-wide break-all select-all ${seconds ? "" : "text-muted-foreground line-through"}`}
              aria-label="Pairing code"
            >
              {grant.code}
            </code>
            <p className="mt-3 text-xs text-muted-foreground">
              Expires at {new Date(grant.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·
              one use
            </p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums" role="timer">
              {seconds
                ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`
                : "Code expired"}
            </p>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="outline" onClick={() => close(false)}>
            Close
          </Button>
          {grant && seconds > 0 ? (
            <Button onClick={() => openExternal(grant.url)}>
              Open in browser <ExternalLink />
            </Button>
          ) : (
            <Button onClick={() => void createGrant()} disabled={pending}>
              {pending ? "Creating code…" : grant ? "Create new code" : "Create pairing code"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
