import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { authQuery, labelsCollection, threadQuery } from "@/lib/data";
import { cleanSnippet, HIDDEN_LABELS, labelName, longDate, parseAddresses } from "@/lib/format";
import { openExternal } from "@/lib/api";
import { act } from "@/components/thread-list";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Icon } from "@/components/icon";
import { ChevronDown, CircleAlert, MoreHorizontal, X } from "lucide-react";
import { MailAvatar } from "@/components/mail-avatar";
import { IconButton } from "@/components/icon-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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

  if (isPending)
    return (
      <div className="pane h-full" aria-label="Loading conversation">
        <div className="toolbar">
          <Skeleton className="h-7 w-40" />
          <IconButton className="ml-auto" label="Close conversation" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <div className="flex-1 space-y-6 p-6">
          <Skeleton className="h-7 w-3/4" />
          <div className="flex gap-3">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-16 w-3/4" />
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="m-5 h-20" />
      </div>
    );
  if (error || !data)
    return (
      <div className="pane empty h-full">
        <Alert variant="destructive">
          <AlertDescription>Couldn’t load this conversation.</AlertDescription>
        </Alert>
      </div>
    );

  const t = data.thread;
  const names = new Map(labels.map((l) => [l.id, l.name]));
  const chips = t.labelIds.filter(
    (l) => !HIDDEN_LABELS.has(l) && !l.startsWith("CATEGORY_") && l !== "STARRED" && l !== "IMPORTANT",
  );
  const gmailUrl = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${threadId}`;
  const inInbox = t.labelIds.includes("INBOX");
  const inTrash = t.labelIds.includes("TRASH");

  return (
    // The reading pane is its own size container: it is resizable, so its layout follows its width, not the window's.
    <div className="pane @container h-full">
      <div className="toolbar">
        <IconButton
          label={inInbox ? "Archive" : "Move to Inbox"}
          onClick={() => act([threadId], { kind: inInbox ? "archive" : "inbox" })}
        >
          <Icon name="archive" />
        </IconButton>
        <IconButton
          label={inTrash ? "Restore" : "Delete"}
          variant={inTrash ? "ghost" : "ghost-destructive"}
          onClick={() => act([threadId], { kind: inTrash ? "untrash" : "trash" })}
        >
          <Icon name="TRASH" />
        </IconButton>
        <IconButton
          label={t.unread ? "Mark read" : "Mark unread"}
          onClick={() => act([threadId], { kind: t.unread ? "read" : "unread" })}
        >
          <Icon name={t.unread ? "read" : "unread"} />
        </IconButton>
        <IconButton
          label={t.starred ? "Unstar" : "Star"}
          className={cn("star", t.starred && "on")}
          onClick={() => act([threadId], { kind: t.starred ? "unstar" : "star" })}
        >
          <Icon name="STARRED" />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More conversation actions">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => act([threadId], { kind: t.important ? "unimportant" : "important" })}>
              <Icon name="IMPORTANT" />
              {t.important ? "Mark unimportant" : "Mark important"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openExternal(gmailUrl)}>
              <Icon name="external" />
              Open in Gmail
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(gmailUrl);
              }}
            >
              <Icon name="external" />
              Copy link to Gmail
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton className="ml-auto" label="Close conversation" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="flex-1 px-6 pb-6">
        <h1 className="thread-subject">{t.subject || "(no subject)"}</h1>
        <div className="chips">
          {t.important && (
            <Badge variant="secondary" className="bg-(--important)/10 text-(--important)">
              <CircleAlert aria-hidden="true" className="size-3.5 fill-(--important)/20 stroke-(--important)" />
              Important
            </Badge>
          )}
          {chips.map((l) => (
            <Badge key={l} variant="secondary">
              {labelName(l, names.get(l))}
            </Badge>
          ))}
          {!data.complete && <Badge variant="secondary">loading older messages…</Badge>}
        </div>

        <ol className="divide-y">
          {data.messages.map((m) => (
            <li key={m.id} className={cn("py-2", m.unread && "border-l-2 border-l-primary pl-4")}>
              <section>
                <MessageHeader message={m} account={account} />
                <p className="mt-4 wrap-break-word text-[14px] leading-relaxed text-secondary-foreground">
                  {cleanSnippet(m.snippet) || <span className="text-muted-foreground">(no preview)</span>}
                </p>
              </section>
            </li>
          ))}
        </ol>
      </div>
      <footer className="sticky bottom-0 mt-auto bg-background p-5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <span className="text-xs text-muted-foreground">Bodies and replies open in Gmail</span>
          <Button size="sm" onClick={() => openExternal(gmailUrl)}>
            Open in Gmail <Icon name="external" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

type Message = { from: { name: string; email: string }; to: string; cc: string; date: number };

/**
 * Sender line (name, address, date) over a one-line recipient summary ("to me, Ann · cc Bob").
 * The summary toggles a details card with every full address.
 */
function MessageHeader({ message: m, account }: { message: Message; account: string }) {
  const [open, setOpen] = useState(false);
  const to = parseAddresses(m.to);
  const cc = parseAddresses(m.cc);
  const isMe = (email: string) => !!account && email.toLowerCase() === account.toLowerCase();
  const short = (a: { name: string; email: string }) => (isMe(a.email) ? "me" : a.name || a.email);
  const summary = [
    to.length ? `to ${to.map(short).join(", ")}` : "to (undisclosed)",
    cc.length ? `cc ${cc.map(short).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const full = (list: { name: string; email: string }[]) =>
    list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
  return (
    <div className="flex items-start gap-3">
      <MailAvatar name={m.from.name} email={m.from.email} className="size-9" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold">{m.from.name || m.from.email}</span>
          {m.from.name && (
            <span className="truncate text-xs text-muted-foreground @max-[30rem]:hidden">{m.from.email}</span>
          )}
          <time
            className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tabular-nums"
            dateTime={new Date(m.date).toISOString()}
          >
            {longDate(m.date)}
          </time>
        </div>
        <button
          type="button"
          aria-expanded={open}
          className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border bg-card px-3 py-2.5 text-xs">
            <dt className="text-muted-foreground">From</dt>
            <dd className="min-w-0 wrap-break-word">{full([m.from])}</dd>
            <dt className="text-muted-foreground">To</dt>
            <dd className="min-w-0 wrap-break-word">{to.length ? full(to) : "(undisclosed)"}</dd>
            {cc.length > 0 && (
              <>
                <dt className="text-muted-foreground">Cc</dt>
                <dd className="min-w-0 wrap-break-word">{full(cc)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Date</dt>
            <dd>{new Date(m.date).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
