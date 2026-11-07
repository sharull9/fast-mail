import { useCallback, useEffect, useState, forwardRef, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { Mention } from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Link as LinkIcon,
  Unlink,
  Undo2,
  Redo2,
  RemoveFormatting,
  AtSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Contact } from "@mailfast/shared";

import {
  GoogleChipExtension,
  detectGoogleDocType,
  getDefaultGoogleDocTitle,
  type GoogleDocType,
} from "./extensions/google-chip-extension";
import { DateTimeExtension } from "./extensions/date-time-extension";
import { createMentionSuggestion } from "./extensions/mention-suggestion";
import { TableControls } from "./table-controls";
import { DateTimePickerPopover } from "./date-time-picker-popover";
import { GoogleChipDialog } from "./google-chip-dialog";
import { SlashCommandExtension } from "./extensions/slash-command-extension";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  onSendShortcut?: () => void;
  onFilesDrop?: (files: File[]) => void;
  onUserTagged?: (contact: Contact) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  autoFocus?: boolean;
}

export function RichTextEditor({
  content,
  onChange,
  onSendShortcut,
  onFilesDrop,
  onUserTagged,
  placeholder = "Write a message, type '/' for commands, or '@' to tag...",
  minHeight = "160px",
  className,
  autoFocus = false,
}: RichTextEditorProps) {
  const mentionSuggestion = useMemo(() => createMentionSuggestion(onUserTagged), [onUserTagged]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2",
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: "border-collapse border border-border/70 my-2 w-full",
        },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: "border border-border/70 bg-muted/60 p-2 text-left font-semibold text-xs",
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: "border border-border/70 p-2 text-xs",
        },
      }),
      Mention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion: mentionSuggestion,
        renderHTML({ options, node }) {
          return [
            "span",
            mergeAttributes(options.HTMLAttributes, {
              "data-type": "mention",
              "data-id": node.attrs.id,
              "data-label": node.attrs.label,
              class: "mention",
              style:
                "display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px; border-radius: 4px; background-color: rgba(37, 99, 235, 0.1); color: #2563eb; font-weight: 500; font-size: 13px; text-decoration: none;",
            }),
            `@${node.attrs.label ?? node.attrs.id}`,
          ];
        },
      }),
      DateTimeExtension,
      GoogleChipExtension,
      SlashCommandExtension,
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          "is-editor-empty before:text-muted-foreground/50 before:float-left before:content-[attr(data-placeholder)] before:pointer-events-none before:h-0",
      }),
    ],
    content,
    autofocus: autoFocus,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn(
          "w-full px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:outline-none leading-relaxed",
          "[&_h1]:text-lg [&_h1]:font-bold [&_h1]:my-2",
          "[&_h2]:text-base [&_h2]:font-bold [&_h2]:my-1.5",
          "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:my-1",
          "[&_p]:my-1",
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1",
          "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-1 [&_blockquote]:text-muted-foreground",
          "[&_pre]:bg-muted/80 [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:my-1 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:overflow-x-auto",
          "[&_code]:bg-muted/80 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
          "[&_table]:border-collapse [&_table]:w-full [&_table]:my-2 [&_table]:border [&_table]:border-border/70 [&_table]:rounded-md [&_table]:overflow-hidden",
          "[&_th]:border [&_th]:border-border/70 [&_th]:bg-muted/60 [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-xs [&_th]:min-w-17.5",
          "[&_td]:border [&_td]:border-border/70 [&_td]:p-2 [&_td]:text-xs [&_td]:min-w-17.5",
          "[&_.selectedCell]:bg-primary/10",
          "[&_.mention]:bg-primary/10 [&_.mention]:text-primary [&_.mention]:px-1.5 [&_.mention]:py-0.5 [&_.mention]:rounded [&_.mention]:font-medium [&_.mention]:text-xs [&_.mention]:inline-flex [&_.mention]:items-center",
        ),
        style: `min-height: ${minHeight};`,
      },
      handleKeyDown: (_, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onSendShortcut?.();
          return true;
        }
        return false;
      },
      handleDrop: (_, event) => {
        if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
          event.preventDefault();
          const files = Array.from(event.dataTransfer.files);
          onFilesDrop?.(files);
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (text && /^https?:\/\/(docs|drive)\.google\.com\/[^\s]+$/i.test(text)) {
          const type = detectGoogleDocType(text);
          if (type && view.state.schema.nodes.googleChip) {
            event.preventDefault();
            const title = getDefaultGoogleDocTitle(type, text);
            const node = view.state.schema.nodes.googleChip.create({
              href: text,
              title,
              type,
            });
            const tr = view.state.tr.replaceSelectionWith(node);
            view.dispatch(tr);
            return true;
          }
        }
        return false;
      },
    },
  });

  // Sync external content update if editor content is divergent
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      if (!editor.isFocused || content === "") {
        editor.commands.setContent(content, { emitUpdate: false });
      }
    }
  }, [content, editor]);

  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const openLinkPopover = useCallback(() => {
    if (!editor) return;
    const previousUrl = (editor.getAttributes("link").href as string) || "";
    setLinkUrl(previousUrl);
    setLinkPopoverOpen(true);
  }, [editor]);

  const handleApplyLink = useCallback(() => {
    if (!editor) return;
    const trimmed = linkUrl.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const formatted = /^https?:\/\//i.test(trimmed) || trimmed.startsWith("mailto:") ? trimmed : `https://${trimmed}`;
      const docType = detectGoogleDocType(formatted);
      if (docType && editor.schema.nodes.googleChip) {
        // Automatically insert as a Google Smart Chip!
        const title = getDefaultGoogleDocTitle(docType, formatted);
        editor
          .chain()
          .focus()
          .insertContent({
            type: "googleChip",
            attrs: {
              href: formatted,
              title,
              type: docType,
            },
          })
          .run();
      } else {
        editor.chain().focus().extendMarkRange("link").setLink({ href: formatted }).run();
      }
    }
    setLinkPopoverOpen(false);
  }, [editor, linkUrl]);

  const handleInsertDateTime = useCallback(
    (data: { date: string; label: string; hasTime: boolean }) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "dateTimeChip",
          attrs: {
            date: data.date,
            label: data.label,
            hasTime: data.hasTime,
          },
        })
        .run();
    },
    [editor],
  );

  const handleInsertGoogleChip = useCallback(
    (data: { href: string; title: string; type: GoogleDocType }) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "googleChip",
          attrs: {
            href: data.href,
            title: data.title,
            type: data.type,
          },
        })
        .run();
    },
    [editor],
  );

  if (!editor) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col border border-border/60 rounded-md bg-background focus-within:border-ring transition-colors",
        className,
      )}
    >
      {/* Editor Formatting Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-border/50 bg-muted/30 px-2 py-1 select-none shrink-0 overflow-x-auto scrollbar-none">
        <ToolbarButton
          icon={<Undo2 className="size-3.5" />}
          label="Undo (Ctrl+Z)"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        />
        <ToolbarButton
          icon={<Redo2 className="size-3.5" />}
          label="Redo (Ctrl+Y)"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        />

        <div className="mx-1 h-3.5 w-px shrink-0 bg-border/60 self-center" />

        <ToolbarButton
          icon={<Bold className="size-3.5" />}
          label="Bold (Ctrl+B)"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon={<Italic className="size-3.5" />}
          label="Italic (Ctrl+I)"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon={<UnderlineIcon className="size-3.5" />}
          label="Underline (Ctrl+U)"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          icon={<Strikethrough className="size-3.5" />}
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          icon={<Code className="size-3.5" />}
          label="Inline Code"
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />

        <div className="mx-1 h-3.5 w-px shrink-0 bg-border/60 self-center" />

        <ToolbarButton
          icon={<Heading1 className="size-3.5" />}
          label="Heading 1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarButton
          icon={<Heading2 className="size-3.5" />}
          label="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          icon={<Heading3 className="size-3.5" />}
          label="Heading 3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />

        <div className="mx-1 h-3.5 w-px shrink-0 bg-border/60 self-center" />

        <ToolbarButton
          icon={<List className="size-3.5" />}
          label="Bullet List"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={<ListOrdered className="size-3.5" />}
          label="Ordered List"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={<Quote className="size-3.5" />}
          label="Blockquote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          icon={<SquareCode className="size-3.5" />}
          label="Code Block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />

        <div className="mx-1 h-3.5 w-px shrink-0 bg-border/60 self-center" />

        {/* User Tagging Button */}
        <ToolbarButton
          icon={<AtSign className="size-3.5 text-primary" />}
          label="Tag User (@)"
          onClick={() => {
            editor.chain().focus().insertContent("@").run();
          }}
        />

        {/* Date & Time Picker */}
        <DateTimePickerPopover onInsert={handleInsertDateTime} />

        {/* Table Controls */}
        <TableControls editor={editor} />

        {/* Google Workspace Smart Chip */}
        <GoogleChipDialog onInsert={handleInsertGoogleChip} />

        <div className="mx-1 h-3.5 w-px shrink-0 bg-border/60 self-center" />

        <Popover open={linkPopoverOpen} onOpenChange={setLinkPopoverOpen}>
          <PopoverTrigger asChild>
            <ToolbarButton
              icon={<LinkIcon className="size-3.5" />}
              label="Insert Link"
              active={editor.isActive("link")}
              onClick={openLinkPopover}
            />
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2.5 shadow-xl border border-border" align="start">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-foreground">Insert link</span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="url"
                  placeholder="https://example.com"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleApplyLink();
                    }
                  }}
                  className="h-8 text-xs flex-1"
                  autoFocus
                />
                <Button size="sm" onClick={handleApplyLink} className="h-8 px-2.5 text-xs">
                  {linkUrl.trim() ? "Apply" : "Clear"}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {editor.isActive("link") && (
          <ToolbarButton
            icon={<Unlink className="size-3.5" />}
            label="Remove Link"
            onClick={() => editor.chain().focus().unsetLink().run()}
          />
        )}
        <ToolbarButton
          icon={<RemoveFormatting className="size-3.5" />}
          label="Clear Formatting"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        />
      </div>

      {/* Editor Editable Area */}
      <EditorContent editor={editor} className="flex-1 min-h-0 overflow-y-auto cursor-text" />
    </div>
  );
}

const ToolbarButton = forwardRef<
  HTMLButtonElement,
  {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
  } & React.ComponentProps<typeof Button>
>(({ icon, label, active = false, disabled = false, onClick, className, ...props }, ref) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none disabled:opacity-40 disabled:pointer-events-none",
            active && "bg-accent text-accent-foreground font-semibold",
            className,
          )}
          {...props}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px] py-1 px-2">
        {label}
      </TooltipContent>
    </Tooltip>
  );
});
ToolbarButton.displayName = "ToolbarButton";
