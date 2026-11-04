import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AuthStatus } from "@mailfast/shared";
import { api, openExternal } from "../lib/api";
import { authQuery, queryClient } from "../lib/data";

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
      <div className="card">
        <h1>
          <span className="logo">✉</span> Mailfast
        </h1>
        <p className="muted">
          A fast Gmail client. Your mail metadata is cached locally; nothing goes through a third-party server.
        </p>

        {!status.configured ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
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
            <input
              placeholder="Client ID  (….apps.googleusercontent.com)"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
            <input
              placeholder="Client secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
            {save.error && <p className="error">{save.error.message}</p>}
            <button className="primary" disabled={!clientId || !clientSecret || save.isPending}>
              Save
            </button>
          </form>
        ) : (
          <div>
            <h2>2. Sign in</h2>
            <p className="muted">
              Your browser will open for Google sign-in. Come back here when it says you’re signed in.
            </p>
            <button className="primary" onClick={() => login.mutate()} disabled={login.isPending}>
              {waiting ? "Waiting for Google…" : "Sign in with Google"}
            </button>
            {waiting && (
              <button className="link" onClick={() => login.mutate()}>
                Open the sign-in page again
              </button>
            )}
            {login.error && <p className="error">{login.error.message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
