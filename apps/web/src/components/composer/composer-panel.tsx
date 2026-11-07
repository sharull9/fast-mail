import { useState, useRef, useCallback } from "react";
import { useComposer, type ComposerAttachment } from "@/components/composer/composer-context";
import { RecipientField } from "@/components/composer/recipient-field";
import { RichTextEditor } from "@/components/composer/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes, getAttachmentIcon } from "@/components/thread-view";

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
    clearDraft,
    sendMessage,
    hasContent,
  } = useComposer();

  const [showCc, setShowCc] = useState(draft.cc.length > 0);
  const [showBcc, setShowBcc] = useState(draft.bcc.length > 0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 600, height: 540 });
  const [fixedHeight, setFixedHeight] = useState<number>(480);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    initialLeft: number;
    initialTop: number;
  } | null>(null);

  type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

  const handleResizePointerDown = (e: React.PointerEvent, direction: ResizeDirection) => {
    if (e.button !== 0 || isMaximized) return;
    e.preventDefault();
    e.stopPropagation();

    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();

    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    const startWidth = rect.width;
    const startHeight = rect.height;

    const minWidth = 380;
    const maxWidth = window.innerWidth - 32;
    const minHeight = 280;
    const maxHeight = window.innerHeight - 32;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newLeft = startLeft;
      let newTop = startTop;

      if (direction.includes("w")) {
        newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
        newLeft = startLeft + (startWidth - newWidth);
      } else if (direction.includes("e")) {
        newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX));
      }

      if (direction.includes("n")) {
        newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - deltaY));
        newTop = startTop + (startHeight - newHeight);
      } else if (direction.includes("s")) {
        newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY));
      }

      newLeft = Math.max(8, Math.min(window.innerWidth - newWidth - 8, newLeft));
      newTop = Math.max(8, Math.min(window.innerHeight - newHeight - 8, newTop));

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newLeft, y: newTop });
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleFixedHeightResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = fixedHeight;
    const onPointerMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY;
      setFixedHeight(Math.min(900, Math.max(280, startH + delta)));
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

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

  const [confirmAction, setConfirmAction] = useState<"discard" | "clear" | null>(null);

  const handleDiscard = useCallback(() => {
    if (hasContent()) {
      setConfirmAction("discard");
    } else {
      closeComposer();
    }
  }, [hasContent, closeComposer]);

  const handleClearDetails = useCallback(() => {
    if (hasContent()) {
      setConfirmAction("clear");
    } else {
      clearDraft();
    }
  }, [hasContent, clearDraft]);

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || activeMode !== "floating" || isMaximized) return;
    if ((e.target as HTMLElement).closest("button, input, textarea, a")) return;

    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialLeft: rect.left,
      initialTop: rect.top,
    };
    setIsDragging(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!dragRef.current || !panelRef.current) return;
      const deltaX = moveEvent.clientX - dragRef.current.startX;
      const deltaY = moveEvent.clientY - dragRef.current.startY;
      const panelWidth = panelRef.current.offsetWidth;
      const panelHeight = panelRef.current.offsetHeight;

      const newLeft = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, dragRef.current.initialLeft + deltaX));
      const newTop = Math.max(8, Math.min(window.innerHeight - panelHeight - 8, dragRef.current.initialTop + deltaY));

      setPosition({ x: newLeft, y: newTop });
    };

    const onPointerUp = () => {
      dragRef.current = null;
      setIsDragging(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  if (!isOpen && !forcedMode) {
    return null;
  }

  // Minimized state in floating mode (solid opaque background, no hover transparency)
  if (activeMode === "floating" && isMinimized) {
    return (
      <div
        className="fixed bottom-0 right-8 z-50 flex h-10 w-72 items-center justify-between rounded-t-lg border-t border-x border-border bg-card px-3 shadow-2xl transition-colors cursor-pointer hover:bg-muted"
        onClick={toggleMinimize}
      >
        <span className="truncate text-xs font-semibold text-foreground">
          {draft.subject ? draft.subject : draft.to.length > 0 ? `To: ${draft.to.join(", ")}` : "New Message"}
        </span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMinimize();
                }}
              >
                <Maximize2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] py-1 px-2">
              Restore composer
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost-destructive"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDiscard();
                }}
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] py-1 px-2">
              Close
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  const containerClasses =
    activeMode === "floating"
      ? isMaximized
        ? "fixed inset-4 z-50 flex flex-col rounded-xl border border-border bg-card shadow-2xl max-w-5xl mx-auto my-auto h-[calc(100vh-2rem)]"
        : cn(
            "fixed z-50 flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden",
            position ? "" : "bottom-4 right-8",
          )
      : cn("flex flex-col rounded-lg border border-border bg-card shadow-xs overflow-hidden", className);

  return (
    <section
      ref={panelRef}
      aria-label="Email composer"
      className={containerClasses}
      style={
        activeMode === "floating"
          ? isMaximized
            ? undefined
            : position
              ? {
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  width: `${size.width}px`,
                  height: `${size.height}px`,
                  right: "auto",
                  bottom: "auto",
                }
              : {
                  width: `${size.width}px`,
                  height: `${size.height}px`,
                }
          : {
              height: `${fixedHeight}px`,
            }
      }
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.length) {
          handleFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      {/* Floating Mode Resize Handles */}
      {activeMode === "floating" && !isMaximized && (
        <>
          {/* Top handle */}
          <div
            className="absolute -top-1 left-2 right-2 h-2.5 cursor-ns-resize z-50 select-none"
            onPointerDown={(e) => handleResizePointerDown(e, "n")}
          />
          {/* Bottom handle */}
          <div
            className="absolute -bottom-1 left-2 right-2 h-2.5 cursor-ns-resize z-50 select-none"
            onPointerDown={(e) => handleResizePointerDown(e, "s")}
          />
          {/* Left handle */}
          <div
            className="absolute top-2 bottom-2 -left-1 w-2.5 cursor-ew-resize z-50 select-none"
            onPointerDown={(e) => handleResizePointerDown(e, "w")}
          />
          {/* Right handle */}
          <div
            className="absolute top-2 bottom-2 -right-1 w-2.5 cursor-ew-resize z-50 select-none"
            onPointerDown={(e) => handleResizePointerDown(e, "e")}
          />
          {/* Top-Left handle */}
          <div
            className="absolute -top-1.5 -left-1.5 size-4 cursor-nwse-resize z-50 select-none"
            onPointerDown={(e) => handleResizePointerDown(e, "nw")}
          />
          {/* Top-Right handle */}
          <div
            className="absolute -top-1.5 -right-1.5 size-4 cursor-nesw-resize z-50 select-none"
            onPointerDown={(e) => handleResizePointerDown(e, "ne")}
          />
          {/* Bottom-Left handle */}
          <div
            className="absolute -bottom-1.5 -left-1.5 size-4 cursor-nesw-resize z-50 select-none"
            onPointerDown={(e) => handleResizePointerDown(e, "sw")}
          />
          {/* Bottom-Right handle */}
          <div
            className="absolute -bottom-1.5 -right-1.5 size-4 cursor-nwse-resize z-50 select-none"
            onPointerDown={(e) => handleResizePointerDown(e, "se")}
          />
        </>
      )}

      {/* Fixed Mode Top Resize Handle */}
      {activeMode === "fixed" && (
        <div
          className="h-2 w-full cursor-ns-resize hover:bg-primary/20 transition-colors flex items-center justify-center -mt-0.5 group select-none shrink-0"
          onPointerDown={handleFixedHeightResize}
          title="Drag to resize composer height"
        >
          <div className="h-1 w-10 rounded-full bg-border/80 group-hover:bg-primary/80 transition-colors" />
        </div>
      )}
      {/* Composer Header */}
      <div
        className={cn(
          "flex h-10 items-center justify-between border-b border-border/50 bg-muted/40 px-3.5 select-none shrink-0",
          activeMode === "floating" && !isMaximized && (isDragging ? "cursor-grabbing" : "cursor-grab"),
        )}
        onPointerDown={handleHeaderPointerDown}
      >
        <span className="text-xs font-semibold text-foreground">
          {draft.inReplyTo ? "Reply" : draft.subject || "New Message"}
        </span>

        <div className="flex items-center gap-1">
          {/* Mode Switcher: Floating vs Fixed */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setMode(activeMode === "floating" ? "fixed" : "floating")}
              >
                {activeMode === "floating" ? (
                  <PanelBottom className="size-3.5" />
                ) : (
                  <ExternalLink className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px] py-1 px-2">
              {activeMode === "floating" ? "Dock to panel" : "Pop out to floating panel"}
            </TooltipContent>
          </Tooltip>

          {activeMode === "floating" && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={toggleMinimize}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px] py-1 px-2">
                  Minimize
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={toggleMaximize}
                  >
                    {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px] py-1 px-2">
                  {isMaximized ? "Restore size" : "Maximize"}
                </TooltipContent>
              </Tooltip>
            </>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost-destructive"
                size="icon-xs"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleDiscard}
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px] py-1 px-2">
              Close
            </TooltipContent>
          </Tooltip>
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

        <div className="flex items-center gap-2 border-b border-border/40 py-1.5 px-3 text-xs bg-background/50">
          <span className="w-16 font-medium text-muted-foreground select-none shrink-0">Subject:</span>
          <input
            type="text"
            value={draft.subject}
            placeholder="Subject..."
            className="flex-1 min-w-0 bg-transparent py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
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
              {getAttachmentIcon(att.mimeType, att.filename)}
              <span className="max-w-44 truncate font-medium">{att.filename}</span>
              <span className="text-[10px] text-muted-foreground">({formatBytes(att.size)})</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted ml-0.5"
                    onClick={() => removeAttachment(att.id)}
                    aria-label={`Remove ${att.filename}`}
                  >
                    <X className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[11px] py-1 px-2">
                  Remove attachment
                </TooltipContent>
              </Tooltip>
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
                <span>Send</span>
                <kbd className="ml-1 text-[10px] !text-primary-foreground/85 font-semibold">⌘Enter</kbd>
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach files"
              >
                <Paperclip className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] py-1 px-2">
              Attach files
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost-destructive"
                size="icon-sm"
                onClick={handleClearDetails}
                aria-label="Clear input details"
              >
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] py-1 px-2">
              Clear input details
            </TooltipContent>
          </Tooltip>

          {/* Corner Resize Grip */}
          {activeMode === "floating" && !isMaximized && (
            <div
              onPointerDown={(e) => handleResizePointerDown(e, "se")}
              className="cursor-nwse-resize p-1 text-muted-foreground/30 hover:text-foreground transition-colors select-none -mr-1"
              title="Drag to resize"
              aria-label="Resize composer"
            >
              <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                <path d="M10 2L2 10M10 6L6 10M10 10H10.01" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmAction === "discard" ? "Discard unsaved draft?" : "Clear all details?"}</DialogTitle>
            <DialogDescription>
              {confirmAction === "discard"
                ? "This will close the composer and discard any unsaved changes."
                : "This will clear all recipients, subject, attachments, and message content."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-3 flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirmAction === "discard") {
                  closeComposer();
                } else if (confirmAction === "clear") {
                  clearDraft();
                }
                setConfirmAction(null);
              }}
            >
              {confirmAction === "discard" ? "Discard draft" : "Clear details"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
