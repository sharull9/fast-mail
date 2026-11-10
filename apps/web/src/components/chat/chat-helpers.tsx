import { useState } from "react";
import {
  FileCode,
  FileText,
  Table,
  Presentation,
  CheckSquare,
  HardDrive,
  Calendar,
  MapPin,
  ExternalLink,
  Video,
  Play,
  FolderArchive,
  MessageSquare,
  Mail,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@mailfast/shared";

export function formatChatListTime(timestamp: number): string {
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

export function formatChatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatChatDate(timestamp: number): string {
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

export const AVATAR_PALETTE = [
  "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30",
  "bg-purple-600/20 text-purple-400 border border-purple-500/30",
  "bg-orange-600/20 text-orange-400 border border-orange-500/30",
  "bg-blue-600/20 text-blue-400 border border-blue-500/30",
  "bg-rose-600/20 text-rose-400 border border-rose-500/30",
  "bg-amber-600/20 text-amber-400 border border-amber-500/30",
  "bg-cyan-600/20 text-cyan-400 border border-cyan-500/30",
  "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30",
];

export function getAvatarStyle(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!;
}

export function MentionChip({
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
  const email = targetEmail;
  const avatarStyle = getAvatarStyle(cleanName);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold cursor-pointer transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
            isSelf ? "bg-white/25 text-white hover:bg-white/35" : "bg-primary/15 text-primary hover:bg-primary/25"
          }`}
        >
          <span>@{cleanName}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 overflow-hidden shadow-xl border border-border" align="start">
        <div className="bg-linear-to-br from-primary/15 via-primary/5 to-transparent p-4 pb-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div
              className={`flex size-12 items-center justify-center rounded-full text-sm font-semibold border-2 border-background shadow-xs ${avatarStyle}`}
            >
              {cleanName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-foreground truncate">{cleanName}</div>
              {email && <div className="text-xs text-muted-foreground truncate">{email}</div>}
              <div className="mt-1 flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-muted-foreground">Active in Google Chat</span>
              </div>
            </div>
          </div>
        </div>

        <div className={`grid ${email ? "grid-cols-4" : "grid-cols-3"} gap-1 p-2 bg-muted/30`}>
          <Button
            variant="ghost"
            size="sm"
            className="flex flex-col items-center gap-1 h-auto py-2 px-1 text-[11px] transition-transform duration-150 active:scale-[0.97]"
            onClick={() => {
              setOpen(false);
              onOpenDm?.(cleanName, email);
            }}
            title="Direct Message"
          >
            <MessageSquare className="size-4 text-primary" />
            <span>Chat</span>
          </Button>
          {email && (
            <Button
              variant="ghost"
              size="sm"
              className="flex flex-col items-center gap-1 h-auto py-2 px-1 text-[11px] transition-transform duration-150 active:scale-[0.97]"
              onClick={() => {
                setOpen(false);
                window.open(`mailto:${email}`, "_blank");
              }}
              title="Send Email"
            >
              <Mail className="size-4 text-blue-500" />
              <span>Email</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="flex flex-col items-center gap-1 h-auto py-2 px-1 text-[11px] transition-transform duration-150 active:scale-[0.97]"
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
            className="flex flex-col items-center gap-1 h-auto py-2 px-1 text-[11px] transition-transform duration-150 active:scale-[0.97]"
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

export interface GoogleServiceItem {
  type: "docs" | "sheets" | "slides" | "forms" | "drive" | "meet" | "calendar" | "maps" | "youtube";
  url: string;
  title: string;
  badge: string;
  domain: string;
  id?: string;
}

export function parseGoogleService(
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

export function detectGoogleServices(
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
        if (
          att.downloadUri &&
          (att.downloadUri === url || url.includes(att.downloadUri) || att.downloadUri.includes(url))
        ) {
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
        (att.downloadUri &&
          (att.downloadUri.includes("docs.google.com") || att.downloadUri.includes("drive.google.com")))
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

export function getGoogleBrandStyles(type: GoogleServiceItem["type"]) {
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

export function GoogleServiceCard({ service }: { service: GoogleServiceItem }) {
  if (service.type === "meet") {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          window.open(service.url, "_blank");
        }}
        className="overflow-hidden rounded-2xl border border-amber-300/40 bg-card max-w-sm shadow-xs cursor-pointer group transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] dark:border-amber-700/50"
      >
        <div className="bg-[#FBBC04] px-6 py-5 flex items-center justify-center relative select-none">
          <div className="flex items-center gap-4 text-amber-950">
            <svg
              className="size-12 drop-shadow-xs"
              viewBox="0 0 64 64"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
        <div className="flex items-center justify-between border-t border-amber-300/40 bg-card px-4 py-3 transition-colors group-hover:bg-muted/70 dark:border-amber-800/40">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
              <Video className="size-4" />
            </div>
            <span className="font-semibold text-xs text-foreground">Join video meeting</span>
          </div>
          <ExternalLink className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
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
        className="overflow-hidden rounded-xl border border-border/80 bg-card max-w-sm shadow-xs cursor-pointer group transition-[background-color,border-color,transform] duration-150 active:scale-[0.98]"
      >
        {service.id && (
          <div className="relative aspect-video w-full bg-black/80 overflow-hidden">
            <img
              src={`https://img.youtube.com/vi/${service.id}/hqdefault.jpg`}
              alt={`${service.title} video thumbnail`}
              width={480}
              height={360}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-opacity duration-150"
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
      className="overflow-hidden rounded-xl border border-border/80 bg-card p-3 max-w-sm shadow-xs cursor-pointer group transition-[background-color,border-color,transform] duration-150 hover:bg-muted/50 active:scale-[0.98]"
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${brand.bg} ${brand.text} border ${brand.border} shadow-xs`}
        >
          {brand.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${brand.text}`}>{service.badge}</span>
          </div>
          <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
            {service.title}
          </div>
          <div className="truncate text-[10px] text-muted-foreground mt-0.5">{service.domain}</div>
        </div>
        <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 mt-0.5" />
      </div>
    </div>
  );
}

export function getFileTypeInfo(name?: string, contentType?: string) {
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

export function RenderMessageText({
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
        return <MentionChip key={idx} name={token} isSelf={isSelf} onOpenDm={onOpenDm} />;
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
            className="underline underline-offset-2 wrap-break-word opacity-95 hover:opacity-100"
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
      <div className="whitespace-pre-wrap wrap-break-word wrap-anywhere">
        {lines.map((line, lineIdx) => {
          const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
          if (headingMatch) {
            return (
              <div key={lineIdx} className="font-bold text-sm text-foreground my-1">
                {renderRichText(headingMatch[2]!)}
              </div>
            );
          }
          return <div key={lineIdx}>{renderRichText(line)}</div>;
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

export function RenderAttachments({
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
                width={640}
                height={480}
                className="aspect-4/3 max-h-80 w-full cursor-pointer bg-background/50 object-contain transition-opacity duration-150 hover:opacity-95"
                onClick={() => window.open(att.downloadUri || att.thumbnailUri || mediaSrc, "_blank")}
                loading="lazy"
                decoding="async"
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
            className="flex items-center gap-3 rounded-xl border border-border/80 bg-card p-3 max-w-sm cursor-pointer group shadow-xs transition-[background-color,border-color,transform] duration-150 hover:bg-muted/60 active:scale-[0.98]"
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
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{att.contentType || "Attachment"}</div>
            </div>
            <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground shrink-0 mt-0.5 transition-colors" />
          </div>
        );
      })}
    </div>
  );
}
