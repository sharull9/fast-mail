import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useRef, useEffect } from "react";
import { ExternalLink, Edit2, Trash2, Check, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type GoogleDocType = "sheet" | "doc" | "slide" | "drive" | "form" | "file";

export function detectGoogleDocType(url: string): GoogleDocType | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes("spreadsheets") || lower.includes("docs.google.com/spreadsheets")) {
    return "sheet";
  }
  if (lower.includes("presentation") || lower.includes("docs.google.com/presentation")) {
    return "slide";
  }
  if (lower.includes("document") || lower.includes("docs.google.com/document")) {
    return "doc";
  }
  if (lower.includes("forms") || lower.includes("docs.google.com/forms")) {
    return "form";
  }
  if (lower.includes("drive.google.com") || lower.includes("google.com/drive")) {
    return "drive";
  }
  return null;
}

export function getDefaultGoogleDocTitle(type: GoogleDocType, url?: string): string {
  if (url) {
    try {
      const u = new URL(url);
      const titleParam = u.searchParams.get("title") || u.searchParams.get("name");
      if (titleParam) return titleParam;
    } catch {
      // ignore URL parse error
    }
  }
  switch (type) {
    case "sheet":
      return "Google Spreadsheet";
    case "doc":
      return "Google Document";
    case "slide":
      return "Google Presentation";
    case "form":
      return "Google Form";
    case "drive":
    case "file":
    default:
      return "Google Drive Item";
  }
}

export function GoogleSheetsIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="16" height="16" rx="2.5" fill="#0F9D58" />
      <path d="M4 4.5H12V11.5H4V4.5Z" fill="white" />
      <path d="M7.5 4.5V11.5M4 8H12M4 6.25H12M4 9.75H12" stroke="#0F9D58" strokeWidth="0.8" />
    </svg>
  );
}

export function GoogleDocsIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="16" height="16" rx="2.5" fill="#4285F4" />
      <path d="M4.5 5H11.5M4.5 7.5H11.5M4.5 10H8.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function GoogleSlidesIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="16" height="16" rx="2.5" fill="#F4B400" />
      <rect x="4" y="5" width="8" height="6" rx="0.8" fill="white" />
      <rect x="5.2" y="6.2" width="5.6" height="3.6" fill="#F4B400" />
    </svg>
  );
}

export function GoogleDriveIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5.5 2.5L10.5 2.5L14.5 9.5L9.5 9.5L5.5 2.5Z" fill="#FFBA00" />
      <path d="M1.5 9.5L5.5 2.5L9.5 9.5L5.5 16.5L1.5 9.5Z" fill="#0F9D58" />
      <path d="M5.5 16.5L9.5 9.5L14.5 9.5L10.5 16.5L5.5 16.5Z" fill="#4285F4" />
    </svg>
  );
}

export function GoogleChipIcon({ type, className = "size-4" }: { type: GoogleDocType; className?: string }) {
  switch (type) {
    case "sheet":
      return <GoogleSheetsIcon className={className} />;
    case "slide":
      return <GoogleSlidesIcon className={className} />;
    case "drive":
    case "file":
      return <GoogleDriveIcon className={className} />;
    case "doc":
    case "form":
    default:
      return <GoogleDocsIcon className={className} />;
  }
}

function getIconSvgString(type: GoogleDocType): string {
  switch (type) {
    case "sheet":
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; shrink: 0;"><rect width="16" height="16" rx="2.5" fill="#0F9D58"/><path d="M4 4.5H12V11.5H4V4.5Z" fill="white"/><path d="M7.5 4.5V11.5M4 8H12M4 6.25H12M4 9.75H12" stroke="#0F9D58" stroke-width="0.8"/></svg>`;
    case "slide":
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; shrink: 0;"><rect width="16" height="16" rx="2.5" fill="#F4B400"/><rect x="4" y="5" width="8" height="6" rx="0.8" fill="white"/><rect x="5.2" y="6.2" width="5.6" height="3.6" fill="#F4B400"/></svg>`;
    case "drive":
    case "file":
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; shrink: 0;"><path d="M5.5 2.5L10.5 2.5L14.5 9.5L9.5 9.5L5.5 2.5Z" fill="#FFBA00"/><path d="M1.5 9.5L5.5 2.5L9.5 9.5L5.5 16.5L1.5 9.5Z" fill="#0F9D58"/><path d="M5.5 16.5L9.5 9.5L14.5 9.5L10.5 16.5L5.5 16.5Z" fill="#4285F4"/></svg>`;
    case "doc":
    case "form":
    default:
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; shrink: 0;"><rect width="16" height="16" rx="2.5" fill="#4285F4"/><path d="M4.5 5H11.5M4.5 7.5H11.5M4.5 10H8.5" stroke="white" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  }
}

function GoogleChipNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected } = props;
  const href = (node.attrs.href as string) || "#";
  const title = (node.attrs.title as string) || "Google Document";
  const type = (node.attrs.type as GoogleDocType) || "doc";

  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditedTitle(title);
  }, [title]);

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isEditing]);

  const handleSaveTitle = () => {
    const trimmed = editedTitle.trim();
    if (trimmed) {
      updateAttributes({ title: trimmed });
    }
    setIsEditing(false);
    setPopoverOpen(false);
  };

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle my-0.5 mx-1 select-none">
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] text-xs font-normal border transition-all cursor-pointer ${
              selected
                ? "bg-muted ring-2 ring-primary border-primary text-foreground"
                : "bg-muted/70 hover:bg-muted border-border/60 text-foreground"
            }`}
            style={{
              backgroundColor: "var(--google-chip-bg, rgba(0, 0, 0, 0.05))",
            }}
            title={title}
          >
            <GoogleChipIcon type={type} className="size-4 shrink-0" />
            <span className="font-medium text-foreground tracking-tight max-w-72 truncate">
              {title}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-3 shadow-lg border border-border"
          align="start"
          sideOffset={4}
        >
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-foreground">Edit chip title</span>
              <div className="flex items-center gap-1.5">
                <Input
                  ref={inputRef}
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveTitle();
                    } else if (e.key === "Escape") {
                      setIsEditing(false);
                    }
                  }}
                  className="h-7 text-xs flex-1"
                />
                <Button size="sm" onClick={handleSaveTitle} className="h-7 px-2">
                  <Check className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsEditing(false)}
                  className="h-7 px-2"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <GoogleChipIcon type={type} className="size-5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate text-foreground">{title}</p>
                  <p className="text-[11px] text-muted-foreground truncate font-mono">{href}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium py-1 px-2 rounded hover:bg-muted"
                >
                  <ExternalLink className="size-3" />
                  <span>Open</span>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit2 className="size-3" />
                  <span>Rename</span>
                </Button>
                <Button
                  variant="ghost-destructive"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 ml-auto text-destructive hover:bg-destructive/10"
                  onClick={() => deleteNode()}
                >
                  <Trash2 className="size-3" />
                  <span>Remove</span>
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

export const GoogleChipExtension = Node.create({
  name: "googleChip",

  group: "inline",

  inline: true,

  atom: true,

  selectable: true,

  draggable: true,

  addAttributes() {
    return {
      href: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-href") || element.getAttribute("href") || "",
        renderHTML: (attributes: Record<string, any>) => ({
          "data-href": attributes.href,
        }),
      },
      title: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-title") || element.textContent?.trim() || "",
        renderHTML: (attributes: Record<string, any>) => ({
          "data-title": attributes.title,
        }),
      },
      type: {
        default: "doc",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-chip-type") || "doc",
        renderHTML: (attributes: Record<string, any>) => ({
          "data-chip-type": attributes.type,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-google-chip="true"]',
      },
      {
        tag: 'a[data-google-chip="true"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }: { node: any; HTMLAttributes: Record<string, any> }) {
    const href = node.attrs.href || "#";
    const title = node.attrs.title || "Google Document";
    const type = (node.attrs.type as GoogleDocType) || "doc";
    const iconSvg = getIconSvgString(type);

    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-google-chip": "true",
        "data-chip-type": type,
        "data-href": href,
        "data-title": title,
        href,
        target: "_blank",
        rel: "noopener noreferrer",
        class: "google-smart-chip",
        style:
          "display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px 2px 6px; border-radius: 6px; background-color: #f1f3f4; color: #202124; text-decoration: none; font-size: 13px; font-weight: 500; vertical-align: middle; line-height: 20px; border: 1px solid #dadce0; margin: 0 2px;",
      }),
      ["span", { style: "display: inline-flex; align-items: center; justify-content: center;" }, ["raw", iconSvg]],
      ["span", { style: "color: #202124; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;" }, title],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(GoogleChipNodeView);
  },
});
