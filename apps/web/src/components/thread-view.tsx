import { ExportMailItem } from "@/components/mail-transfer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { authQuery, labelsCollection, threadQuery } from "@/lib/data";
import { cleanSnippet, HIDDEN_LABELS, labelName, longDate, parseAddresses } from "@/lib/format";
import {
  downloadAttachment,
  fetchAttachmentBlob,
  getAttachmentUrl,
  isDesktopApp,
  openAttachmentInBrowser,
  openExternal,
} from "@/lib/api";
import { act } from "@/components/thread-list";
import { usePreviewWorkspace } from "@/hooks/use-preview-workspace";
import type { MessageMeta, ThreadAttachment } from "@mailfast/shared";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Icon } from "@/components/icon";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileText,
  Forward,
  Image,
  Loader2,
  Mail,
  MoreHorizontal,
  Paperclip,
  Reply,
  ReplyAll,
  X,
} from "lucide-react";
import { ComposerPanel, useComposer } from "@/components/composer";
import { MailAvatar } from "@/components/mail-avatar";
import { IconButton } from "@/components/icon-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  const { openComposer, composers } = useComposer();
  const inlineComposer = composers.find((c) => c.isOpen && c.mode === "fixed" && c.draft.threadId === threadId);
  const isInlineComposerActive = Boolean(inlineComposer);

  const paneRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastScrolledThreadRef = useRef<string | null>(null);

  // Clear message expansion overrides on thread switch so only last message opens
  useEffect(() => {
    messageExpandedOverrides.clear();
  }, [threadId]);

  // When there is history in thread open, auto scroll to the bottom
  useEffect(() => {
    if (!data?.messages || data.messages.length <= 1) {
      return;
    }
    if (lastScrolledThreadRef.current !== threadId) {
      lastScrolledThreadRef.current = threadId;

      const scrollToBottom = () => {
        if (paneRef.current) {
          paneRef.current.scrollTop = paneRef.current.scrollHeight;
        }
      };

      scrollToBottom();
      const raf1 = requestAnimationFrame(() => {
        scrollToBottom();
        const raf2 = requestAnimationFrame(scrollToBottom);
        return () => cancelAnimationFrame(raf2);
      });
      const t1 = setTimeout(scrollToBottom, 60);
      const t2 = setTimeout(scrollToBottom, 200);

      return () => {
        cancelAnimationFrame(raf1);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [data?.messages, threadId]);

  const handleReply = useCallback(
    (message: MessageMeta, replyAll = false, mode: "fixed" | "floating" = "fixed") => {
      const to = [message.from.email];
      let cc: string[] = [];
      if (replyAll) {
        const allTo = parseAddresses(message.to).map((p) => p.email);
        const allCc = parseAddresses(message.cc).map((p) => p.email);
        const myEmail = account.toLowerCase();
        cc = [...new Set([...allTo, ...allCc])].filter(
          (email) => email.toLowerCase() !== myEmail && !to.map((t) => t.toLowerCase()).includes(email.toLowerCase()),
        );
      }
      const threadSubject = data?.thread.subject || "(no subject)";
      const subjectPrefix = threadSubject.toLowerCase().startsWith("re:") ? "" : "Re: ";
      openComposer(
        {
          to,
          cc,
          subject: `${subjectPrefix}${threadSubject}`,
          threadId,
          inReplyTo: message.id,
          references: message.id,
          bodyHtml: "",
        },
        mode,
      );
    },
    [account, data?.thread.subject, openComposer, threadId],
  );

  const handleForward = useCallback(
    (message: MessageMeta, mode: "fixed" | "floating" = "floating") => {
      const threadSubject = data?.thread.subject || "(no subject)";
      const subjectPrefix = threadSubject.toLowerCase().startsWith("fwd:") ? "" : "Fwd: ";
      const forwardedHeader = `<br><br>---------- Forwarded message ---------<br>From: ${message.from.name ? `${message.from.name} &lt;${message.from.email}&gt;` : message.from.email}<br>Date: ${new Date(message.date).toLocaleString()}<br>Subject: ${threadSubject}<br>To: ${message.to}<br><br>`;
      openComposer(
        {
          to: [],
          subject: `${subjectPrefix}${threadSubject}`,
          threadId,
          inReplyTo: message.id,
          references: message.id,
          bodyHtml: `${forwardedHeader}${message.bodyHtml || message.bodyText || ""}`,
        },
        mode,
      );
    },
    [data?.thread.subject, openComposer, threadId],
  );

  const [previewAttachment, setPreviewAttachment] = useState<ThreadAttachment | null>(null);

  const allAttachments = useMemo(() => {
    if (!data?.messages) return [];
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
  }, [data?.messages]);

  const totalAttachmentBytes = useMemo(() => {
    return allAttachments.reduce((sum, a) => sum + (a.size || 0), 0);
  }, [allAttachments]);

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

  return (
    // The reading pane is its own size container: it is resizable, so its layout follows its width, not the window's.
    <div ref={paneRef} className="pane @container h-full">
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
            <ExportMailItem selection={{ threadIds: [threadId] }} />
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
          {data.messages.map((m, index) => {
            const hasHistory = data.messages.length > 1;
            const isLast = index === data.messages.length - 1;
            return (
              <ThreadMessageItem
                key={m.id}
                message={m}
                account={account}
                defaultExpanded={hasHistory ? isLast : true}
                onPreview={setPreviewAttachment}
                gmailUrl={gmailUrl}
                paneId={paneId}
                onReply={(replyAll) => handleReply(m, replyAll, "fixed")}
                onForward={() => handleForward(m, "floating")}
              />
            );
          })}
        </ol>

        {/* Bottom Reply Bar or Inline Fixed Composer */}
        {isInlineComposerActive && inlineComposer ? (
          <div className="mt-6 pt-4 border-t border-border/50">
            <ComposerPanel composerId={inlineComposer.id} mode="fixed" />
          </div>
        ) : (
          <div className="mt-6 pt-4 border-t border-border/50">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-medium"
                onClick={() => {
                  const last = data.messages[data.messages.length - 1];
                  if (last) handleReply(last, false, "fixed");
                }}
              >
                <Reply className="size-3.5" />
                Reply
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-medium"
                onClick={() => {
                  const last = data.messages[data.messages.length - 1];
                  if (last) handleReply(last, true, "fixed");
                }}
              >
                <ReplyAll className="size-3.5" />
                Reply All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-medium"
                onClick={() => {
                  const last = data.messages[data.messages.length - 1];
                  if (last) handleForward(last, "floating");
                }}
              >
                <Forward className="size-3.5" />
                Forward
              </Button>
            </div>
          </div>
        )}
        <div ref={bottomRef} className="h-px" />
      </div>
      {allAttachments.length > 0 && (
        <div className="sticky bottom-0 z-10 mt-auto bg-background/95 backdrop-blur-xs">
          <StickyAttachmentsBar
            attachments={allAttachments}
            totalBytes={totalAttachmentBytes}
            gmailUrl={gmailUrl}
            onPreview={setPreviewAttachment}
            paneId={paneId}
          />
        </div>
      )}
      <AttachmentPreviewDialog
        attachment={previewAttachment}
        gmailUrl={gmailUrl}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function getAttachmentIcon(mimeType: string, filename: string) {
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

function AttachmentCard({
  attachment,
  onPreview,
  gmailUrl,
  paneId,
}: {
  attachment: ThreadAttachment;
  onPreview: (attachment: ThreadAttachment) => void;
  gmailUrl: string;
  paneId?: string;
}) {
  const workspace = usePreviewWorkspace();
  const [copied, setCopied] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onPreview(attachment);
  };

  const handleCopyLink = async () => {
    if (!attachment.id) return;
    const url = `${window.location.origin}${getAttachmentUrl(attachment.messageId, attachment.id, attachment.filename, attachment.mimeType)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={true}
          onDragStart={(e) => {
            e.dataTransfer.setData("application/mailfast-attachment", JSON.stringify(attachment));
            e.dataTransfer.setData("text/plain", attachment.filename);
            if (paneId) {
              e.dataTransfer.setData("application/mailfast-source-pane", paneId);
            }
            e.dataTransfer.effectAllowed = "copyMove";
          }}
          onClick={handleClick}
          className="group inline-flex cursor-grab active:cursor-grabbing items-center gap-2 rounded-lg border border-border/70 bg-background/90 px-3 py-2 text-xs transition-colors hover:border-primary/50 hover:bg-muted/50 shadow-2xs select-none"
          title={`${attachment.filename} (${formatBytes(attachment.size)}) - Drag into workspace, click to preview, right-click for options`}
        >
          {getAttachmentIcon(attachment.mimeType, attachment.filename)}
          <div className="flex min-w-0 flex-col">
            <span className="truncate max-w-50 font-medium text-foreground group-hover:text-primary">
              {attachment.filename}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatBytes(attachment.size)} · from {attachment.fromName}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => onPreview(attachment)}>
          <Eye className="size-4 mr-2" />
          Preview
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            if (paneId && workspace.canSplitRight(paneId)) {
              workspace.dropAttachment(paneId, attachment, "right");
            } else if (workspace.focusedPaneId) {
              workspace.setAttachment(workspace.focusedPaneId, attachment);
            }
          }}
        >
          <Columns2 className="size-4 mr-2" />
          Open in workspace
        </ContextMenuItem>
        {attachment.id && (
          <>
            <ContextMenuItem
              onClick={() =>
                void openAttachmentInBrowser(
                  attachment.messageId,
                  attachment.id!,
                  attachment.filename,
                  attachment.mimeType,
                )
              }
            >
              <ExternalLink className="size-4 mr-2" />
              {isDesktopApp() ? "Open in browser" : "Open in new tab"}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                void downloadAttachment(attachment.messageId, attachment.id!, attachment.filename, attachment.mimeType)
              }
            >
              <Download className="size-4 mr-2" />
              Download
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void handleCopyLink()}>
              {copied ? <Check className="size-4 mr-2 text-emerald-500" /> : <Copy className="size-4 mr-2" />}
              {copied ? "Copied link!" : "Copy link"}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => openExternal(gmailUrl)}>
          <Mail className="size-4 mr-2" />
          Open in Gmail
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AttachmentPreviewDialog({
  attachment,
  gmailUrl,
  onClose,
}: {
  attachment: ThreadAttachment | null;
  gmailUrl: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mime = (attachment?.mimeType || "").toLowerCase();
  const ext = (attachment?.filename || "").split(".").pop()?.toLowerCase() ?? "";
  const isImage = mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  const isPdf = mime === "application/pdf" || ext === "pdf";
  const isText =
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    ["txt", "json", "js", "ts", "tsx", "jsx", "html", "css", "py", "sh", "csv", "log", "md"].includes(ext);

  useEffect(() => {
    if (!attachment || !attachment.id) {
      setBlobUrl(null);
      setTextContent(null);
      setError(null);
      return;
    }

    let active = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);

    fetchAttachmentBlob(attachment.messageId, attachment.id, attachment.filename, attachment.mimeType)
      .then(async (blob) => {
        if (!active) return;
        if (isText) {
          const text = await blob.text();
          if (active) setTextContent(text);
        }
        const url = URL.createObjectURL(blob);
        createdUrl = url;
        if (active) setBlobUrl(url);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load attachment");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment, isText]);

  if (!attachment) return null;

  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-4 sm:p-6 overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b pb-3 pr-8">
          <div className="flex items-center gap-2.5 min-w-0">
            {getAttachmentIcon(attachment.mimeType, attachment.filename)}
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold">{attachment.filename}</DialogTitle>
              <p className="text-xs text-muted-foreground truncate">
                {formatBytes(attachment.size)} · Sent by {attachment.fromName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {attachment.id && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void downloadAttachment(
                      attachment.messageId,
                      attachment.id!,
                      attachment.filename,
                      attachment.mimeType,
                    )
                  }
                  title="Download attachment"
                >
                  <Download className="size-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void openAttachmentInBrowser(
                      attachment.messageId,
                      attachment.id!,
                      attachment.filename,
                      attachment.mimeType,
                    )
                  }
                  title={isDesktopApp() ? "Open in browser" : "Open in new tab"}
                >
                  <ExternalLink className="size-3.5" />
                  <span className="hidden sm:inline">{isDesktopApp() ? "Open in browser" : "Open in new tab"}</span>
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => openExternal(gmailUrl)} title="Open thread in Gmail">
              <Mail className="size-3.5" />
              <span className="hidden sm:inline">Gmail</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-75 overflow-auto flex items-center justify-center p-2">
          {loading && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-primary" />
              <span className="text-xs">Loading attachment preview…</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <Alert variant="destructive" className="max-w-md">
                <CircleAlert className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              {attachment.id && (
                <Button
                  size="sm"
                  onClick={() =>
                    void downloadAttachment(
                      attachment.messageId,
                      attachment.id!,
                      attachment.filename,
                      attachment.mimeType,
                    )
                  }
                >
                  <Download className="size-3.5" />
                  Try Download Instead
                </Button>
              )}
            </div>
          )}

          {!loading && !error && blobUrl && (
            <>
              {isImage && (
                <img
                  src={blobUrl}
                  alt={attachment.filename}
                  className="max-h-[70vh] max-w-full rounded-md object-contain shadow-xs"
                />
              )}
              {isPdf && (
                <iframe
                  src={blobUrl}
                  title={attachment.filename}
                  className="w-full h-[70vh] rounded-md border border-border/80 bg-white"
                />
              )}
              {isText && textContent !== null && (
                <pre className="w-full max-h-[70vh] overflow-auto rounded-md border border-border/70 bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap select-text">
                  {textContent}
                </pre>
              )}
              {!isImage && !isPdf && !isText && (
                <div className="flex flex-col items-center gap-3 p-8 text-center">
                  <div className="rounded-full bg-muted p-4">
                    {getAttachmentIcon(attachment.mimeType, attachment.filename)}
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{attachment.filename}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatBytes(attachment.size)} · {attachment.mimeType || "Binary file"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      In-app preview is not supported for this file type.
                    </p>
                  </div>
                  <Button
                    onClick={() =>
                      void downloadAttachment(
                        attachment.messageId,
                        attachment.id!,
                        attachment.filename,
                        attachment.mimeType,
                      )
                    }
                    className="mt-2"
                  >
                    <Download className="size-4" />
                    Download File
                  </Button>
                </div>
              )}
            </>
          )}

          {!loading && !error && !blobUrl && (
            <div className="text-center text-xs text-muted-foreground">No preview available for this attachment.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StickyAttachmentsBar({
  attachments,
  totalBytes,
  gmailUrl,
  onPreview,
  paneId,
}: {
  attachments: ThreadAttachment[];
  totalBytes: number;
  gmailUrl: string;
  onPreview: (attachment: ThreadAttachment) => void;
  paneId?: string;
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
            <AttachmentCard
              key={att.id ?? `${att.filename}-${idx}`}
              attachment={att}
              onPreview={onPreview}
              gmailUrl={gmailUrl}
              paneId={paneId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HtmlBody({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(200);

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
    html, body {
      margin: 0;
      padding: 0;
      background-color: #ffffff;
      color: #1a1a1a;
    }
    body {
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    img {
      max-width: 100%;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      max-width: 100%;
      margin: 12px 0;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
    }
    th {
      border: 1px solid #e2e8f0;
      background-color: #f8fafc;
      padding: 8px 12px;
      text-align: left;
      font-weight: 600;
      font-size: 13px;
    }
    td {
      border: 1px solid #e2e8f0;
      padding: 8px 12px;
      font-size: 13px;
    }
    .google-smart-chip {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 2px 8px 2px 6px !important;
      border-radius: 6px !important;
      background-color: #f1f3f4 !important;
      color: #202124 !important;
      text-decoration: none !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      vertical-align: middle !important;
      line-height: 20px !important;
      border: 1px solid #dadce0 !important;
      margin: 0 2px !important;
    }
    .google-smart-chip:hover {
      background-color: #e8eaed !important;
    }
    .date-time-chip {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      padding: 2px 7px !important;
      border-radius: 5px !important;
      background-color: #f1f3f4 !important;
      color: #3c4043 !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      border: 1px solid #dadce0 !important;
      margin: 0 2px !important;
      vertical-align: middle !important;
    }
    .mention {
      display: inline-flex !important;
      align-items: center !important;
      gap: 2px !important;
      padding: 1px 6px !important;
      border-radius: 4px !important;
      background-color: rgba(37, 99, 235, 0.1) !important;
      color: #2563eb !important;
      font-weight: 500 !important;
      font-size: 13px !important;
      text-decoration: none !important;
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

  const updateHeight = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const doc = iframe.contentDocument;
      if (!doc) return;

      const body = doc.body;
      const htmlEl = doc.documentElement;
      if (!body || !htmlEl) return;

      const bodyScroll = body.scrollHeight || 0;
      const bodyOffset = body.offsetHeight || 0;
      const htmlScroll = htmlEl.scrollHeight || 0;
      const htmlOffset = htmlEl.offsetHeight || 0;
      const bodyRect = Math.ceil(body.getBoundingClientRect().height || 0);

      const maxH = Math.max(bodyScroll, bodyOffset, htmlScroll, htmlOffset, bodyRect);
      if (maxH > 0) {
        setHeight(maxH + 16);
      }
    } catch {
      // Ignore cross-origin error if any
    }
  }, []);

  const attachListeners = useCallback(() => {
    updateHeight();
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;

      const ro = new ResizeObserver(() => {
        updateHeight();
      });
      if (doc.body) ro.observe(doc.body);
      if (doc.documentElement) ro.observe(doc.documentElement);

      const images = doc.querySelectorAll("img");
      images.forEach((img) => {
        if (!img.complete) {
          img.addEventListener("load", updateHeight, { once: true });
          img.addEventListener("error", updateHeight, { once: true });
        }
      });

      return () => {
        ro.disconnect();
      };
    } catch {
      return undefined;
    }
  }, [updateHeight]);

  useEffect(() => {
    const cleanup = attachListeners();
    const timers = [
      setTimeout(updateHeight, 100),
      setTimeout(updateHeight, 300),
      setTimeout(updateHeight, 800),
      setTimeout(updateHeight, 1500),
      setTimeout(updateHeight, 3000),
    ];
    return () => {
      cleanup?.();
      timers.forEach(clearTimeout);
    };
  }, [srcDoc, attachListeners, updateHeight]);

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-border/70 bg-white shadow-xs">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        onLoad={attachListeners}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        className="w-full border-0 block"
        style={{ height: `${height}px`, minHeight: "100px" }}
        title="Email message body"
      />
    </div>
  );
}

function TextBody({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 p-4 font-sans text-[14px] leading-relaxed text-foreground whitespace-pre-wrap select-text wrap-break-word">
      {text}
    </div>
  );
}

const messageExpandedOverrides = new Map<string, boolean>();
const messageViewModeOverrides = new Map<string, "html" | "text">();

function ThreadMessageItem({
  message: m,
  account,
  defaultExpanded,
  onPreview,
  gmailUrl,
  paneId,
  onReply,
  onForward,
}: {
  message: MessageMeta;
  account: string;
  defaultExpanded: boolean;
  onPreview: (attachment: ThreadAttachment) => void;
  gmailUrl: string;
  paneId?: string;
  onReply?: (replyAll: boolean) => void;
  onForward?: () => void;
}) {
  const [expanded, setExpandedState] = useState(() => {
    return messageExpandedOverrides.has(m.id) ? messageExpandedOverrides.get(m.id)! : defaultExpanded;
  });

  useEffect(() => {
    if (!messageExpandedOverrides.has(m.id)) {
      setExpandedState(defaultExpanded);
    }
  }, [defaultExpanded, m.id]);

  const setExpanded = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      setExpandedState((prev) => {
        const next = typeof action === "function" ? action(prev) : action;
        messageExpandedOverrides.set(m.id, next);
        return next;
      });
    },
    [m.id],
  );

  const [viewMode, setViewModeState] = useState<"html" | "text">(() => {
    return messageViewModeOverrides.has(m.id) ? messageViewModeOverrides.get(m.id)! : m.bodyHtml ? "html" : "text";
  });

  const setViewMode = useCallback(
    (action: "html" | "text" | ((prev: "html" | "text") => "html" | "text")) => {
      setViewModeState((prev) => {
        const next = typeof action === "function" ? action(prev) : action;
        messageViewModeOverrides.set(m.id, next);
        return next;
      });
    },
    [m.id],
  );

  return (
    <li className={cn("py-3", m.unread && "border-l-2 border-l-primary pl-4")}>
      <section>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <MessageHeader message={m} account={account} />
          </div>
          <div className="flex items-center gap-1 shrink-0 pt-0.5">
            {expanded && (
              <>
                <IconButton
                  label="Reply to message"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={() => onReply?.(false)}
                >
                  <Reply className="size-3.5" />
                </IconButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More message actions"
                      className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <ExportMailItem selection={{ messageId: m.id }} />
                    <DropdownMenuItem onSelect={() => onReply?.(false)}>
                      <Reply className="size-3.5 mr-2" />
                      Reply
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onReply?.(true)}>
                      <ReplyAll className="size-3.5 mr-2" />
                      Reply All
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onForward?.()}>
                      <Forward className="size-3.5 mr-2" />
                      Forward
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
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

            {m.attachments && m.attachments.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-border/50">
                {m.attachments.map((att, idx) => {
                  const threadAtt: ThreadAttachment = {
                    ...att,
                    messageId: m.id,
                    fromName: m.from.name || m.from.email,
                    date: m.date,
                  };
                  return (
                    <AttachmentCard
                      key={att.id ?? `${att.filename}-${idx}`}
                      attachment={threadAtt}
                      onPreview={onPreview}
                      gmailUrl={gmailUrl}
                      paneId={paneId}
                    />
                  );
                })}
              </div>
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
