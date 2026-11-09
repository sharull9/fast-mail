import { useEffect, useState } from "react";
import type { ThreadAttachment } from "@mailfast/shared";
import { downloadAttachment, fetchAttachmentBlob, isDesktopApp, openAttachmentInBrowser } from "@/lib/api";
import { formatBytes, getAttachmentIcon } from "@/components/thread-view";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CircleAlert, Download, ExternalLink, Loader2, PanelLeftOpen, X } from "lucide-react";

export function AttachmentPaneView({
  attachment,
  paneId,
  onClose,
  onExpandList,
}: {
  attachment: ThreadAttachment;
  paneId: string;
  onClose: () => void;
  onExpandList?: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mime = (attachment.mimeType || "").toLowerCase();
  const ext = (attachment.filename || "").split(".").pop()?.toLowerCase() ?? "";
  const isImage = mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  const isPdf = mime === "application/pdf" || ext === "pdf";
  const isText =
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    ["txt", "json", "js", "ts", "tsx", "jsx", "html", "css", "py", "sh", "csv", "log", "md"].includes(ext);

  useEffect(() => {
    if (!attachment.id) {
      setBlobUrl(null);
      setTextContent(null);
      setError(null);
      return;
    }

    let active = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);

    fetchAttachmentBlob(attachment.messageId, attachment.id, attachment.filename, attachment.mimeType)
      .then(async (blob) => {
        if (!active) return;
        if (isText) {
          const text = await blob.text();
          if (active) setTextContent(text);
        }
        const url = URL.createObjectURL(blob);
        createdUrl = url;
        if (active) setBlobUrl(url);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load attachment");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment, isText]);

  return (
    <div className="pane @container h-full flex flex-col overflow-hidden">
      <div className="toolbar">
        {onExpandList && (
          <IconButton label="Expand list" onClick={onExpandList}>
            <PanelLeftOpen />
          </IconButton>
        )}
        <div className="flex items-center gap-2 min-w-0 max-w-70">
          {getAttachmentIcon(attachment.mimeType, attachment.filename)}
          <div className="min-w-0">
            <p className="text-xs font-medium truncate text-foreground" title={attachment.filename}>
              {attachment.filename}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {formatBytes(attachment.size)} · {attachment.fromName}
            </p>
          </div>
        </div>

        {/* Empty space in toolbar acts as draggable handler to move or split space */}
        <div
          className="flex-1 h-full min-w-4 cursor-grab active:cursor-grabbing self-stretch select-none"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/mailfast-attachment", JSON.stringify(attachment));
            e.dataTransfer.setData("text/plain", attachment.filename);
            e.dataTransfer.setData("application/mailfast-source-pane", paneId);
            e.dataTransfer.effectAllowed = "move";
          }}
          title="Drag to split or move space"
        />

        <div className="flex items-center gap-1 shrink-0">
          {attachment.id && (
            <>
              <IconButton
                label="Download attachment"
                onClick={() =>
                  void downloadAttachment(
                    attachment.messageId,
                    attachment.id!,
                    attachment.filename,
                    attachment.mimeType,
                  )
                }
              >
                <Download className="size-4" />
              </IconButton>
              <IconButton
                label={isDesktopApp() ? "Open in browser" : "Open in new tab"}
                onClick={() =>
                  void openAttachmentInBrowser(
                    attachment.messageId,
                    attachment.id!,
                    attachment.filename,
                    attachment.mimeType,
                  )
                }
              >
                <ExternalLink className="size-4" />
              </IconButton>
            </>
          )}
          <IconButton label="Close attachment" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className={`flex-1 min-h-0 overflow-auto flex items-center justify-center ${isPdf ? "p-0" : "p-4"}`}>
        {loading && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-xs">Loading attachment…</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <Alert variant="destructive" className="max-w-md">
              <CircleAlert className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            {attachment.id && (
              <Button
                size="sm"
                onClick={() =>
                  void downloadAttachment(
                    attachment.messageId,
                    attachment.id!,
                    attachment.filename,
                    attachment.mimeType,
                  )
                }
              >
                <Download className="size-3.5 mr-1" />
                Download
              </Button>
            )}
          </div>
        )}

        {!loading && !error && blobUrl && (
          <>
            {isImage && (
              <img
                src={blobUrl}
                alt={attachment.filename}
                className="max-h-full max-w-full rounded-md object-contain shadow-xs"
              />
            )}
            {isPdf && <iframe src={blobUrl} title={attachment.filename} className="w-full h-full border-0 bg-white" />}
            {isText && textContent !== null && (
              <pre className="w-full h-full overflow-auto rounded-md border border-border/70 bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap select-text">
                {textContent}
              </pre>
            )}
            {!isImage && !isPdf && !isText && (
              <div className="flex flex-col items-center gap-3 p-8 text-center">
                <div className="rounded-full bg-muted p-4">
                  {getAttachmentIcon(attachment.mimeType, attachment.filename)}
                </div>
                <div>
                  <h3 className="font-medium text-foreground">{attachment.filename}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatBytes(attachment.size)} · {attachment.mimeType || "Binary file"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    In-app preview is not supported for this file type.
                  </p>
                </div>
                {attachment.id && (
                  <Button
                    onClick={() =>
                      void downloadAttachment(
                        attachment.messageId,
                        attachment.id!,
                        attachment.filename,
                        attachment.mimeType,
                      )
                    }
                  >
                    <Download className="size-3.5 mr-1" />
                    Download
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
