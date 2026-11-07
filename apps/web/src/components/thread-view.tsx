import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { authQuery, labelsCollection, threadQuery } from "@/lib/data";
import { cleanSnippet, HIDDEN_LABELS, labelName, longDate, parseAddresses } from "@/lib/format";
import { openExternal } from "@/lib/api";
import { act } from "@/components/thread-list";
import type { AttachmentMeta, MessageMeta } from "@mailfast/shared";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Icon } from "@/components/icon";
import {
  ChevronDown,
  CircleAlert,
  File,
  FileArchive,
  FileCode,
  FileText,
  Image,
  MoreHorizontal,
  Paperclip,
  X,
} from "lucide-react";
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
 * Thread conversation view. Displays full message details, sender, recipients,
 * attachments, and complete HTML/text bodies with one-click actions.
 */
export function ThreadView({ threadId, paneId, onClose }: { threadId: string; paneId?: string; onClose: () => void }) {
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
          <div
            className="flex-1 h-full min-w-4 cursor-grab active:cursor-grabbing self-stretch select-none"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/mailfast-thread", threadId);
              if (paneId) {
                e.dataTransfer.setData("application/mailfast-source-pane", paneId);
              }
              e.dataTransfer.effectAllowed = "move";
            }}
          />
          <IconButton label="Close conversation" onClick={onClose}>
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

  const allAttachments = useMemo(() => {
    const list: ThreadAttachment[] = [];
    for (const m of data.messages) {
      if (m.attachments && m.attachments.length > 0) {
        for (const att of m.attachments) {
          list.push({
            ...att,
            messageId: m.id,
            fromName: m.from.name || m.from.email,
            date: m.date,
          });
        }
      }
    }
    return list;
  }, [data.messages]);

  const totalAttachmentBytes = useMemo(() => {
    return allAttachments.reduce((sum, a) => sum + (a.size || 0), 0);
  }, [allAttachments]);

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
        {/* Empty space in header acts as draggable handler to move or split space */}
        <div
          className="flex-1 h-full min-w-4 cursor-grab active:cursor-grabbing self-stretch select-none"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/mailfast-thread", threadId);
            if (paneId) {
              e.dataTransfer.setData("application/mailfast-source-pane", paneId);
            }
            e.dataTransfer.effectAllowed = "move";
          }}
          title="Drag to split or move space"
        />
        <IconButton label="Close conversation" onClick={onClose}>
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

        <ol className="divide-y divide-border/60">
          {data.messages.map((m) => (
            <ThreadMessageItem key={m.id} message={m} account={account} defaultExpanded={true} />
          ))}
        </ol>
      </div>
      <div className="sticky bottom-0 z-10 mt-auto bg-background/95 backdrop-blur-xs">
        {allAttachments.length > 0 && (
          <StickyAttachmentsBar attachments={allAttachments} totalBytes={totalAttachmentBytes} gmailUrl={gmailUrl} />
        )}
        <footer className="p-5 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {data.messages.length} {data.messages.length === 1 ? "message" : "messages"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => openExternal(gmailUrl)}>
                <Icon name="external" />
                Reply in Gmail
              </Button>
              <Button size="sm" onClick={() => openExternal(gmailUrl)}>
                Open in Gmail <Icon name="external" />
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

interface ThreadAttachment extends AttachmentMeta {
  messageId: string;
  fromName: string;
  date: number;
}

function getAttachmentIcon(mimeType: string, filename: string) {
  const mime = (mimeType || "").toLowerCase();
  const ext = (filename || "").split(".").pop()?.toLowerCase() ?? "";

  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return <Image className="size-4 text-blue-500 shrink-0" />;
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return <FileText className="size-4 text-red-500 shrink-0" />;
  }
  if (
    mime.includes("zip") ||
    mime.includes("tar") ||
    mime.includes("compressed") ||
    ["zip", "tar", "gz", "7z", "rar"].includes(ext)
  ) {
    return <FileArchive className="size-4 text-amber-500 shrink-0" />;
  }
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    ["js", "ts", "tsx", "jsx", "html", "css", "py", "sh"].includes(ext)
  ) {
    return <FileCode className="size-4 text-emerald-500 shrink-0" />;
  }
  return <File className="size-4 text-muted-foreground shrink-0" />;
}

function StickyAttachmentsBar({
  attachments,
  totalBytes,
  gmailUrl,
}: {
  attachments: ThreadAttachment[];
  totalBytes: number;
  gmailUrl: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (!attachments.length) return null;

  return (
    <div className="border-t border-border/80 bg-card/95 px-5 py-3 backdrop-blur-xs transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground">Attachments from history ({attachments.length})</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">· {formatBytes(totalBytes)}</span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-expanded={!collapsed}
        >
          <span>{collapsed ? "Show" : "Hide"}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-3.5 transition-transform duration-200", !collapsed && "rotate-180")}
          />
        </button>
      </div>

      {!collapsed && (
        <div className="mt-2.5 flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-1">
          {attachments.map((att, idx) => (
            <div
              key={att.id ?? `${att.filename}-${idx}`}
              onClick={() => openExternal(gmailUrl)}
              className="group inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-background/90 px-3 py-2 text-xs transition-colors hover:border-primary/50 hover:bg-muted/50 shadow-2xs"
              title={`${att.filename} (${formatBytes(att.size)}) - sent by ${att.fromName}. Click to open in Gmail.`}
            >
              {getAttachmentIcon(att.mimeType, att.filename)}
              <div className="flex min-w-0 flex-col">
                <span className="truncate max-w-[200px] font-medium text-foreground group-hover:text-primary">
                  {att.filename}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatBytes(att.size)} · from {att.fromName}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HtmlBody({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(120);

  const srcDoc = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_blank">
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 14px 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1a1a1a;
      background-color: #ffffff;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    img {
      max-width: 100% !important;
      height: auto !important;
    }
    table {
      max-width: 100% !important;
    }
    a {
      color: #2563eb;
    }
    pre, code {
      white-space: pre-wrap;
      word-break: break-all;
    }
    blockquote {
      margin: 8px 0;
      padding-left: 12px;
      border-left: 3px solid #cbd5e1;
      color: #64748b;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
  }, [html]);

  const updateHeight = () => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const h = Math.max(doc.body?.scrollHeight ?? 0, doc.documentElement?.scrollHeight ?? 0);
        if (h > 0) {
          setHeight(h + 8);
        }
      }
    } catch {
      // Ignore potential cross-origin restriction
    }
  };

  useEffect(() => {
    updateHeight();
    const t1 = setTimeout(updateHeight, 150);
    const t2 = setTimeout(updateHeight, 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [srcDoc]);

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border/70 bg-white shadow-xs">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        onLoad={updateHeight}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        className="w-full border-0 block"
        style={{ height: `${height}px`, minHeight: "80px" }}
        title="Email message body"
      />
    </div>
  );
}

function TextBody({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 p-4 font-sans text-[14px] leading-relaxed text-foreground whitespace-pre-wrap select-text break-words">
      {text}
    </div>
  );
}

function ThreadMessageItem({
  message: m,
  account,
  defaultExpanded,
}: {
  message: MessageMeta;
  account: string;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [viewMode, setViewMode] = useState<"html" | "text">(m.bodyHtml ? "html" : "text");

  return (
    <li className={cn("py-3", m.unread && "border-l-2 border-l-primary pl-4")}>
      <section>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <MessageHeader message={m} account={account} />
          </div>
          <div className="flex items-center gap-1 shrink-0 pt-0.5">
            {expanded && m.bodyHtml && m.bodyText && (
              <div className="inline-flex rounded-md border border-border/60 p-0.5 text-xs">
                <button
                  type="button"
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors",
                    viewMode === "html" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setViewMode("html")}
                >
                  HTML
                </button>
                <button
                  type="button"
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors",
                    viewMode === "text" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setViewMode("text")}
                >
                  Text
                </button>
              </div>
            )}
            <IconButton
              label={expanded ? "Collapse message" : "Expand message"}
              className="size-7 text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronDown
                aria-hidden="true"
                className={cn("size-3.5 transition-transform duration-200", expanded && "rotate-180")}
              />
            </IconButton>
          </div>
        </div>

        {expanded ? (
          <div>
            {viewMode === "html" && m.bodyHtml ? (
              <HtmlBody html={m.bodyHtml} />
            ) : m.bodyText ? (
              <TextBody text={m.bodyText} />
            ) : (
              <p className="mt-4 wrap-break-word text-[14px] leading-relaxed text-secondary-foreground">
                {cleanSnippet(m.snippet) || <span className="text-muted-foreground">(no preview)</span>}
              </p>
            )}
          </div>
        ) : (
          <p
            className="mt-1.5 cursor-pointer truncate text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(true)}
          >
            {cleanSnippet(m.snippet) || "(no preview)"}
          </p>
        )}
      </section>
    </li>
  );
}

/**
 * Sender line (name, address, date) over a one-line recipient summary ("to me, Ann · cc Bob").
 * The summary toggles a details card with every full address.
 */
function MessageHeader({ message: m, account }: { message: MessageMeta; account: string }) {
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
