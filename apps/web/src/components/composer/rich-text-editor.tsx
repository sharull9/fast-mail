import { useCallback, useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  onSendShortcut?: () => void;
  onFilesDrop?: (files: File[]) => void;
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
  placeholder = "Write your message...",
  minHeight = "160px",
  className,
  autoFocus = false,
}: RichTextEditorProps) {
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

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    const previousUrl = (editor.getAttributes("link").href as string) || "";
    setLinkUrl(previousUrl);
    setLinkDialogOpen(true);
  }, [editor]);

  const handleApplyLink = useCallback(() => {
    if (!editor) return;
    const trimmed = linkUrl.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const formatted = /^https?:\/\//i.test(trimmed) || trimmed.startsWith("mailto:") ? trimmed : `https://${trimmed}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href: formatted }).run();
    }
    setLinkDialogOpen(false);
  }, [editor, linkUrl]);

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
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border/50 bg-muted/30 px-2 py-1 select-none">
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

        <div className="mx-1 h-3.5 w-px bg-border/60" />

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

        <div className="mx-1 h-3.5 w-px bg-border/60" />

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

        <div className="mx-1 h-3.5 w-px bg-border/60" />

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

        <div className="mx-1 h-3.5 w-px bg-border/60" />

        <ToolbarButton
          icon={<LinkIcon className="size-3.5" />}
          label="Insert Link"
          active={editor.isActive("link")}
          onClick={openLinkDialog}
        />
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
      <EditorContent editor={editor} className="flex-1 overflow-y-auto cursor-text" />

      {/* Insert Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Insert link</DialogTitle>
          </DialogHeader>
          <div className="py-2">
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
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleApplyLink}>
              {linkUrl.trim() ? "Apply" : "Remove link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none disabled:opacity-40 disabled:pointer-events-none",
        active && "bg-accent text-accent-foreground font-semibold",
      )}
    >
      {icon}
    </button>
  );
}
