import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "@mailfast/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";

export function ConnectionUnavailable({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="setup">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="INBOX" />
            Mailfast server unavailable
          </CardTitle>
          <CardDescription>
            {message ?? "Couldn’t reach the local Mailfast service. Check that it’s running, then retry."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onRetry}>Retry connection</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function PairingScreen({
  connection,
  initialCode,
  onPaired,
}: {
  connection: ConnectionStatus;
  initialCode: string;
  onPaired: () => Promise<void>;
}) {
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const consumedIncomingCode = useRef(false);

  const pair = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || pending) return;
      setPending(true);
      setError("");
      try {
        await api.exchangePairingCode(trimmed);
        setCode("");
        await onPaired();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not pair with this Mailfast server.");
      } finally {
        setPending(false);
      }
    },
    [onPaired, pending],
  );

  useEffect(() => {
    if (initialCode && !consumedIncomingCode.current) {
      consumedIncomingCode.current = true;
      void pair(initialCode);
    }
  }, [initialCode, pair]);

  const { server } = connection;
  return (
    <div className="setup">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="INBOX" />
            Pair this browser
          </CardTitle>
          <CardDescription>
            Pair with this local Mailfast server to use its signed-in mailbox. The pairing code is short-lived and is
            only used for this browser session.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">{server.mode === "desktop" ? "Mailfast desktop" : "Mailfast standalone"}</div>
            <div className="muted mt-1">Server ID: {server.instanceId}</div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void pair(code);
            }}
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="pairing-code">Pairing code</FieldLabel>
                <Input
                  id="pairing-code"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  disabled={pending}
                  required
                />
              </Field>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={!code.trim() || pending}>
                {pending ? "Pairing…" : "Pair browser"}
              </Button>
            </FieldGroup>
          </form>
          {server.mode === "desktop" && (
            <p className="muted text-sm">
              To use an independent web-only server with Google sign-in, run <code>bun run dev:web:standalone</code>. It
              starts an isolated backend; this browser can’t launch it or copy credentials from your desktop server.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
