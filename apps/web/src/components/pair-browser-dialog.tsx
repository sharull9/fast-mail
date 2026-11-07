import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import type { PairedBrowser, PairingGrant } from "@mailfast/shared";
import { api, isDesktopApp, openExternal } from "@/lib/api";
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

function sessionDate(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatBrowserName(userAgent: string | null): string | null {
  if (!userAgent) return null;

  let browser = "";
  if (/edg([ea]|ios)?\/([\d.]+)/i.test(userAgent)) {
    browser = "Edge";
  } else if (/opr\/|opera/i.test(userAgent)) {
    browser = "Opera";
  } else if (/chrome|crios/i.test(userAgent) && !/edg/i.test(userAgent)) {
    browser = "Chrome";
  } else if (/firefox|fxios/i.test(userAgent)) {
    browser = "Firefox";
  } else if (/safari/i.test(userAgent) && !/chrome|crios/i.test(userAgent)) {
    browser = "Safari";
  }

  let os = "";
  if (/windows/i.test(userAgent)) {
    os = "Windows";
  } else if (/macintosh|mac os x/i.test(userAgent) && !/ipad|iphone|ipod/i.test(userAgent)) {
    os = "macOS";
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    os = "iOS";
  } else if (/android/i.test(userAgent)) {
    os = "Android";
  } else if (/linux/i.test(userAgent)) {
    os = "Linux";
  } else if (/cros/i.test(userAgent)) {
    os = "ChromeOS";
  }

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return null;
}

export function PairBrowserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [grant, setGrant] = useState<PairingGrant | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now);
  const desktop = isDesktopApp();
  const [sessions, setSessions] = useState<PairedBrowser[]>([]);
  const [sessionsPending, setSessionsPending] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);

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

  const loadSessions = useCallback(async () => {
    setSessionsPending(true);
    setSessionsError("");
    try {
      setSessions(await api.browserSessions());
    } catch (cause) {
      setSessionsError(cause instanceof Error ? cause.message : "Could not load paired browsers.");
    } finally {
      setSessionsPending(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadSessions();
  }, [open, loadSessions]);

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

  const revokeSession = async (session: PairedBrowser) => {
    setRevokingId(session.id);
    setSessionsError("");
    try {
      if (!desktop && session.current) {
        await api.disconnectBrowser();
        close(false);
        return;
      }
      await api.revokeBrowserSession(session.id);
      setSessions((current) => current.filter((s) => s.id !== session.id));
    } catch (cause) {
      setSessionsError(cause instanceof Error ? cause.message : "Could not revoke that browser.");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Paired browsers</DialogTitle>
            <Button variant="ghost" size="sm" disabled={sessionsPending} onClick={() => void loadSessions()}>
              Refresh
            </Button>
          </div>
          <DialogDescription>
            {desktop
              ? "Sessions stay connected until revoked."
              : "Sessions stay connected until revoked. You can disconnect this browser."}
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
        <div className="min-w-0">
          {sessionsPending && sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading paired browsers…</p>
          ) : sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No paired browsers yet.</p>
          ) : (
            <ul className="mt-3 flex min-w-0 flex-col gap-2">
              {sessions.map((session) => {
                const canDisconnect = desktop || session.current;
                return (
                  <li key={session.id} className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2">
                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="truncate text-sm font-medium"
                          title={session.userAgent ?? session.origin ?? "Paired browser"}
                        >
                          {formatBrowserName(session.userAgent) ?? session.userAgent ?? session.origin ?? "Paired browser"}
                        </span>
                        {session.current && (
                          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            This browser
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">Last seen {sessionDate(session.lastSeenAt)}</div>
                    </div>
                    {canDisconnect && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revokingId !== null}
                        onClick={() => void revokeSession(session)}
                      >
                        {revokingId === session.id
                          ? desktop
                            ? "Revoking…"
                            : "Disconnecting…"
                          : desktop
                            ? "Revoke"
                            : "Disconnect"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {sessionsError && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{sessionsError}</AlertDescription>
            </Alert>
          )}
        </div>
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
