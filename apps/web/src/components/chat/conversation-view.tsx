import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Send,
  ExternalLink,
  Hash,
  Check,
  Quote,
  X,
  AtSign,
  MessageSquareText,
  Copy,
} from "lucide-react";
import { chatSpacesQuery, chatMessagesQuery, authQuery } from "@/lib/data";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatMessage, QuotedMessage } from "@mailfast/shared";
import {
  formatChatDate,
  formatChatTime,
  getAvatarStyle,
  detectGoogleServices,
  GoogleServiceCard,
  RenderMessageText,
  RenderAttachments,
} from "@/components/chat/chat-helpers";

interface ConversationViewProps {
  spaceId: string;
  spaceType?: "SPACE" | "DIRECT_MESSAGE";
}

type OptimisticChatMessage = ChatMessage & {
  optimisticStatus?: "sending" | "failed";
};

interface SendMessageVariables {
  text: string;
  threadId?: string;
  quotedMessage?: QuotedMessage;
  clientId: string;
}

export function ConversationView({ spaceId, spaceType }: ConversationViewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useQuery(authQuery).data;
  const currentAccount = auth?.accounts?.find((a) => a.id === auth.activeAccountId);
  const currentUserEmail = (currentAccount?.email ?? auth?.account ?? "").toLowerCase();
  const currentUserName = (currentAccount?.name ?? "").toLowerCase();
  const isSelfMessage = (msg: ChatMessage) =>
    Boolean(msg.sender.isSelf) ||
    msg.sender.name === "users/me" ||
    msg.sender.displayName?.toLowerCase() === "you" ||
    msg.sender.displayName?.toLowerCase() === "me" ||
    (Boolean(currentUserEmail) && msg.sender.email?.toLowerCase() === currentUserEmail) ||
    (Boolean(currentUserName) && msg.sender.displayName?.toLowerCase() === currentUserName);

  const { data: spacesData, isLoading: spacesLoading } = useQuery(chatSpacesQuery());
  const spaces = spacesData?.spaces ?? [];

  const activeSpace = useMemo(() => {
    return (
      spaces.find(
        (s) =>
          s.id === spaceId ||
          s.id === `spaces/${spaceId}` ||
          s.id.replace(/^spaces\//, "") === spaceId.replace(/^spaces\//, ""),
      ) ?? null
    );
  }, [spaces, spaceId]);

  const activeSpaceId = activeSpace?.id ?? (spaceId.startsWith("spaces/") ? spaceId : `spaces/${spaceId}`);

  // Mark space read on open
  useEffect(() => {
    if (activeSpaceId && activeSpace?.unreadCount && activeSpace.unreadCount > 0) {
      void api.markChatSpaceRead(activeSpaceId).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["chat-spaces"] });
      });
    }
  }, [activeSpaceId, activeSpace?.unreadCount, queryClient]);

  // Load messages for active space
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    ...chatMessagesQuery(activeSpaceId ?? ""),
    enabled: Boolean(activeSpaceId),
  });
  const messages: OptimisticChatMessage[] = messagesData?.messages ?? [];

  // Message sending state
  const [messageText, setMessageText] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef<Record<string, boolean>>({});
  const previousMessageCountRef = useRef<Record<string, number>>({});
  const lastSpaceIdRef = useRef<string | null>(null);
  const [showNewMessages, setShowNewMessages] = useState(false);

  // Open at the latest message, then follow new messages only while the reader is nearby.
  useLayoutEffect(() => {
    if (!activeSpaceId || messages.length === 0) return;

    const container = messagesContainerRef.current;
    if (!container) return;
    const isNewSpace = lastSpaceIdRef.current !== activeSpaceId;
    const hasInitialScrolled = initialScrollDoneRef.current[activeSpaceId];

    if (isNewSpace || !hasInitialScrolled) {
      lastSpaceIdRef.current = activeSpaceId;
      initialScrollDoneRef.current[activeSpaceId] = true;
      previousMessageCountRef.current[activeSpaceId] = messages.length;
      setShowNewMessages(false);
      container.scrollTop = container.scrollHeight;
      requestAnimationFrame(() => {
        if (messagesContainerRef.current === container) {
          container.scrollTop = container.scrollHeight;
        }
      });
      return;
    }

    const previousCount = previousMessageCountRef.current[activeSpaceId] ?? messages.length;
    previousMessageCountRef.current[activeSpaceId] = messages.length;
    if (messages.length <= previousCount) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const newestMessage = messages[messages.length - 1];
    if (distanceFromBottom <= 120 || (newestMessage && isSelfMessage(newestMessage))) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      setShowNewMessages(false);
    } else {
      setShowNewMessages(true);
    }
  }, [messages.length, activeSpaceId, currentUserEmail, currentUserName]);

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (container && container.scrollHeight - container.scrollTop - container.clientHeight <= 120) {
      setShowNewMessages(false);
    }
  };

  const scrollToLatestMessage = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setShowNewMessages(false);
  };

  // Replying state (quote reply)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  // Thread state
  const [threadParent, setThreadParent] = useState<ChatMessage | null>(null);
  const [threadReplyText, setThreadReplyText] = useState("");

  useEffect(() => {
    if (!threadParent) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThreadParent(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [threadParent]);

  // Highlight and copy state
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const scrollToMessage = (targetNameOrId?: string) => {
    if (!targetNameOrId) return;
    const sanitized = targetNameOrId.replace(/[^a-zA-Z0-9_-]/g, "_");
    let el = document.getElementById(`chat-msg-${sanitized}`);
    if (!el && targetNameOrId.includes("/")) {
      const lastSeg = targetNameOrId.split("/").pop();
      if (lastSeg) {
        el = document.getElementById(`chat-msg-${lastSeg.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
      }
    }
    if (!el) {
      const found = messages.find(
        (m) =>
          m.id === targetNameOrId ||
          (targetNameOrId && (m.id.endsWith(targetNameOrId) || targetNameOrId.endsWith(m.id))),
      );
      if (found) {
        el = document.getElementById(`chat-msg-${found.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
      }
    }

    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMsgId(targetNameOrId);
      setTimeout(() => {
        setHighlightedMsgId((curr) => (curr === targetNameOrId ? null : curr));
      }, 2000);
    }
  };

  const handleCopyMessage = (msg: ChatMessage) => {
    const textToCopy = msg.text || "";
    if (!textToCopy) return;
    void navigator.clipboard.writeText(textToCopy);
    setCopiedMsgId(msg.id);
    setTimeout(() => {
      setCopiedMsgId((curr) => (curr === msg.id ? null : curr));
    }, 2000);
  };

  // Compute thread replies dynamically across all messages in space
  const threadReplyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of messages) {
      if (m.threadId) {
        counts.set(m.threadId, (counts.get(m.threadId) || 0) + 1);
      }
    }
    return counts;
  }, [messages]);

  // Mention autocomplete state
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);

  // Candidates for mentions
  const mentionCandidates = useMemo(() => {
    const map = new Map<string, { displayName: string; email?: string }>();
    for (const msg of messages) {
      if (msg.sender.displayName && !msg.sender.isSelf && msg.sender.displayName !== "You") {
        map.set(msg.sender.displayName.toLowerCase(), {
          displayName: msg.sender.displayName,
          email: msg.sender.email,
        });
      }
    }
    for (const sp of spaces) {
      if (sp.type === "DIRECT_MESSAGE" && sp.name) {
        map.set(sp.name.toLowerCase(), {
          displayName: sp.name,
        });
      }
    }
    return Array.from(map.values());
  }, [messages, spaces]);

  const filteredMentionCandidates = useMemo(() => {
    if (!mentionFilter) return mentionCandidates.slice(0, 6);
    return mentionCandidates.filter((c) => c.displayName.toLowerCase().includes(mentionFilter)).slice(0, 6);
  }, [mentionCandidates, mentionFilter]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionFilter]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [messageText]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageText(val);

    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_\s]*)$/);
    if (match) {
      setShowMentionMenu(true);
      setMentionFilter(match[1]!.toLowerCase());
      setMentionIndex(0);
    } else {
      setShowMentionMenu(false);
    }
  };

  const handleSelectMention = (member: { displayName: string }) => {
    const cursorPos = textareaRef.current?.selectionStart ?? messageText.length;
    const textBeforeCursor = messageText.slice(0, cursorPos);
    const textAfterCursor = messageText.slice(cursorPos);
    const newTextBefore = textBeforeCursor.replace(/@([a-zA-Z0-9_\s]*)$/, `@${member.displayName} `);
    setMessageText(newTextBefore + textAfterCursor);
    setShowMentionMenu(false);
    textareaRef.current?.focus();
  };

  const handleOpenDmWithUser = async (name: string, email?: string) => {
    const existing = spaces.find(
      (s) =>
        s.type === "DIRECT_MESSAGE" &&
        (s.name.toLowerCase() === name.toLowerCase() || (email && s.name.toLowerCase().includes(email.toLowerCase()))),
    );
    if (existing) {
      const cleanId = existing.id.replace(/^spaces\//, "");
      void navigate({ to: "/chat/direct/$id", params: { id: cleanId } });
    } else {
      try {
        const created = await api.createChatSpace({
          displayName: name,
          spaceType: "DIRECT_MESSAGE",
          email,
        });
        void queryClient.invalidateQueries({ queryKey: ["chat-spaces"] });
        const cleanId = created.id.replace(/^spaces\//, "");
        void navigate({ to: "/chat/direct/$id", params: { id: cleanId } });
      } catch (error) {
        console.error("Could not open a direct message for the mentioned user.", error);
      }
    }
  };

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async ({ text, threadId, quotedMessage }: SendMessageVariables) => {
      if (!activeSpaceId) throw new Error("No space selected");
      return api.sendChatMessage(activeSpaceId, text, threadId, quotedMessage);
    },
    onMutate: async (variables) => {
      const { queryKey } = chatMessagesQuery(activeSpaceId);
      await queryClient.cancelQueries({ queryKey });
      const pendingId = `pending-${variables.clientId}`;
      const pendingMessage: OptimisticChatMessage = {
        id: pendingId,
        spaceId: activeSpaceId,
        sender: {
          name: "users/me",
          displayName: currentAccount?.name || "You",
          email: currentUserEmail || undefined,
          isSelf: true,
        },
        createTime: Date.now(),
        text: variables.text,
        threadId: variables.threadId,
        quotedMessage: variables.quotedMessage,
        optimisticStatus: "sending",
      };
      queryClient.setQueryData<{ messages: OptimisticChatMessage[] }>(queryKey, (old) => {
        const existing = old?.messages ?? [];
        const index = existing.findIndex((message) => message.id === pendingId);
        if (index < 0) return { messages: [...existing, pendingMessage] };
        const updated = [...existing];
        updated[index] = pendingMessage;
        return { messages: updated };
      });
      return { pendingId, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData<{ messages: OptimisticChatMessage[] }>(context.queryKey, (old) =>
        old
          ? {
              messages: old.messages.map((message) =>
                message.id === context.pendingId ? { ...message, optimisticStatus: "failed" } : message,
              ),
            }
          : old,
      );
    },
    onSuccess: (sentMsg, variables, context) => {
      const queryKey = context?.queryKey ?? chatMessagesQuery(activeSpaceId).queryKey;
      const pendingId = context?.pendingId ?? `pending-${variables.clientId}`;
      queryClient.setQueryData<{ messages: OptimisticChatMessage[] }>(queryKey, (old) => {
        const existing = old?.messages ?? [];
        const replaced = existing.map((message) => (message.id === pendingId ? sentMsg : message));
        return {
          messages: replaced.some((message) => message.id === sentMsg.id) ? replaced : [...replaced, sentMsg],
        };
      });
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["chat-spaces"] });
    },
  });

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = messageText.trim();
    if (!text || sendMutation.isPending) return;
    const quote = replyingTo
      ? {
          name: replyingTo.id,
          text: replyingTo.text,
          senderDisplayName: replyingTo.sender.displayName,
          senderAvatarUrl: replyingTo.sender.avatarUrl,
        }
      : undefined;
    setMessageText("");
    setReplyingTo(null);
    sendMutation.mutate({ text, quotedMessage: quote, clientId: crypto.randomUUID() });
  };

  const handleSendThreadReply = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = threadReplyText.trim();
    if (!text || !threadParent || sendMutation.isPending) return;
    const threadId = threadParent.threadId || threadParent.id;
    setThreadReplyText("");
    sendMutation.mutate({ text, threadId, clientId: crypto.randomUUID() });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;

    if (showMentionMenu && filteredMentionCandidates.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const direction = e.key === "ArrowDown" ? 1 : -1;
        setMentionIndex(
          (index) => (index + direction + filteredMentionCandidates.length) % filteredMentionCandidates.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredMentionCandidates[mentionIndex];
        if (selected) handleSelectMention(selected);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setShowMentionMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const threadReplies = useMemo(() => {
    if (!threadParent) return [];
    const tId = threadParent.threadId || threadParent.id;
    return messages.filter((m) => m.id !== threadParent.id && (m.threadId === tId || m.threadId === threadParent.id));
  }, [messages, threadParent]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: OptimisticChatMessage[] }[] = [];
    let currentDate = "";
    let currentGroup: OptimisticChatMessage[] = [];

    for (const msg of messages) {
      const msgDate = formatChatDate(msg.createTime);
      if (msgDate !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, messages: currentGroup });
        }
        currentDate = msgDate;
        currentGroup = [msg];
      } else {
        currentGroup.push(msg);
      }
    }
    if (currentGroup.length > 0) {
      groups.push({ date: currentDate, messages: currentGroup });
    }
    return groups;
  }, [messages]);

  const resolvedType = activeSpace?.type ?? spaceType ?? (spaceId.startsWith("dm-") ? "DIRECT_MESSAGE" : "SPACE");
  const displayName = activeSpace?.name ?? (resolvedType === "DIRECT_MESSAGE" ? "Direct Message" : "Space");

  if (!activeSpace && spacesLoading) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-6" aria-busy="true">
        <Skeleton className="size-10 rounded-full" />
        <div className="w-full max-w-xs space-y-3">
          <Skeleton className="mx-auto h-4 w-36" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="ml-auto h-3 w-3/4" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0 bg-background relative h-full">
      {/* Conversation header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3 min-w-0">
          {resolvedType === "DIRECT_MESSAGE" ? (
            <div
              className={`flex size-8.5 items-center justify-center rounded-full text-xs font-semibold ${getAvatarStyle(
                displayName,
              )}`}
            >
              {displayName.slice(0, 1).toUpperCase()}
            </div>
          ) : (
            <div className="flex size-8.5 items-center justify-center rounded-xl bg-muted text-muted-foreground border border-border">
              <Hash className="size-4" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold">{displayName}</h2>
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 font-normal">
                {resolvedType === "DIRECT_MESSAGE" ? "Direct Message" : "Space"}
              </Badge>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              Google Chat · {resolvedType === "DIRECT_MESSAGE" ? "1-on-1 direct message" : "Team space"}
            </p>
          </div>
        </div>

        {activeSpace?.spaceUri && (
          <a
            href={activeSpace.spaceUri}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="size-3.5" />
            <span>Open in Google Chat</span>
          </a>
        )}
      </header>

      {/* Messages feed */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="relative flex-1 space-y-6 overflow-x-hidden overflow-y-auto px-6 py-4"
      >
        {messagesLoading && messages.length === 0 ? (
          <div className="space-y-5 py-2" aria-label="Loading messages" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className={`flex items-start gap-3 ${index % 2 ? "flex-row-reverse" : ""}`}>
                <Skeleton className="mt-0.5 size-8 shrink-0 rounded-full" />
                <div className={`space-y-2 ${index % 2 ? "items-end" : ""}`}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className={`h-12 rounded-2xl ${index === 1 ? "w-64 max-w-[65vw]" : "w-48"}`} />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <MessageSquare className="size-10 text-muted-foreground/40" />
            <p className="text-sm font-medium">No messages yet</p>
            <p className="text-xs">Start the conversation by sending a message below.</p>
          </div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.date} className="space-y-4">
              {/* Date separator */}
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <span className="relative rounded-full border border-border bg-background px-3 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {group.date}
                </span>
              </div>

              {/* Group messages */}
              <div className="flex flex-col gap-3">
                {group.messages.map((msg, messageIndex) => {
                  const isSelf = isSelfMessage(msg);
                  const previousMessage = group.messages[messageIndex - 1];
                  const senderKey = (message: ChatMessage) =>
                    (message.sender.email || message.sender.name || message.sender.displayName).toLowerCase();
                  const groupedWithPrevious = Boolean(
                    previousMessage &&
                    senderKey(previousMessage) === senderKey(msg) &&
                    msg.createTime - previousMessage.createTime >= 0 &&
                    msg.createTime - previousMessage.createTime <= 5 * 60 * 1000,
                  );

                  const sanitizedId = msg.id.replace(/[^a-zA-Z0-9_-]/g, "_");
                  const isHighlighted =
                    highlightedMsgId === msg.id ||
                    (highlightedMsgId && (highlightedMsgId.endsWith(msg.id) || msg.id.endsWith(highlightedMsgId)));

                  const googleServiceResult = detectGoogleServices(msg.text || "", msg.attachments);

                  const dynamicReplyCount = Math.max(
                    msg.threadReplyCount || 0,
                    threadReplyCounts.get(msg.id) || (msg.threadId ? threadReplyCounts.get(msg.threadId) || 0 : 0),
                  );
                  const hasActiveThread =
                    threadParent?.id === msg.id ||
                    (threadParent &&
                      Boolean(
                        (threadParent.threadId && threadParent.threadId === msg.id) ||
                        (msg.threadId && threadParent.id === msg.threadId),
                      ));

                  return (
                    <div
                      key={msg.id}
                      id={`chat-msg-${sanitizedId}`}
                      className={`group chat-motion relative flex w-full min-w-0 items-start gap-3 rounded-xl p-1 transition-[background-color,box-shadow] duration-200 ${
                        isHighlighted ? "bg-primary/15 ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                      } ${isSelf ? "flex-row-reverse" : "flex-row"} ${groupedWithPrevious ? "-mt-2" : ""} ${
                        msg.optimisticStatus === "sending" ? "opacity-70" : ""
                      }`}
                    >
                      {groupedWithPrevious ? (
                        <div className="mt-0.5 size-8 shrink-0" aria-hidden="true" />
                      ) : (
                        <Avatar className="mt-0.5 size-8 shrink-0">
                          {msg.sender.avatarUrl ? <AvatarImage src={msg.sender.avatarUrl} alt="" /> : null}
                          <AvatarFallback
                            className={`text-[11px] font-medium ${
                              isSelf ? "bg-primary/20 text-primary" : "bg-muted text-foreground"
                            }`}
                          >
                            {isSelf ? "YO" : (msg.sender.displayName || "User").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}

                      <div
                        className={`max-w-[85%] sm:max-w-[75%] md:max-w-[65%] min-w-0 flex flex-col ${isSelf ? "items-end ml-auto" : "items-start mr-auto"}`}
                      >
                        {!groupedWithPrevious && (
                          <div
                            className={`mb-1 flex items-center gap-2 px-1 ${isSelf ? "flex-row-reverse" : "flex-row"}`}
                          >
                            <span className="text-[11px] font-medium text-foreground">
                              {isSelf ? "You" : msg.sender.displayName}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{formatChatTime(msg.createTime)}</span>
                          </div>
                        )}

                        <div
                          title={groupedWithPrevious ? formatChatTime(msg.createTime) : undefined}
                          className={`relative w-fit max-w-full rounded-2xl px-4 py-2.5 text-left text-[13px] leading-relaxed whitespace-pre-wrap wrap-break-word wrap-anywhere shadow-xs select-text ${
                            isSelf
                              ? "bg-primary text-primary-foreground rounded-tr-xs"
                              : "bg-muted text-foreground rounded-tl-xs"
                          }`}
                        >
                          {/* Quoted message preview inside bubble */}
                          {msg.quotedMessage && (
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                scrollToMessage(msg.quotedMessage?.name);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  scrollToMessage(msg.quotedMessage?.name);
                                }
                              }}
                              className={`mb-2 rounded-lg border-l-2 border-primary/70 px-3 py-1.5 text-left text-xs transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring ${
                                isSelf
                                  ? "bg-black/20 text-primary-foreground/90 hover:bg-black/35"
                                  : "bg-background/60 text-foreground/90 hover:bg-muted/80"
                              }`}
                              title="Click to jump to quoted message"
                            >
                              <div className="flex items-center gap-1.5 font-semibold text-[11px] opacity-90 truncate">
                                <Quote className="size-3 shrink-0" />
                                <span>{msg.quotedMessage.senderDisplayName || "Original message"}</span>
                              </div>
                              <div className="truncate text-[12px] opacity-80 mt-0.5">{msg.quotedMessage.text}</div>
                            </div>
                          )}

                          {/* Main message text with mentions & Google Workspace preview cards */}
                          {msg.text && (
                            <RenderMessageText
                              text={msg.text}
                              services={googleServiceResult.items}
                              isSelf={isSelf}
                              onOpenDm={handleOpenDmWithUser}
                            />
                          )}

                          {/* If message had no text but attachment is Google Doc/Sheet, render card */}
                          {!msg.text && googleServiceResult.items.length > 0 && (
                            <div className="space-y-2 pt-1">
                              {googleServiceResult.items.map((service, sIdx) => (
                                <GoogleServiceCard key={sIdx} service={service} />
                              ))}
                            </div>
                          )}

                          {/* Attachments & image previews (excluding consumed) */}
                          <RenderAttachments
                            attachments={msg.attachments}
                            consumedIndices={googleServiceResult.consumedAttachments}
                          />
                          {msg.optimisticStatus && (
                            <div className="mt-1 flex items-center gap-2 text-[10px]">
                              <span className={msg.optimisticStatus === "failed" ? "text-destructive" : "opacity-80"}>
                                {msg.optimisticStatus === "failed" ? "Failed to send" : "Sending…"}
                              </span>
                              {msg.optimisticStatus === "failed" && (
                                <button
                                  type="button"
                                  aria-label="Retry sending message"
                                  className="font-semibold underline underline-offset-2 transition-transform duration-150 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring"
                                  onClick={() =>
                                    sendMutation.mutate({
                                      text: msg.text,
                                      threadId: msg.threadId,
                                      quotedMessage: msg.quotedMessage,
                                      clientId: msg.id.replace(/^pending-/, ""),
                                    })
                                  }
                                >
                                  Retry
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Thread indicator button */}
                        {dynamicReplyCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setThreadParent(msg)}
                            className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                              hasActiveThread
                                ? "bg-primary text-primary-foreground shadow-xs"
                                : "bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
                            }`}
                            title="View thread replies"
                          >
                            <MessageSquareText className="size-3" />
                            <span>
                              {dynamicReplyCount} {dynamicReplyCount === 1 ? "reply" : "replies"}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Hover Action Toolbar */}
                      <div
                        className={`chat-motion absolute -top-3 z-10 flex translate-y-0.5 items-center gap-1 opacity-0 transition-[opacity,transform] duration-150 ease-out-strong group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 ${
                          isSelf ? "left-2" : "right-2"
                        }`}
                      >
                        <div className="flex items-center gap-0.5 rounded-full border border-border bg-background/95 backdrop-blur-xs px-1.5 py-0.5 shadow-md">
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg)}
                            aria-label={copiedMsgId === msg.id ? "Message copied" : "Copy message"}
                            className="rounded-full p-1 text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring"
                            title={copiedMsgId === msg.id ? "Copied!" : "Copy message"}
                          >
                            <span className="relative block size-3.5" aria-hidden="true">
                              <Copy
                                className={`absolute inset-0 size-3.5 transition-[opacity,transform] duration-150 ${
                                  copiedMsgId === msg.id ? "scale-75 opacity-0" : "scale-100 opacity-100"
                                }`}
                              />
                              <Check
                                className={`absolute inset-0 size-3.5 text-emerald-500 transition-[opacity,transform] duration-150 ${
                                  copiedMsgId === msg.id ? "scale-100 opacity-100" : "scale-75 opacity-0"
                                }`}
                              />
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo(msg);
                              requestAnimationFrame(() => textareaRef.current?.focus());
                            }}
                            aria-label="Quote in reply"
                            className="rounded-full p-1 text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring"
                            title="Quote in reply"
                          >
                            <Quote className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setThreadParent(msg)}
                            aria-label="Reply in thread"
                            className={`rounded-full p-1 transition-[background-color,color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring ${
                              hasActiveThread
                                ? "text-primary bg-primary/10"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            title="Reply in thread"
                          >
                            <MessageSquareText className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={scrollToLatestMessage}
          aria-hidden={!showNewMessages}
          tabIndex={showNewMessages ? 0 : -1}
          className={`chat-new-messages absolute z-10 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md transition-[opacity,transform] duration-200 ease-out-strong focus-visible:ring-2 focus-visible:ring-ring ${
            showNewMessages ? "chat-new-messages-visible" : "pointer-events-none opacity-0"
          }`}
        >
          New messages
        </button>
      </div>

      {/* Message composer input */}
      <div className="border-t border-border p-4 bg-background relative">
        {/* Mention Autocomplete Menu */}
        {showMentionMenu && filteredMentionCandidates.length > 0 && (
          <div
            id="chat-mention-list"
            role="listbox"
            aria-label="Mention suggestions"
            className="chat-mention-menu chat-motion origin-bottom-left absolute bottom-full left-4 z-50 mb-2 w-64 rounded-xl border border-border bg-popover p-1 shadow-lg"
          >
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Mention Member
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filteredMentionCandidates.map((c, index) => (
                <button
                  key={c.displayName}
                  type="button"
                  id={`chat-mention-option-${index}`}
                  role="option"
                  aria-selected={mentionIndex === index}
                  tabIndex={-1}
                  onClick={() => handleSelectMention(c)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-[background-color,color,transform] duration-150 active:scale-[0.99] ${
                    mentionIndex === index ? "bg-muted text-foreground" : "hover:bg-muted"
                  }`}
                >
                  <div
                    className={`flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ${getAvatarStyle(c.displayName)}`}
                  >
                    {c.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{c.displayName}</div>
                    {c.email && <div className="truncate text-[10px] text-muted-foreground">{c.email}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quote Reply preview banner */}
        {replyingTo && (
          <div className="chat-quote-banner chat-motion flex items-center justify-between rounded-t-xl border border-b-0 border-border bg-muted/60 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Quote className="size-3.5 text-primary shrink-0" />
              <span className="font-medium text-foreground shrink-0">Replying to {replyingTo.sender.displayName}:</span>
              <span className="text-muted-foreground truncate">{replyingTo.text || "Attachment"}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="size-5 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Cancel quote reply"
              onClick={() => setReplyingTo(null)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}

        <form onSubmit={handleSendMessage} className="relative flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={messageText}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              aria-label={`Message ${displayName}`}
              aria-autocomplete="list"
              aria-controls={showMentionMenu && filteredMentionCandidates.length ? "chat-mention-list" : undefined}
              aria-expanded={showMentionMenu && filteredMentionCandidates.length > 0}
              aria-activedescendant={
                showMentionMenu && filteredMentionCandidates.length ? `chat-mention-option-${mentionIndex}` : undefined
              }
              placeholder={`Message ${displayName}... (Press Enter to send, @ to mention)`}
              rows={1}
              className={`max-h-32 min-h-10 w-full resize-none overflow-y-auto border border-input bg-muted/40 px-3.5 py-2.5 pr-10 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
                replyingTo ? "rounded-b-xl border-t-0" : "rounded-xl"
              }`}
            />
            <button
              type="button"
              onClick={() => {
                setMessageText((prev) => `${prev}@`);
                setShowMentionMenu(true);
                setMentionFilter("");
                setMentionIndex(0);
                textareaRef.current?.focus();
              }}
              aria-label="Mention someone"
              className="absolute right-2.5 bottom-2.5 text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring"
              title="Mention someone"
            >
              <AtSign className="size-4" />
            </button>
          </div>

          <Button
            type="submit"
            size="icon"
            disabled={!messageText.trim() || sendMutation.isPending}
            className="size-10 shrink-0 rounded-xl transition-transform duration-150 active:scale-[0.97]"
            title="Send message"
          >
            <Send className="size-4" />
          </Button>
        </form>
      </div>

      {/* Thread Panel Drawer on right */}
      {threadParent && (
        <div className="chat-thread-drawer absolute top-0 right-0 z-20 flex h-full w-80 flex-col border-l border-border bg-sidebar/95 shadow-2xl backdrop-blur-md sm:w-96">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <MessageSquareText className="size-4 text-primary" />
              <span>Thread</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0 transition-transform duration-150 active:scale-[0.97]"
              aria-label="Close thread"
              onClick={() => setThreadParent(null)}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Scroll area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Pinned parent message */}
            <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
              <div className="flex items-center gap-2 mb-1">
                <Avatar className="size-6">
                  <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                    {threadParent.sender.displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="font-semibold text-xs">{threadParent.sender.displayName}</span>
                <span className="text-[10px] text-muted-foreground">{formatChatTime(threadParent.createTime)}</span>
              </div>
              <RenderMessageText
                text={threadParent.text}
                services={detectGoogleServices(threadParent.text || "", threadParent.attachments).items}
                isSelf={isSelfMessage(threadParent)}
                onOpenDm={handleOpenDmWithUser}
              />
              <RenderAttachments attachments={threadParent.attachments} />
            </div>

            {/* Replies divider */}
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <span className="relative bg-sidebar px-2 text-[10px] text-muted-foreground font-medium">
                {threadReplies.length} {threadReplies.length === 1 ? "reply" : "replies"}
              </span>
            </div>

            {/* Replies list */}
            <div className="space-y-3">
              {threadReplies.map((reply) => (
                <div
                  key={reply.id}
                  className={`flex items-start gap-2.5 ${reply.optimisticStatus === "sending" ? "opacity-70" : ""}`}
                >
                  <Avatar className="size-6 shrink-0 mt-0.5">
                    <AvatarFallback className="text-[10px] bg-muted text-foreground">
                      {reply.sender.displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{reply.sender.displayName}</span>
                      <span className="text-[10px] text-muted-foreground">{formatChatTime(reply.createTime)}</span>
                    </div>
                    <div className="mt-0.5 rounded-lg bg-muted/60 px-3 py-1.5 text-xs text-foreground">
                      <RenderMessageText
                        text={reply.text}
                        services={detectGoogleServices(reply.text || "", reply.attachments).items}
                        isSelf={isSelfMessage(reply)}
                        onOpenDm={handleOpenDmWithUser}
                      />
                      {reply.optimisticStatus && (
                        <div className="mt-1 flex items-center gap-2 text-[10px]">
                          <span
                            className={
                              reply.optimisticStatus === "failed" ? "text-destructive" : "text-muted-foreground"
                            }
                          >
                            {reply.optimisticStatus === "failed" ? "Failed to send" : "Sending…"}
                          </span>
                          {reply.optimisticStatus === "failed" && (
                            <button
                              type="button"
                              aria-label="Retry sending thread reply"
                              className="font-semibold underline underline-offset-2 transition-transform duration-150 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() =>
                                sendMutation.mutate({
                                  text: reply.text,
                                  threadId: reply.threadId,
                                  quotedMessage: reply.quotedMessage,
                                  clientId: reply.id.replace(/^pending-/, ""),
                                })
                              }
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Thread reply composer */}
          <div className="border-t border-border p-3 bg-background">
            <form onSubmit={handleSendThreadReply} className="flex items-end gap-2">
              <textarea
                value={threadReplyText}
                onChange={(e) => setThreadReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendThreadReply();
                  }
                }}
                placeholder="Reply in thread..."
                rows={1}
                className="max-h-28 min-h-9 flex-1 resize-none rounded-xl border border-input bg-muted/40 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!threadReplyText.trim() || sendMutation.isPending}
                className="size-9 shrink-0 rounded-xl transition-transform duration-150 active:scale-[0.97]"
              >
                <Send className="size-3.5" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
