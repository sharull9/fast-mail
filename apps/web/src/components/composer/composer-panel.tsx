import { useState, useRef, useCallback } from "react";
import { useComposer, type ComposerAttachment } from "@/components/composer/composer-context";
import { RecipientField } from "@/components/composer/recipient-field";
import { RichTextEditor } from "@/components/composer/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  X,
  Minus,
  Maximize2,
  Minimize2,
  Paperclip,
  Send,
  Trash2,
  Loader2,
  ExternalLink,
  PanelBottom,
  File,
  FileText,
  FileArchive,
  FileCode,
  Image as ImageIcon,
  CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(mimeType: string, filename: string) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="size-3.5 text-blue-400" />;
  if (mimeType.includes("pdf") || filename.endsWith(".pdf")) return <FileText className="size-3.5 text-red-400" />;
  if (mimeType.includes("zip") || mimeType.includes("tar") || filename.endsWith(".zip"))
    return <FileArchive className="size-3.5 text-amber-400" />;
  if (mimeType.includes("json") || mimeType.includes("javascript") || mimeType.includes("typescript"))
    return <FileCode className="size-3.5 text-emerald-400" />;
  return <File className="size-3.5 text-muted-foreground" />;
}

export function ComposerPanel({ mode: forcedMode, className }: { mode?: "floating" | "fixed"; className?: string }) {
  const {
    isOpen,
    isMinimized,
    isMaximized,
    mode: contextMode,
    draft,
    isSending,
    sendError,
    closeComposer,
    toggleMinimize,
    toggleMaximize,
    setMode,
    updateDraft,
    sendMessage,
    hasContent,
  } = useComposer();

  const [showCc, setShowCc] = useState(draft.cc.length > 0);
  const [showBcc, setShowBcc] = useState(draft.bcc.length > 0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeMode = forcedMode ?? contextMode;

  const handleFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip data: url prefix if present
          const base64 = result.includes(",") ? result.split(",")[1]! : result;
          const newAttachment: ComposerAttachment = {
            id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            content: base64,
          };
          updateDraft((prev) => ({
            ...prev,
            attachments: [...prev.attachments, newAttachment],
          }));
        };
        reader.readAsDataURL(file);
      }
    },
    [updateDraft],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      updateDraft((prev) => ({
        ...prev,
        attachments: prev.attachments.filter((a) => a.id !== id),
      }));
    },
    [updateDraft],
  );

  const handleDiscard = useCallback(() => {
    if (hasContent()) {
      if (window.confirm("Discard unsaved message?")) {
        closeComposer();
      }
    } else {
      closeComposer();
    }
  }, [hasContent, closeComposer]);

  if (!isOpen && !forcedMode) {
    return null;
  }

  // Minimized state in floating mode
  if (activeMode === "floating" && isMinimized) {
    return (
      <div
        className="fixed bottom-0 right-8 z-50 flex h-10 w-72 items-center justify-between rounded-t-lg border-t border-x border-border/80 bg-card px-3 shadow-xl transition-all cursor-pointer hover:bg-muted/60"
        onClick={toggleMinimize}
      >
        <span className="truncate text-xs font-semibold text-foreground">
          {draft.subject ? draft.subject : draft.to.length > 0 ? `To: ${draft.to.join(", ")}` : "New Message"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize();
            }}
            title="Restore composer"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              handleDiscard();
            }}
            title="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const containerClasses =
    activeMode === "floating"
      ? isMaximized
        ? "fixed inset-4 z-50 flex flex-col rounded-xl border border-border/80 bg-card shadow-2xl max-w-5xl mx-auto my-auto h-[calc(100vh-2rem)]"
        : "fixed bottom-4 right-8 z-50 flex flex-col w-[600px] max-w-[calc(100vw-2rem)] h-[540px] max-h-[calc(100vh-3rem)] rounded-xl border border-border/80 bg-card shadow-2xl"
      : cn("flex flex-col rounded-lg border border-border/70 bg-card/60 backdrop-blur-sm overflow-hidden", className);

  return (
    <section
      aria-label="Email composer"
      className={containerClasses}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.length) {
          handleFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      {/* Composer Header */}
      <div className="flex h-10 items-center justify-between border-b border-border/50 bg-muted/40 px-3.5 select-none shrink-0">
        <span className="text-xs font-semibold text-foreground">
          {draft.inReplyTo ? "Reply" : draft.subject || "New Message"}
        </span>

        <div className="flex items-center gap-1">
          {/* Mode Switcher: Floating vs Fixed */}
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            onClick={() => setMode(activeMode === "floating" ? "fixed" : "floating")}
            title={activeMode === "floating" ? "Dock / Fixed panel mode" : "Pop out to floating panel"}
          >
            {activeMode === "floating" ? <PanelBottom className="size-3.5" /> : <ExternalLink className="size-3.5" />}
          </button>

          {activeMode === "floating" && (
            <>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                onClick={toggleMinimize}
                title="Minimize"
              >
                <Minus className="size-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                onClick={toggleMaximize}
                title={isMaximized ? "Restore size" : "Maximize"}
              >
                {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </button>
            </>
          )}

          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            onClick={handleDiscard}
            title="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Recipient inputs */}
      <div className="shrink-0 flex flex-col bg-background/30">
        <RecipientField
          label="To"
          recipients={draft.to}
          onChange={(to) => updateDraft({ to })}
          showCcToggle={!showCc}
          showBccToggle={!showBcc}
          onToggleCc={() => setShowCc(true)}
          onToggleBcc={() => setShowBcc(true)}
          autoFocus={draft.to.length === 0}
        />

        {showCc && (
          <RecipientField
            label="Cc"
            recipients={draft.cc}
            onChange={(cc) => updateDraft({ cc })}
            placeholder="Add Cc..."
          />
        )}

        {showBcc && (
          <RecipientField
            label="Bcc"
            recipients={draft.bcc}
            onChange={(bcc) => updateDraft({ bcc })}
            placeholder="Add Bcc..."
          />
        )}

        <div className="flex items-center border-b border-border/40 py-1.5 px-3 text-xs bg-background/50">
          <span className="w-10 font-medium text-muted-foreground select-none shrink-0">Subject:</span>
          <input
            type="text"
            value={draft.subject}
            placeholder="Subject..."
            className="flex-1 bg-transparent py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
            onChange={(e) => updateDraft({ subject: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void sendMessage();
              }
            }}
          />
        </div>
      </div>

      {/* Attachments Section */}
      {draft.attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 bg-muted/20 p-2 text-xs shrink-0 max-h-28 overflow-y-auto">
          {draft.attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-xs text-foreground"
            >
              {getFileIcon(att.mimeType, att.filename)}
              <span className="max-w-44 truncate font-medium">{att.filename}</span>
              <span className="text-[10px] text-muted-foreground">({formatBytes(att.size)})</span>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted ml-0.5"
                onClick={() => removeAttachment(att.id)}
                title="Remove attachment"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Rich Text Editor */}
      <div className="flex-1 p-2 min-h-0 flex flex-col overflow-hidden">
        <RichTextEditor
          content={draft.bodyHtml}
          onChange={(bodyHtml) => updateDraft({ bodyHtml })}
          onSendShortcut={() => void sendMessage()}
          onFilesDrop={handleFiles}
          minHeight="140px"
          className="flex-1"
          autoFocus={draft.to.length > 0}
        />
      </div>

      {/* Error alert if send failed */}
      {sendError && (
        <div className="px-3 pb-1 shrink-0">
          <Alert variant="destructive" className="py-1 px-2.5 text-xs flex items-center gap-1.5">
            <CircleAlert className="size-3.5 shrink-0" />
            <AlertDescription className="text-xs">{sendError}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between border-t border-border/50 bg-muted/30 px-3 py-2 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={isSending}
            onClick={() => void sendMessage()}
            className="gap-1.5 text-xs font-semibold"
          >
            {isSending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="size-3.5" />
                Send
                <kbd className="ml-1 text-[10px] opacity-70">⌘Enter</kbd>
              </>
            )}
          </Button>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                handleFiles(Array.from(e.target.files));
                e.target.value = "";
              }
            }}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
          >
            <Paperclip className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleDiscard}
            title="Discard draft"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
