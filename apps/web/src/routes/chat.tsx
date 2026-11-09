import { useState, useRef, useEffect, useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Users,
  Send,
  Plus,
  Search,
  ArrowLeft,
  ExternalLink,
  Hash,
  User,
  Check,
} from "lucide-react";
import { chatSpacesQuery, chatMessagesQuery, authQuery } from "@/lib/data";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ChatMessage, Contact } from "@mailfast/shared";

export const Route = createFileRoute("/chat")({
  validateSearch: (search: Record<string, unknown>): { space?: string } => ({
    space: typeof search.space === "string" ? search.space : undefined,
  }),
  component: ChatRoute,
});

function formatChatListTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays < 7 && diffDays > 0) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatChatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatChatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return "Today";
  }
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const AVATAR_PALETTE = [
  "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30",
  "bg-purple-600/20 text-purple-400 border border-purple-500/30",
  "bg-orange-600/20 text-orange-400 border border-orange-500/30",
  "bg-blue-600/20 text-blue-400 border border-blue-500/30",
  "bg-rose-600/20 text-rose-400 border border-rose-500/30",
  "bg-amber-600/20 text-amber-400 border border-amber-500/30",
  "bg-cyan-600/20 text-cyan-400 border border-cyan-500/30",
  "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30",
];

function getAvatarStyle(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!;
}

function ChatRoute() {
  const { space: selectedSpaceId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useQuery(authQuery).data;
  const currentAccount = auth?.accounts?.find((a) => a.id === auth.activeAccountId);
  const currentUserEmail = (currentAccount?.email ?? auth?.account ?? "").toLowerCase();
  const currentUserName = (currentAccount?.name ?? "").toLowerCase();

  const { data: spacesData, isLoading: spacesLoading } = useQuery(chatSpacesQuery());
  const spaces = spacesData?.spaces ?? [];

  const [activeTab, setActiveTab] = useState<"ALL" | "DIRECT_MESSAGE" | "SPACE">("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatType, setNewChatType] = useState<"DIRECT_MESSAGE" | "SPACE">("DIRECT_MESSAGE");
  const [newSpaceName, setNewSpaceName] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Active space defaults to URL param or first space if available
  const activeSpace = useMemo(() => {
    if (selectedSpaceId) {
      return spaces.find((s) => s.id === selectedSpaceId) ?? null;
    }
    return spaces[0] ?? null;
  }, [spaces, selectedSpaceId]);

  const activeSpaceId = activeSpace?.id;

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
  const messages = messagesData?.messages ?? [];

  // Message sending state
  const [messageText, setMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeSpaceId]);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!activeSpaceId) throw new Error("No space selected");
      return api.sendChatMessage(activeSpaceId, text);
    },
    onSuccess: (sentMsg) => {
      queryClient.setQueryData<{ messages: ChatMessage[] }>(
        ["chat-messages", auth?.activeAccountId ?? null, activeSpaceId],
        (old) => (old ? { messages: [...old.messages, sentMsg] } : { messages: [sentMsg] }),
      );
      void queryClient.invalidateQueries({ queryKey: ["chat-spaces"] });
      void queryClient.invalidateQueries({ queryKey: ["chat-messages", auth?.activeAccountId ?? null, activeSpaceId] });
    },
  });

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = messageText.trim();
    if (!text || sendMutation.isPending) return;
    setMessageText("");
    sendMutation.mutate(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Contacts search for new DM
  useEffect(() => {
    if (!newChatOpen || newChatType !== "DIRECT_MESSAGE") return;
    let active = true;
    void api.contacts(contactSearch, 10).then((res) => {
      if (active) setContacts(res);
    });
    return () => {
      active = false;
    };
  }, [contactSearch, newChatOpen, newChatType]);

  const handleCreateSpace = async () => {
    if (newChatType === "SPACE") {
      const name = newSpaceName.trim();
      if (!name) return;
      const created = await api.createChatSpace({ displayName: name, spaceType: "SPACE" });
      setNewChatOpen(false);
      setNewSpaceName("");
      void queryClient.invalidateQueries({ queryKey: ["chat-spaces"] });
      void navigate({ to: "/chat", search: { space: created.id } });
    } else {
      if (!selectedContact) return;
      const created = await api.createChatSpace({
        displayName: selectedContact.name || selectedContact.email,
        spaceType: "DIRECT_MESSAGE",
        email: selectedContact.email,
      });
      setNewChatOpen(false);
      setSelectedContact(null);
      setContactSearch("");
      void queryClient.invalidateQueries({ queryKey: ["chat-spaces"] });
      void navigate({ to: "/chat", search: { space: created.id } });
    }
  };

  // Filter spaces by type, search, and unread toggle
  const filteredSpaces = useMemo(() => {
    return spaces.filter((s) => {
      if (activeTab === "DIRECT_MESSAGE" && s.type !== "DIRECT_MESSAGE") return false;
      if (activeTab === "SPACE" && s.type !== "SPACE") return false;
      if (unreadOnly && s.unreadCount === 0) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesSnippet = (s.lastMessageSnippet ?? "").toLowerCase().includes(q);
        if (!matchesName && !matchesSnippet) return false;
      }
      return true;
    });
  }, [spaces, activeTab, unreadOnly, searchQuery]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: Array<{ date: string; messages: ChatMessage[] }> = [];
    let currentDate = "";
    let currentGroup: ChatMessage[] = [];

    for (const msg of messages) {
      const dateStr = formatChatDate(msg.createTime);
      if (dateStr !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, messages: currentGroup });
        }
        currentDate = dateStr;
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

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      {/* Main chat two-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Spaces & Direct Messages List */}
        <div className="flex w-84 shrink-0 flex-col border-r border-border bg-sidebar/50 backdrop-blur-xs">
          {/* Top header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Link
                to="/mail/$labelId"
                params={{ labelId: "INBOX" }}
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Back to Mail"
              >
                <ArrowLeft className="size-4" />
              </Link>
              <div className="flex items-center gap-2 font-semibold text-sm">
                <MessageSquare className="size-4.5 text-primary" />
                <span>Google Chat</span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="size-8 p-0"
              onClick={() => setNewChatOpen(true)}
              title="Start a new chat or create space"
            >
              <Plus className="size-4" />
            </Button>
          </div>

          {/* Filter & Unread Switch */}
          <div className="px-3 pt-2.5 pb-2 space-y-2">
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search chat..."
                className="h-8.5 pl-8 text-xs"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Category tabs and Unread toggle */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("ALL")}
                  className={`rounded-md px-2 py-1 font-medium transition-colors ${
                    activeTab === "ALL" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Home
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("DIRECT_MESSAGE")}
                  className={`rounded-md px-2 py-1 font-medium transition-colors ${
                    activeTab === "DIRECT_MESSAGE" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Direct messages
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("SPACE")}
                  className={`rounded-md px-2 py-1 font-medium transition-colors ${
                    activeTab === "SPACE" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Spaces
                </button>
              </div>

              {/* Unread toggle */}
              <button
                type="button"
                onClick={() => setUnreadOnly((prev) => !prev)}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-[11px] transition-colors ${
                  unreadOnly
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Filter unread conversations"
              >
                <span>Unread</span>
                <span
                  className={`size-2 rounded-full ${unreadOnly ? "bg-primary" : "bg-muted-foreground/40"}`}
                />
              </button>
            </div>
          </div>

          {/* Conversations list */}
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            {spacesLoading && spaces.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading conversations...</div>
            ) : filteredSpaces.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No conversations found</div>
            ) : (
              filteredSpaces.map((space) => {
                const isSelected = activeSpace?.id === space.id;
                const isDm = space.type === "DIRECT_MESSAGE";
                const avatarStyle = getAvatarStyle(space.name);

                return (
                  <button
                    key={space.id}
                    onClick={() => void navigate({ to: "/chat", search: { space: space.id } })}
                    className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-xs"
                        : "text-foreground/80 hover:bg-sidebar-accent/50 hover:text-foreground"
                    }`}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      {isDm ? (
                        <div
                          className={`flex size-8.5 items-center justify-center rounded-full text-xs font-semibold ${avatarStyle}`}
                        >
                          {space.name.slice(0, 1).toUpperCase()}
                        </div>
                      ) : (
                        <div className="flex size-8.5 items-center justify-center rounded-xl bg-muted text-muted-foreground border border-border group-hover:text-foreground">
                          <Hash className="size-4" />
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-[13px] leading-tight font-medium">{space.name}</span>
                        {space.lastMessageTime && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatChatListTime(space.lastMessageTime)}
                          </span>
                        )}
                      </div>
                      {space.lastMessageSnippet && (
                        <p className="truncate text-xs text-muted-foreground leading-snug mt-0.5">
                          {space.lastMessageSnippet}
                        </p>
                      )}
                    </div>

                    {space.unreadCount > 0 && (
                      <Badge variant="default" className="size-5 shrink-0 justify-center p-0 text-[10px]">
                        {space.unreadCount}
                      </Badge>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel: Active Conversation View */}
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          {activeSpace ? (
            <>
              {/* Conversation header */}
              <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
                <div className="flex items-center gap-3 min-w-0">
                  {activeSpace.type === "DIRECT_MESSAGE" ? (
                    <div
                      className={`flex size-8.5 items-center justify-center rounded-full text-xs font-semibold ${getAvatarStyle(
                        activeSpace.name,
                      )}`}
                    >
                      {activeSpace.name.slice(0, 1).toUpperCase()}
                    </div>
                  ) : (
                    <div className="flex size-8.5 items-center justify-center rounded-xl bg-muted text-muted-foreground border border-border">
                      <Hash className="size-4" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">{activeSpace.name}</h2>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 font-normal">
                        {activeSpace.type === "DIRECT_MESSAGE" ? "Direct Message" : "Space"}
                      </Badge>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      Google Chat · {activeSpace.type === "DIRECT_MESSAGE" ? "1-on-1 direct message" : "Team space"}
                    </p>
                  </div>
                </div>

                {activeSpace.spaceUri && (
                  <a
                    href={activeSpace.spaceUri}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                    <span>Open in Google Chat</span>
                  </a>
                )}
              </header>

              {/* Messages feed */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                {messagesLoading && messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Loading messages...
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
                      <div className="space-y-3">
                        {group.messages.map((msg) => {
                          const isSelf =
                            Boolean(msg.sender.isSelf) ||
                            msg.sender.name === "users/me" ||
                            msg.sender.displayName?.toLowerCase() === "you" ||
                            msg.sender.displayName?.toLowerCase() === "me" ||
                            (Boolean(currentUserEmail) && msg.sender.email?.toLowerCase() === currentUserEmail) ||
                            (Boolean(currentUserName) && msg.sender.displayName?.toLowerCase() === currentUserName);

                          return (
                            <div
                              key={msg.id}
                              className={`flex items-start gap-3 w-full ${isSelf ? "flex-row-reverse" : "flex-row"}`}
                            >
                              <Avatar className="size-8 shrink-0 mt-0.5">
                                {msg.sender.avatarUrl ? (
                                  <AvatarImage src={msg.sender.avatarUrl} alt="" />
                                ) : null}
                                <AvatarFallback
                                  className={`text-[11px] font-medium ${
                                    isSelf ? "bg-primary/20 text-primary" : "bg-muted text-foreground"
                                  }`}
                                >
                                  {isSelf ? "YO" : (msg.sender.displayName || "User").slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>

                              <div className={`max-w-[75%] ${isSelf ? "items-end" : "items-start"} flex flex-col`}>
                                <div className={`flex items-center gap-2 px-1 mb-1 ${isSelf ? "flex-row-reverse" : "flex-row"}`}>
                                  <span className="text-[11px] font-medium text-foreground">
                                    {isSelf ? "You" : msg.sender.displayName}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatChatTime(msg.createTime)}
                                  </span>
                                </div>

                                <div
                                  className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap wrap-break-word text-left ${
                                    isSelf
                                      ? "bg-primary text-primary-foreground rounded-tr-xs"
                                      : "bg-muted text-foreground rounded-tl-xs"
                                  }`}
                                >
                                  {msg.text}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message composer input */}
              <div className="border-t border-border p-4 bg-background">
                <form onSubmit={handleSendMessage} className="relative flex items-end gap-2">
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${activeSpace.name}... (Press Enter to send)`}
                    rows={1}
                    className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-input bg-muted/40 px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!messageText.trim() || sendMutation.isPending}
                    className="size-10 shrink-0 rounded-xl"
                    title="Send message"
                  >
                    <Send className="size-4" />
                  </Button>
                </form>
              </div>
            </>
          ) : (
            /* Empty state matching Image 2 */
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground p-6">
              <div className="rounded-2xl border border-border bg-muted/30 p-6">
                <MessageSquare className="size-10 text-primary/70" />
              </div>
              <h2 className="text-base font-semibold text-foreground">No conversation selected</h2>
              <p className="max-w-xs text-xs text-muted-foreground">
                Select a conversation from the list or start a new chat with a contact or space.
              </p>
              <Button onClick={() => setNewChatOpen(true)} className="mt-2 gap-2 text-xs">
                <Plus className="size-4" />
                Start a conversation
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* New Chat / Create Space Dialog */}
      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Google Chat</DialogTitle>
            <DialogDescription>
              Start a direct message with a contact or create a new space.
            </DialogDescription>
          </DialogHeader>

          {/* Toggle DM vs Space */}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setNewChatType("DIRECT_MESSAGE")}
              className={`flex items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium transition-colors ${
                newChatType === "DIRECT_MESSAGE" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
              }`}
            >
              <User className="size-3.5" />
              Direct Message
            </button>
            <button
              type="button"
              onClick={() => setNewChatType("SPACE")}
              className={`flex items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium transition-colors ${
                newChatType === "SPACE" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
              }`}
            >
              <Users className="size-3.5" />
              Create Space
            </button>
          </div>

          {newChatType === "DIRECT_MESSAGE" ? (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Search contact</label>
                <Input
                  type="text"
                  placeholder="Type a name or email address..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="text-xs"
                />
              </div>

              {/* Contacts list */}
              <div className="max-h-48 overflow-y-auto divide-y divide-border rounded-md border border-border">
                {contacts.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">
                    {contactSearch ? "No contacts found" : "Type to search contacts"}
                  </div>
                ) : (
                  contacts.map((contact) => {
                    const isSelected = selectedContact?.email === contact.email;
                    return (
                      <button
                        key={contact.email}
                        type="button"
                        onClick={() => setSelectedContact(contact)}
                        className={`flex w-full items-center justify-between p-2.5 text-left text-xs transition-colors ${
                          isSelected ? "bg-sidebar-accent font-medium" : "hover:bg-muted"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{contact.name || contact.email}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{contact.email}</p>
                        </div>
                        {isSelected && <Check className="size-4 text-primary shrink-0 ml-2" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Space Name</label>
                <Input
                  type="text"
                  placeholder="e.g. Announcements, Engineering, Design..."
                  value={newSpaceName}
                  onChange={(e) => setNewSpaceName(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewChatOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleCreateSpace}
              disabled={
                newChatType === "SPACE"
                  ? !newSpaceName.trim()
                  : !selectedContact
              }
              className="text-xs"
            >
              {newChatType === "SPACE" ? "Create Space" : "Start Chat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
