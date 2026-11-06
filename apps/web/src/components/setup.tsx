import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AuthStatus } from "@mailfast/shared";
import { api, openExternal } from "@/lib/api";
import { authQuery, queryClient } from "@/lib/data";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Icon } from "@/components/icon";

/** First run: save a Google "Desktop app" OAuth client, then sign in in the system browser. */
export function Setup({ status }: { status: AuthStatus }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [waiting, setWaiting] = useState(false);

  // While the browser sign-in is open, poll until the server reports a refresh token.
  useQuery({ ...authQuery, refetchInterval: waiting ? 1500 : false });

  const save = useMutation({
    mutationFn: () => api.saveClient(clientId, clientSecret),
    onSuccess: (s) => queryClient.setQueryData(["auth"], s),
  });
  const login = useMutation({
    mutationFn: () => api.login(),
    onSuccess: ({ url }) => {
      openExternal(url);
      setWaiting(true);
    },
  });

  return (
    <div className="setup">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="INBOX" />
            mailfast
          </CardTitle>
          <CardDescription>
            A fast Gmail client. Your mail metadata is cached locally; nothing goes through a third-party server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!status.configured ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate();
              }}
            >
              <FieldGroup>
                <h2>1. Connect a Google OAuth client</h2>
                <ol className="steps">
                  <li>
                    In Google Cloud Console, enable the <b>Gmail API</b>.
                  </li>
                  <li>
                    Create credentials → <b>OAuth client ID</b> → application type <b>Desktop app</b>.
                  </li>
                  <li>Paste the client ID and secret here (stored locally only).</li>
                </ol>
                <Field>
                  <FieldLabel htmlFor="client-id">Client ID</FieldLabel>
                  <Input
                    id="client-id"
                    placeholder="….apps.googleusercontent.com"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-secret">Client secret</FieldLabel>
                  <Input
                    id="client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    required
                  />
                </Field>
                {save.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{save.error.message}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" disabled={!clientId || !clientSecret || save.isPending}>
                  {save.isPending ? "Saving…" : "Save credentials"}
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <h2>2. Sign in</h2>
              <p className="muted">
                Your browser will open for Google sign-in. Come back here when it says you’re signed in.
              </p>
              <Button onClick={() => login.mutate()} disabled={login.isPending}>
                {waiting ? "Waiting for Google…" : "Sign in with Google"}
              </Button>
              {waiting && (
                <Button variant="link" onClick={() => login.mutate()}>
                  Open the sign-in page again
                </Button>
              )}
              {login.error && (
                <Alert variant="destructive">
                  <AlertDescription>{login.error.message}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
