import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { authQuery, labelsCollection, threadQuery } from "../lib/data";
import { HIDDEN_LABELS, labelName, longDate } from "../lib/format";
import { openExternal } from "../lib/api";
import { act } from "./ThreadList";

/**
 * Thread metadata view. Bodies are intentionally not rendered (out of scope);
 * each message shows sender, recipients, date and Gmail's snippet, with a
 * one-click jump to the full thread in Gmail.
 */
export function ThreadView({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const { data, isPending, error } = useQuery(threadQuery(threadId));
  const account = useQuery(authQuery).data?.account ?? "";
  const { data: labels } = useLiveQuery({ query: (q) => q.from({ l: labelsCollection }) });

  // Opening a thread marks it read, once per open.
  const markedFor = useRef<string | null>(null);
  useEffect(() => {
    if (data?.thread.unread && markedFor.current !== threadId) {
      markedFor.current = threadId;
      act([threadId], { kind: "read" });
    }
  }, [data?.thread.unread, threadId]);

  if (isPending) return <div className="pane loading" />;
  if (error || !data) return <div className="pane empty">Couldn’t load this conversation.</div>;

  const t = data.thread;
  const names = new Map(labels.map((l) => [l.id, l.name]));
  const chips = t.labelIds.filter(
    (l) => !HIDDEN_LABELS.has(l) && !l.startsWith("CATEGORY_") && l !== "STARRED" && l !== "IMPORTANT",
  );
  const gmailUrl = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${threadId}`;
  const inInbox = t.labelIds.includes("INBOX");
  const inTrash = t.labelIds.includes("TRASH");

  return (
    <div className="pane">
      <div className="toolbar">
        <button onClick={onClose} title="Close (Esc)">
          ✕
        </button>
        <span className="spacer" />
        <button onClick={() => act([threadId], { kind: inInbox ? "archive" : "inbox" })}>
          {inInbox ? "Archive" : "Move to Inbox"}
        </button>
        <button onClick={() => act([threadId], { kind: inTrash ? "untrash" : "trash" })}>
          {inTrash ? "Restore" : "Delete"}
        </button>
        <button onClick={() => act([threadId], { kind: t.unread ? "read" : "unread" })}>
          {t.unread ? "Mark read" : "Mark unread"}
        </button>
        <button onClick={() => act([threadId], { kind: t.starred ? "unstar" : "star" })}>
          {t.starred ? "★ Starred" : "☆ Star"}
        </button>
        <button className="primary" onClick={() => openExternal(gmailUrl)}>
          Open in Gmail ↗
        </button>
      </div>

      <h1 className="thread-subject">{t.subject || "(no subject)"}</h1>
      <div className="chips">
        {chips.map((l) => (
          <span key={l} className="chip">
            {labelName(l, names.get(l))}
          </span>
        ))}
        {!data.complete && <span className="chip muted">loading older messages…</span>}
      </div>

      <ol className="messages">
        {data.messages.map((m) => (
          <li key={m.id} className={m.unread ? "unread" : undefined}>
            <div className="msg-head">
              <span className="msg-from">
                {m.from.name || m.from.email}
                {m.from.name && <span className="muted"> &lt;{m.from.email}&gt;</span>}
              </span>
              <span className="muted">{longDate(m.date)}</span>
            </div>
            <div className="msg-to muted">
              to {m.to || "(undisclosed)"}
              {m.cc && <> · cc {m.cc}</>}
            </div>
            <p className="msg-snippet">{m.snippet || <span className="muted">(no preview)</span>}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
