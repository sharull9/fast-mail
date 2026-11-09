import { useState, useEffect, useMemo } from "react";
import { createFileRoute, Link, useNavigate, useRouterState, Outlet } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Users,
  Plus,
  Search,
  ArrowLeft,
  Hash,
  User,
  Check,
} from "lucide-react";
import { chatSpacesQuery } from "@/lib/data";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Contact } from "@mailfast/shared";
import { getAvatarStyle, formatChatListTime } from "@/components/chat/chat-helpers";
import { resetLivePreviewWorkspace } from "@/hooks/use-preview-workspace";

export const Route = createFileRoute("/chat")({
  component: ChatLayout,
});

function ChatLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
      const cleanId = created.id.replace(/^spaces\//, "");
      void navigate({ to: "/chat/spaces/$id", params: { id: cleanId } });
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
      const cleanId = created.id.replace(/^spaces\//, "");
      void navigate({ to: "/chat/direct/$id", params: { id: cleanId } });
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
        const matchesSnippet = s.lastMessageSnippet?.toLowerCase().includes(q);
        return matchesName || matchesSnippet;
      }
      return true;
    });
  }, [spaces, activeTab, unreadOnly, searchQuery]);

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
                onClick={() => {
                  resetLivePreviewWorkspace();
                }}
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
                    activeTab === "DIRECT_MESSAGE"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
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
                <span className={`size-2 rounded-full ${unreadOnly ? "bg-primary" : "bg-muted-foreground/40"}`} />
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
                const isDm = space.type === "DIRECT_MESSAGE";
                const cleanId = space.id.replace(/^spaces\//, "");
                const isSelected =
                  pathname === `/chat/direct/${cleanId}` ||
                  pathname === `/chat/spaces/${cleanId}` ||
                  pathname.startsWith(`/chat/direct/${cleanId}/`) ||
                  pathname.startsWith(`/chat/spaces/${cleanId}/`);
                const avatarStyle = getAvatarStyle(space.name);

                return (
                  <button
                    key={space.id}
                    onClick={() => {
                      if (isDm) {
                        void navigate({ to: "/chat/direct/$id", params: { id: cleanId } });
                      } else {
                        void navigate({ to: "/chat/spaces/$id", params: { id: cleanId } });
                      }
                    }}
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

        {/* Right panel: Active Conversation View rendered via Outlet */}
        <Outlet />
      </div>

      {/* New Chat / Create Space Dialog */}
      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Google Chat</DialogTitle>
            <DialogDescription>Start a direct message with a contact or create a new space.</DialogDescription>
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
              disabled={newChatType === "SPACE" ? !newSpaceName.trim() : !selectedContact}
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
