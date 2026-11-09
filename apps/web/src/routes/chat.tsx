import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
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
  Quote,
  CornerDownRight,
  Video,
  Mail,
  Calendar,
  X,
  AtSign,
  FileText,
  MessageSquareText,
  Table,
  Presentation,
  HardDrive,
  MapPin,
  Play,
  CheckSquare,
  Copy,
  FileCode,
  FolderArchive,
  Download,
} from "lucide-react";
import { chatSpacesQuery, chatMessagesQuery, authQuery } from "@/lib/data";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ChatMessage, Contact, QuotedMessage } from "@mailfast/shared";

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

function MentionChip({
  name,
  targetEmail,
  isSelf,
  onOpenDm,
}: {
  name: string;
  targetEmail?: string;
  isSelf?: boolean;
  onOpenDm?: (name: string, email?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const cleanName = name.startsWith("@") ? name.slice(1).trim() : name.trim();
  const email = targetEmail || `${cleanName.toLowerCase().replace(/\s+/g, ".")}@example.com`;
  const avatarStyle = getAvatarStyle(cleanName);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold cursor-pointer transition-colors ${
            isSelf
              ? "bg-white/25 text-white hover:bg-white/35"
              : "bg-primary/15 text-primary hover:bg-primary/25"
          }`}
        >
          <span>@{cleanName}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 overflow-hidden shadow-xl border border-border" align="start">
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-4 pb-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className={`flex size-12 items-center justify-center rounded-full text-sm font-semibold border-2 border-background shadow-xs ${avatarStyle}`}>
              {cleanName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-foreground truncate">{cleanName}</div>
              <div className="text-xs text-muted-foreground truncate">{email}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-muted-foreground">Active in Google Chat</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1 p-2 bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            className="flex flex-col items-center gap-1 h-auto py-2 px-1 text-[11px]"
            onClick={() => {
              setOpen(false);
              onOpenDm?.(cleanName, email);
            }}
            title="Direct Message"
          >
            <MessageSquare className="size-4 text-primary" />
            <span>Chat</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex flex-col items-center gap-1 h-auto py-2 px-1 text-[11px]"
            onClick={() => {
              setOpen(false);
              window.open(`mailto:${email}`, "_blank");
            }}
            title="Send Email"
          >
            <Mail className="size-4 text-blue-500" />
            <span>Email</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex flex-col items-center gap-1 h-auto py-2 px-1 text-[11px]"
            onClick={() => {
              setOpen(false);
              window.open("https://meet.google.com/new", "_blank");
            }}
            title="Start Google Meet"
          >
            <Video className="size-4 text-amber-500" />
            <span>Meet</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex flex-col items-center gap-1 h-auto py-2 px-1 text-[11px]"
            onClick={() => {
              setOpen(false);
              window.open("https://calendar.google.com", "_blank");
            }}
            title="Schedule on Calendar"
          >
            <Calendar className="size-4 text-emerald-500" />
            <span>Calendar</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface GoogleServiceItem {
  type: "docs" | "sheets" | "slides" | "forms" | "drive" | "meet" | "calendar" | "maps" | "youtube";
  url: string;
  title: string;
  badge: string;
  domain: string;
  id?: string;
}

function parseGoogleService(
  url: string,
  contextTitle?: string,
  fullText?: string,
  matchingAttachment?: NonNullable<ChatMessage["attachments"]>[number],
): GoogleServiceItem | null {
  let title = matchingAttachment?.contentName || contextTitle;
  if (!title && fullText) {
    const headingMatch = fullText.match(/^#+\s+([^\n]+)/m);
    if (headingMatch?.[1]) {
      title = headingMatch[1].trim();
    }
  }

  // 1. Google Docs
  if (url.includes("docs.google.com/document")) {
    const idMatch = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    return {
      type: "docs",
      url,
      title: title || "Google Document",
      badge: "Google Docs",
      domain: "docs.google.com",
      id: idMatch?.[1],
    };
  }

  // 2. Google Sheets
  if (url.includes("docs.google.com/spreadsheets")) {
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return {
      type: "sheets",
      url,
      title: title || "Google Spreadsheet",
      badge: "Google Sheets",
      domain: "docs.google.com",
      id: idMatch?.[1],
    };
  }

  // 3. Google Slides
  if (url.includes("docs.google.com/presentation")) {
    const idMatch = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
    return {
      type: "slides",
      url,
      title: title || "Google Slides Presentation",
      badge: "Google Slides",
      domain: "docs.google.com",
      id: idMatch?.[1],
    };
  }

  // 4. Google Forms
  if (url.includes("docs.google.com/forms")) {
    const idMatch = url.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
    return {
      type: "forms",
      url,
      title: title || "Google Form",
      badge: "Google Forms",
      domain: "docs.google.com",
      id: idMatch?.[1],
    };
  }

  // 5. Google Drive
  if (url.includes("drive.google.com")) {
    const isFolder = url.includes("/folders/");
    return {
      type: "drive",
      url,
      title: title || (isFolder ? "Google Drive Folder" : "Google Drive File"),
      badge: "Google Drive",
      domain: "drive.google.com",
    };
  }

  // 6. Google Meet
  if (url.includes("meet.google.com")) {
    const codeMatch = url.match(/meet\.google\.com\/([a-zA-Z0-9-]+)/);
    return {
      type: "meet",
      url,
      title: title || (codeMatch ? `Video meeting (${codeMatch[1]})` : "Google Meet Video Call"),
      badge: "Google Meet",
      domain: "meet.google.com",
    };
  }

  // 7. Google Calendar
  if (url.includes("calendar.google.com")) {
    return {
      type: "calendar",
      url,
      title: title || "Google Calendar Event",
      badge: "Google Calendar",
      domain: "calendar.google.com",
    };
  }

  // 8. Google Maps
  if (url.includes("google.com/maps") || url.includes("maps.google.com") || url.includes("maps.app.goo.gl")) {
    return {
      type: "maps",
      url,
      title: title || "Google Maps Location",
      badge: "Google Maps",
      domain: "maps.google.com",
    };
  }

  // 9. YouTube
  if (url.includes("youtube.com/watch") || url.includes("youtu.be/")) {
    const vMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return {
      type: "youtube",
      url,
      title: title || "YouTube Video",
      badge: "YouTube",
      domain: "youtube.com",
      id: vMatch?.[1],
    };
  }

  return null;
}

function detectGoogleServices(
  text: string,
  attachments?: ChatMessage["attachments"],
): { items: GoogleServiceItem[]; consumedAttachments: Set<number> } {
  const items: GoogleServiceItem[] = [];
  const seenUrls = new Set<string>();
  const consumedAttachments = new Set<number>();

  const checkAndAdd = (url: string, contextTitle?: string) => {
    if (!url || seenUrls.has(url)) return;

    let matchedAtt: NonNullable<ChatMessage["attachments"]>[number] | undefined;
    let matchedIdx = -1;
    if (attachments) {
      matchedIdx = attachments.findIndex((att) => {
        if (!att.downloadUri && !att.contentName) return false;
        if (att.downloadUri && (att.downloadUri === url || url.includes(att.downloadUri) || att.downloadUri.includes(url))) {
          return true;
        }
        const idMatch = url.match(/\/(?:d|spreadsheets\/d|document\/d|presentation\/d|forms\/d)\/([a-zA-Z0-9_-]+)/);
        if (idMatch && att.downloadUri && att.downloadUri.includes(idMatch[1]!)) {
          return true;
        }
        return false;
      });
      if (matchedIdx >= 0) {
        matchedAtt = attachments[matchedIdx];
      }
    }

    const item = parseGoogleService(url, contextTitle, text, matchedAtt);
    if (item) {
      items.push(item);
      seenUrls.add(url);
      if (matchedIdx >= 0) {
        consumedAttachments.add(matchedIdx);
      }
    }
  };

  // 1. Extract explicit markdown links first: [title](url)
  const mdRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m: RegExpExecArray | null;

  while ((m = mdRegex.exec(text)) !== null) {
    checkAndAdd(m[2]!.trim(), m[1]!.trim());
  }

  // 2. Next extract plain URLs
  const urlRegex = /(https?:\/\/[^\s<>)"]+)/g;
  while ((m = urlRegex.exec(text)) !== null) {
    checkAndAdd(m[1]!.trim());
  }

  // 3. Attachments that are Google Docs / Sheets / Slides / Drive
  if (attachments) {
    attachments.forEach((att, idx) => {
      if (consumedAttachments.has(idx)) return;
      if (
        att.contentType?.startsWith("application/vnd.google-apps") ||
        (att.downloadUri && (att.downloadUri.includes("docs.google.com") || att.downloadUri.includes("drive.google.com")))
      ) {
        const url = att.downloadUri || "";
        if (url && !seenUrls.has(url)) {
          const item = parseGoogleService(url, att.contentName, undefined, att);
          if (item) {
            items.push(item);
            seenUrls.add(url);
            consumedAttachments.add(idx);
          }
        }
      }
    });
  }

  return { items, consumedAttachments };
}

function getGoogleBrandStyles(type: GoogleServiceItem["type"]) {
  switch (type) {
    case "docs":
      return {
        bg: "bg-blue-500/10 dark:bg-blue-500/20",
        text: "text-blue-600 dark:text-blue-400",
        border: "border-blue-500/30",
        icon: <FileText className="size-5" />,
      };
    case "sheets":
      return {
        bg: "bg-emerald-500/10 dark:bg-emerald-500/20",
        text: "text-emerald-600 dark:text-emerald-400",
        border: "border-emerald-500/30",
        icon: <Table className="size-5" />,
      };
    case "slides":
      return {
        bg: "bg-amber-500/10 dark:bg-amber-500/20",
        text: "text-amber-600 dark:text-amber-400",
        border: "border-amber-500/30",
        icon: <Presentation className="size-5" />,
      };
    case "forms":
      return {
        bg: "bg-purple-500/10 dark:bg-purple-500/20",
        text: "text-purple-600 dark:text-purple-400",
        border: "border-purple-500/30",
        icon: <CheckSquare className="size-5" />,
      };
    case "drive":
      return {
        bg: "bg-sky-500/10 dark:bg-sky-500/20",
        text: "text-sky-600 dark:text-sky-400",
        border: "border-sky-500/30",
        icon: <HardDrive className="size-5" />,
      };
    case "calendar":
      return {
        bg: "bg-indigo-500/10 dark:bg-indigo-500/20",
        text: "text-indigo-600 dark:text-indigo-400",
        border: "border-indigo-500/30",
        icon: <Calendar className="size-5" />,
      };
    case "maps":
      return {
        bg: "bg-rose-500/10 dark:bg-rose-500/20",
        text: "text-rose-600 dark:text-rose-400",
        border: "border-rose-500/30",
        icon: <MapPin className="size-5" />,
      };
    default:
      return {
        bg: "bg-primary/10",
        text: "text-primary",
        border: "border-primary/30",
        icon: <ExternalLink className="size-5" />,
      };
  }
}

function GoogleServiceCard({ service }: { service: GoogleServiceItem }) {
  if (service.type === "meet") {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          window.open(service.url, "_blank");
        }}
        className="overflow-hidden rounded-2xl border border-amber-300/40 dark:border-amber-700/50 bg-card max-w-sm shadow-xs cursor-pointer group transition-transform hover:scale-[1.01]"
      >
        <div className="bg-[#FBBC04] px-6 py-5 flex items-center justify-center relative select-none">
          <div className="flex items-center gap-4 text-amber-950">
            <svg className="size-12 drop-shadow-xs" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 24h24v16a12 12 0 0 1-24 0V24z" fill="#FFF9C4" />
              <path d="M40 28h6a4 4 0 0 1 0 8h-6" />
              <path d="M22 16c0-2 2-3 2-5" />
              <path d="M28 16c0-2 2-3 2-5" />
              <path d="M34 16c0-2 2-3 2-5" />
            </svg>
            <div className="rounded-xl border-2 border-amber-950 bg-white/90 p-2.5 shadow-sm">
              <Video className="size-7 text-amber-950" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-amber-300/40 dark:border-amber-800/40 bg-card px-4 py-3 group-hover:bg-muted/70 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
              <Video className="size-4" />
            </div>
            <span className="font-semibold text-xs text-foreground">Join video meeting</span>
          </div>
          <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </div>
    );
  }

  if (service.type === "youtube") {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          window.open(service.url, "_blank");
        }}
        className="overflow-hidden rounded-xl border border-border/80 bg-card max-w-sm shadow-xs cursor-pointer group transition-transform hover:scale-[1.01]"
      >
        {service.id && (
          <div className="relative aspect-video w-full bg-black/80 overflow-hidden">
            <img
              src={`https://img.youtube.com/vi/${service.id}/hqdefault.jpg`}
              alt="YouTube Thumbnail"
              className="size-full object-cover group-hover:scale-105 transition-transform duration-200"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/10 transition-colors">
              <div className="flex size-11 items-center justify-center rounded-full bg-red-600 text-white shadow-lg">
                <Play className="size-5 fill-white ml-0.5" />
              </div>
            </div>
          </div>
        )}
        <div className="p-3 flex items-center justify-between">
          <div className="min-w-0 flex-1 pr-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-600">YouTube</span>
            <div className="truncate text-xs font-semibold text-foreground mt-0.5">{service.title}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">youtube.com</div>
          </div>
          <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground" />
        </div>
      </div>
    );
  }

  // Docs, Sheets, Slides, Forms, Drive, Calendar, Maps
  const brand = getGoogleBrandStyles(service.type);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        window.open(service.url, "_blank");
      }}
      className="overflow-hidden rounded-xl border border-border/80 bg-card hover:bg-muted/50 p-3 max-w-sm shadow-xs cursor-pointer group transition-all hover:scale-[1.01]"
    >
      <div className="flex items-start gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${brand.bg} ${brand.text} border ${brand.border} shadow-xs`}>
          {brand.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${brand.text}`}>
              {service.badge}
            </span>
          </div>
          <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
            {service.title}
          </div>
          <div className="truncate text-[10px] text-muted-foreground mt-0.5">
            {service.domain}
          </div>
        </div>
        <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 mt-0.5" />
      </div>
    </div>
  );
}

function getFileTypeInfo(name?: string, contentType?: string) {
  const fileName = (name || "").toLowerCase();
  const mime = (contentType || "").toLowerCase();

  // 1. Postman Collection
  if (fileName.includes("postman_collection") || fileName.endsWith(".postman_collection.json")) {
    return {
      label: "Postman Collection",
      bg: "bg-orange-500/15 dark:bg-orange-500/25",
      text: "text-orange-600 dark:text-orange-400",
      border: "border-orange-500/30",
      icon: <FileCode className="size-5" />,
    };
  }

  // 2. JSON File
  if (fileName.endsWith(".json") || mime === "application/json") {
    return {
      label: "JSON File",
      bg: "bg-amber-500/15 dark:bg-amber-500/25",
      text: "text-amber-600 dark:text-amber-400",
      border: "border-amber-500/30",
      icon: <FileCode className="size-5" />,
    };
  }

  // 3. TypeScript
  if (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) {
    return {
      label: "TypeScript",
      bg: "bg-blue-500/15 dark:bg-blue-500/25",
      text: "text-blue-600 dark:text-blue-400",
      border: "border-blue-500/30",
      icon: <FileCode className="size-5" />,
    };
  }

  // 4. JavaScript
  if (fileName.endsWith(".js") || fileName.endsWith(".jsx")) {
    return {
      label: "JavaScript",
      bg: "bg-yellow-500/15 dark:bg-yellow-500/25",
      text: "text-yellow-600 dark:text-yellow-400",
      border: "border-yellow-500/30",
      icon: <FileCode className="size-5" />,
    };
  }

  // 5. PDF Document
  if (fileName.endsWith(".pdf") || mime === "application/pdf") {
    return {
      label: "PDF Document",
      bg: "bg-red-500/15 dark:bg-red-500/25",
      text: "text-red-600 dark:text-red-400",
      border: "border-red-500/30",
      icon: <FileText className="size-5" />,
    };
  }

  // 6. Spreadsheets
  if (
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls") ||
    fileName.endsWith(".csv") ||
    mime.includes("spreadsheet") ||
    mime.includes("csv")
  ) {
    return {
      label: "Spreadsheet",
      bg: "bg-emerald-500/15 dark:bg-emerald-500/25",
      text: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-500/30",
      icon: <Table className="size-5" />,
    };
  }

  // 7. Word Documents
  if (fileName.endsWith(".docx") || fileName.endsWith(".doc")) {
    return {
      label: "Word Document",
      bg: "bg-sky-500/15 dark:bg-sky-500/25",
      text: "text-sky-600 dark:text-sky-400",
      border: "border-sky-500/30",
      icon: <FileText className="size-5" />,
    };
  }

  // 8. Archives
  if (
    fileName.endsWith(".zip") ||
    fileName.endsWith(".tar") ||
    fileName.endsWith(".gz") ||
    fileName.endsWith(".rar") ||
    fileName.endsWith(".7z") ||
    mime.includes("zip") ||
    mime.includes("archive") ||
    mime.includes("compressed")
  ) {
    return {
      label: "Archive",
      bg: "bg-purple-500/15 dark:bg-purple-500/25",
      text: "text-purple-600 dark:text-purple-400",
      border: "border-purple-500/30",
      icon: <FolderArchive className="size-5" />,
    };
  }

  // Default fallback
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toUpperCase() : "FILE";
  return {
    label: ext || "FILE",
    bg: "bg-primary/10 dark:bg-primary/20",
    text: "text-primary",
    border: "border-primary/30",
    icon: <FileText className="size-5" />,
  };
}

function RenderMessageText({
  text,
  services,
  isSelf,
  onOpenDm,
}: {
  text: string;
  services?: GoogleServiceItem[];
  isSelf?: boolean;
  onOpenDm?: (name: string, email?: string) => void;
}) {
  if (!text) return null;

  // Use provided services or detect directly
  const googleServices = services ?? detectGoogleServices(text).items;

  // Parse markdown headings, markdown links, mentions, and plain URLs
  const renderRichText = (raw: string) => {
    // Regex for mentions (@Name), markdown links [label](url), and raw URLs
    const tokenRegex = /(@[A-Za-z0-9_]+(?:\s+[A-Za-z0-9_]+)?|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>)"]+)/g;
    const tokens = raw.split(tokenRegex);

    return tokens.map((token, idx) => {
      if (token.startsWith("@") && token.length > 2) {
        return (
          <MentionChip
            key={idx}
            name={token}
            isSelf={isSelf}
            onOpenDm={onOpenDm}
          />
        );
      }
      const mdLinkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (mdLinkMatch) {
        return (
          <a
            key={idx}
            href={mdLinkMatch[2]}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 font-medium opacity-95 hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {mdLinkMatch[1]}
          </a>
        );
      }
      if (token.startsWith("http://") || token.startsWith("https://")) {
        return (
          <a
            key={idx}
            href={token}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 break-all opacity-95 hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {token}
          </a>
        );
      }
      return <span key={idx}>{token}</span>;
    });
  };

  const lines = text.split("\n");

  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
        {lines.map((line, lineIdx) => {
          const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
          if (headingMatch) {
            return (
              <div key={lineIdx} className="font-bold text-sm text-foreground my-1">
                {renderRichText(headingMatch[2]!)}
              </div>
            );
          }
          return (
            <div key={lineIdx}>
              {renderRichText(line)}
            </div>
          );
        })}
      </div>

      {/* Render Google Workspace Preview Cards */}
      {googleServices.length > 0 && (
        <div className="space-y-2 pt-1">
          {googleServices.map((service, idx) => (
            <GoogleServiceCard key={idx} service={service} />
          ))}
        </div>
      )}
    </div>
  );
}

function RenderAttachments({
  attachments,
  consumedIndices,
}: {
  attachments?: ChatMessage["attachments"];
  consumedIndices?: Set<number>;
}) {
  if (!attachments || attachments.length === 0) return null;

  const validAttachments = attachments
    .map((att, idx) => ({ att, idx }))
    .filter(({ idx }) => !consumedIndices?.has(idx));

  if (validAttachments.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {validAttachments.map(({ att, idx }) => {
        const isImage = Boolean(
          (att.contentType?.startsWith("image/") ||
            att.contentName?.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i) ||
            att.downloadUri?.startsWith("data:image/")) &&
            !att.contentName?.match(
              /\.(json|ts|tsx|js|jsx|pdf|zip|rar|tar|gz|7z|csv|xlsx?|docx?|pptx?|txt|md|html?|css|sh|py)$/i,
            ),
        );

        const mediaSrc = att.downloadUri?.startsWith("data:")
          ? att.downloadUri
          : `/api/chat/media?url=${encodeURIComponent(att.downloadUri || att.thumbnailUri || "")}`;

        if (isImage) {
          return (
            <div
              key={idx}
              className="overflow-hidden rounded-xl border border-border/60 bg-muted/20 shadow-xs max-w-md group"
            >
              <img
                src={mediaSrc}
                alt={att.contentName || "Image preview"}
                className="max-h-80 w-full object-contain bg-background/50 hover:opacity-95 cursor-pointer transition-opacity"
                onClick={() => window.open(att.downloadUri || att.thumbnailUri || mediaSrc, "_blank")}
                loading="lazy"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (att.thumbnailUri && target.src !== att.thumbnailUri) {
                    target.src = att.thumbnailUri;
                  }
                }}
              />
              {att.contentName && (
                <div className="px-3 py-1.5 text-[11px] text-muted-foreground truncate border-t border-border/30 bg-background/50 flex items-center justify-between">
                  <span className="truncate">{att.contentName}</span>
                  <ExternalLink className="size-3 shrink-0 ml-2 opacity-60 group-hover:opacity-100" />
                </div>
              )}
            </div>
          );
        }

        const typeInfo = getFileTypeInfo(att.contentName, att.contentType);

        return (
          <div
            key={idx}
            className="flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3 max-w-sm hover:bg-muted/60 cursor-pointer group transition-all hover:scale-[1.01] shadow-xs"
            onClick={() => window.open(att.downloadUri || att.thumbnailUri, "_blank")}
          >
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${typeInfo.bg} ${typeInfo.text} border ${typeInfo.border} shadow-xs`}
            >
              {typeInfo.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${typeInfo.text}`}>
                  {typeInfo.label}
                </span>
              </div>
              <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                {att.contentName || "File attachment"}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {att.contentType || "Attachment"}
              </div>
            </div>
            <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground shrink-0 mt-0.5 transition-colors" />
          </div>
        );
      })}
    </div>
  );
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
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef<Record<string, boolean>>({});
  const lastSpaceIdRef = useRef<string | null>(null);

  // Instantly scroll to bottom when opening a chat or when messages first load
  useLayoutEffect(() => {
    if (!activeSpaceId || messages.length === 0) return;

    const container = messagesContainerRef.current;
    const isNewSpace = lastSpaceIdRef.current !== activeSpaceId;
    const hasInitialScrolled = initialScrollDoneRef.current[activeSpaceId];

    if (isNewSpace || !hasInitialScrolled) {
      lastSpaceIdRef.current = activeSpaceId;
      initialScrollDoneRef.current[activeSpaceId] = true;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    } else {
      // For subsequent messages arriving while already viewing the chat
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, activeSpaceId]);

  // Replying state (quote reply)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  // Thread state
  const [threadParent, setThreadParent] = useState<ChatMessage | null>(null);
  const [threadReplyText, setThreadReplyText] = useState("");

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
          m.name === targetNameOrId ||
          (m.name && targetNameOrId && m.name.endsWith(targetNameOrId)) ||
          (m.id && targetNameOrId && targetNameOrId.endsWith(m.id)),
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
    if (!map.has("arafat ulla")) map.set("arafat ulla", { displayName: "Arafat ulla", email: "arafat@info.com" });
    if (!map.has("kapil kumar")) map.set("kapil kumar", { displayName: "Kapil Kumar", email: "kapil@info.com" });
    if (!map.has("hemant agaarwal")) map.set("hemant agaarwal", { displayName: "hemant agaarwal", email: "hemant@info.com" });
    if (!map.has("nikhil thakur")) map.set("nikhil thakur", { displayName: "Nikhil Thakur", email: "nikhil@info.com" });
    return Array.from(map.values());
  }, [messages, spaces]);

  const filteredMentionCandidates = useMemo(() => {
    if (!mentionFilter) return mentionCandidates.slice(0, 6);
    return mentionCandidates
      .filter((c) => c.displayName.toLowerCase().includes(mentionFilter))
      .slice(0, 6);
  }, [mentionCandidates, mentionFilter]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageText(val);

    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_\s]*)$/);
    if (match) {
      setShowMentionMenu(true);
      setMentionFilter(match[1]!.toLowerCase());
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
      void navigate({ to: "/chat", search: { space: existing.id } });
    } else {
      try {
        const created = await api.createChatSpace({
          displayName: name,
          spaceType: "DIRECT_MESSAGE",
          email,
        });
        void queryClient.invalidateQueries({ queryKey: ["chat-spaces"] });
        void navigate({ to: "/chat", search: { space: created.id } });
      } catch {
        // ignore
      }
    }
  };

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async ({
      text,
      threadId,
      quotedMessage,
    }: {
      text: string;
      threadId?: string;
      quotedMessage?: QuotedMessage;
    }) => {
      if (!activeSpaceId) throw new Error("No space selected");
      return api.sendChatMessage(activeSpaceId, text, threadId, quotedMessage);
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
    sendMutation.mutate({ text, quotedMessage: quote });
  };

  const handleSendThreadReply = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = threadReplyText.trim();
    if (!text || !threadParent || sendMutation.isPending) return;
    const threadId = threadParent.threadId || threadParent.id;
    setThreadReplyText("");
    sendMutation.mutate({ text, threadId });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const threadReplies = useMemo(() => {
    if (!threadParent) return [];
    const tId = threadParent.threadId || threadParent.id;
    return messages.filter(
      (m) => m.id !== threadParent.id && (m.threadId === tId || m.threadId === threadParent.id),
    );
  }, [messages, threadParent]);

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
        <div className="flex flex-1 flex-col overflow-hidden min-w-0 bg-background">
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
              <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 space-y-6">
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

                          const sanitizedId = msg.id.replace(/[^a-zA-Z0-9_-]/g, "_");
                          const isHighlighted =
                            highlightedMsgId === msg.id ||
                            highlightedMsgId === msg.name ||
                            (highlightedMsgId && (highlightedMsgId.endsWith(msg.id) || msg.id.endsWith(highlightedMsgId)));

                          const googleServiceResult = detectGoogleServices(msg.text || "", msg.attachments);

                          const dynamicReplyCount = Math.max(
                            msg.threadReplyCount || 0,
                            threadReplyCounts.get(msg.id) ||
                              (msg.threadId ? threadReplyCounts.get(msg.threadId) || 0 : 0),
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
                              className={`group relative flex items-start gap-3 w-full min-w-0 transition-all duration-300 rounded-xl p-1 ${
                                isHighlighted ? "bg-primary/15 ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                              } ${isSelf ? "flex-row-reverse" : "flex-row"}`}
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

                              <div className={`max-w-[85%] sm:max-w-[75%] md:max-w-[65%] min-w-0 flex flex-col ${isSelf ? "items-end ml-auto" : "items-start mr-auto"}`}>
                                <div className={`flex items-center gap-2 px-1 mb-1 ${isSelf ? "flex-row-reverse" : "flex-row"}`}>
                                  <span className="text-[11px] font-medium text-foreground">
                                    {isSelf ? "You" : msg.sender.displayName}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatChatTime(msg.createTime)}
                                  </span>
                                </div>

                                {/* Message Bubble: shrink-to-fit width, word break all to avoid clipping */}
                                <div
                                  className={`w-fit max-w-full rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-all [overflow-wrap:anywhere] text-left select-text relative shadow-xs ${
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
                                      className={`mb-2 rounded-lg border-l-2 border-primary/70 px-3 py-1.5 text-xs text-left cursor-pointer transition-all hover:scale-[1.01] ${
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
                                      <div className="truncate text-[12px] opacity-80 mt-0.5">
                                        {msg.quotedMessage.text}
                                      </div>
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
                                </div>

                                {/* Thread indicator button */}
                                {dynamicReplyCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setThreadParent(msg)}
                                    className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                                      hasActiveThread
                                        ? "bg-primary text-primary-foreground shadow-xs"
                                        : "bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
                                    }`}
                                    title="View thread replies"
                                  >
                                    <MessageSquareText className="size-3" />
                                    <span>{dynamicReplyCount} {dynamicReplyCount === 1 ? "reply" : "replies"}</span>
                                  </button>
                                )}
                              </div>

                              {/* Hover Action Toolbar */}
                              <div
                                className={`opacity-0 group-hover:opacity-100 transition-opacity absolute top-0 ${
                                  isSelf ? "left-0 -translate-x-full pr-2" : "right-0 translate-x-full pl-2"
                                } flex items-center gap-1 z-10`}
                              >
                                <div className="flex items-center gap-0.5 rounded-full border border-border bg-background/95 backdrop-blur-xs px-1.5 py-0.5 shadow-md">
                                  <button
                                    type="button"
                                    onClick={() => handleCopyMessage(msg)}
                                    className="p-1 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                    title={copiedMsgId === msg.id ? "Copied!" : "Copy message"}
                                  >
                                    {copiedMsgId === msg.id ? (
                                      <Check className="size-3.5 text-emerald-500" />
                                    ) : (
                                      <Copy className="size-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setReplyingTo(msg)}
                                    className="p-1 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                    title="Quote in reply"
                                  >
                                    <Quote className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setThreadParent(msg)}
                                    className={`p-1 hover:bg-muted rounded-full transition-colors ${
                                      hasActiveThread ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
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
                <div ref={messagesEndRef} />
              </div>

              {/* Message composer input */}
              <div className="border-t border-border p-4 bg-background relative">
                {/* Mention Autocomplete Menu */}
                {showMentionMenu && filteredMentionCandidates.length > 0 && (
                  <div className="absolute bottom-full left-4 mb-2 w-64 rounded-xl border border-border bg-popover p-1 shadow-lg z-50 animate-in fade-in-0 zoom-in-95">
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Mention Member
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {filteredMentionCandidates.map((c) => (
                        <button
                          key={c.displayName}
                          type="button"
                          onClick={() => handleSelectMention(c)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted transition-colors"
                        >
                          <div className={`flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ${getAvatarStyle(c.displayName)}`}>
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
                  <div className="flex items-center justify-between rounded-t-xl border border-b-0 border-border bg-muted/60 px-3 py-2 text-xs">
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
                      placeholder={`Message ${activeSpace.name}... (Press Enter to send, @ to mention)`}
                      rows={1}
                      className={`max-h-32 min-h-10 w-full resize-none border border-input bg-muted/40 px-3.5 py-2.5 pr-10 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
                        replyingTo ? "rounded-b-xl border-t-0" : "rounded-xl"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setMessageText((prev) => `${prev}@`);
                        setShowMentionMenu(true);
                        setMentionFilter("");
                        textareaRef.current?.focus();
                      }}
                      className="absolute right-2.5 bottom-2.5 text-muted-foreground hover:text-foreground transition-colors"
                      title="Mention someone"
                    >
                      <AtSign className="size-4" />
                    </button>
                  </div>

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

              {/* Thread Panel Drawer on right */}
              {threadParent && (
                <div className="absolute top-0 right-0 w-80 sm:w-96 z-20 border-l border-border bg-sidebar/95 backdrop-blur-md flex flex-col h-full shadow-2xl animate-in slide-in-from-right duration-200">
                  <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <MessageSquareText className="size-4 text-primary" />
                      <span>Thread</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-7 p-0"
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
                      <p className="text-xs text-foreground whitespace-pre-wrap mt-1">{threadParent.text}</p>
                      <RenderAttachments attachments={threadParent.attachments} />
                    </div>

                    {/* Replies divider */}
                    <div className="relative flex items-center justify-center">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border" />
                      </div>
                      <span className="relative bg-background px-2 text-[10px] text-muted-foreground font-medium">
                        {threadReplies.length} {threadReplies.length === 1 ? "reply" : "replies"}
                      </span>
                    </div>

                    {/* Replies list */}
                    <div className="space-y-3">
                      {threadReplies.map((reply) => (
                        <div key={reply.id} className="flex items-start gap-2.5">
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
                            <div className="mt-0.5 rounded-lg bg-muted/60 px-3 py-1.5 text-xs text-foreground whitespace-pre-wrap break-all">
                              {reply.text}
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
                        className="size-9 shrink-0 rounded-xl"
                      >
                        <Send className="size-3.5" />
                      </Button>
                    </form>
                  </div>
                </div>
              )}
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
