import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { authQuery, labelsCollection, threadQuery } from "@/lib/data";
import { cleanSnippet, HIDDEN_LABELS, labelName, longDate } from "@/lib/format";
import { openExternal } from "@/lib/api";
import { act } from "@/components/thread-list";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Icon } from "@/components/icon";
import { MoreHorizontal, X } from "lucide-react";
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
    <div className="pane h-full">
      <div className="toolbar">
        <IconButton
          label={inInbox ? "Archive" : "Move to Inbox"}
          onClick={() => act([threadId], { kind: inInbox ? "archive" : "inbox" })}
        >
          <Icon name="archive" />
        </IconButton>
        <IconButton
          label={inTrash ? "Restore" : "Delete"}
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
          {chips.map((l) => (
            <Badge key={l} variant="secondary">
              {labelName(l, names.get(l))}
            </Badge>
          ))}
          {!data.complete && <Badge variant="secondary">loading older messages…</Badge>}
        </div>

        <ol className="divide-y">
          {data.messages.map((m) => (
            <li key={m.id} className={cn("py-6", m.unread && "border-l-2 border-l-primary pl-4")}>
              <section>
                <div className="flex items-start gap-3">
                  <MailAvatar name={m.from.name} email={m.from.email} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="font-semibold">{m.from.name || m.from.email}</span>
                      <time className="text-xs text-muted-foreground" dateTime={new Date(m.date).toISOString()}>
                        {longDate(m.date)}
                      </time>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{m.from.email}</p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">To: {m.to || "(undisclosed)"}</p>
                    {m.cc && <p className="break-words text-xs text-muted-foreground">Cc: {m.cc}</p>}
                  </div>
                </div>
                <p className="mt-4 break-words text-[14px] leading-relaxed text-secondary-foreground">
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
