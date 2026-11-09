import { useState } from "react";
import {
  detectGoogleDocType,
  getDefaultGoogleDocTitle,
  GoogleChipIcon,
  type GoogleDocType,
} from "./extensions/google-chip-extension";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface GoogleChipDialogProps {
  onInsert: (data: { href: string; title: string; type: GoogleDocType }) => void;
  triggerButton?: React.ReactNode;
}

export function GoogleChipDialog({ onInsert, triggerButton }: GoogleChipDialogProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<GoogleDocType>("doc");

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    const detected = detectGoogleDocType(newUrl);
    if (detected) {
      setDocType(detected);
      if (!title) {
        setTitle(getDefaultGoogleDocTitle(detected, newUrl));
      }
    }
  };

  const handleInsert = () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    const formattedUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
    const detected = detectGoogleDocType(formattedUrl) || docType;
    const finalTitle = title.trim() || getDefaultGoogleDocTitle(detected, formattedUrl);

    onInsert({
      href: formattedUrl,
      title: finalTitle,
      type: detected,
    });

    setUrl("");
    setTitle("");
    setOpen(false);
  };

  const handleQuickInsert = (exampleType: GoogleDocType, exampleTitle: string, examplePath: string) => {
    onInsert({
      href: `https://docs.google.com/${examplePath}`,
      title: exampleTitle,
      type: exampleType,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {triggerButton ? (
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Insert Google Drive, Sheet, Slide, or Doc Smart Chip"
                className="flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none"
              >
                <GoogleChipIcon type="sheet" className="size-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[11px] py-1 px-2">
            Google Workspace Smart Chip
          </TooltipContent>
        </Tooltip>
      )}
      <PopoverContent className="w-80 p-3 shadow-xl border border-border" align="start">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5">
            <GoogleChipIcon type={docType} className="size-4 shrink-0" />
            <span className="text-xs font-semibold text-foreground">Insert Google Smart Chip</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground font-medium">Document URL</label>
              <Input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleInsert();
                  }
                }}
                className="h-7 text-xs font-mono"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground font-medium">Chip Title</label>
              <Input
                type="text"
                placeholder="e.g. Hikvision iVMS-4200 Attendance Integration"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleInsert();
                  }
                }}
                className="h-7 text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground font-medium">Type</label>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { type: "sheet", label: "Sheet" },
                    { type: "doc", label: "Doc" },
                    { type: "slide", label: "Slide" },
                    { type: "drive", label: "Drive" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => setDocType(item.type)}
                    className={`flex items-center justify-center gap-1 rounded py-1 px-1.5 text-[11px] border transition-colors ${
                      docType === item.type
                        ? "bg-primary/10 border-primary text-primary font-medium"
                        : "border-border/60 hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <GoogleChipIcon type={item.type} className="size-3" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Sample Presets */}
            <div className="pt-1.5 border-t border-border/40 flex flex-col gap-1">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                Quick sample chips
              </span>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() =>
                    handleQuickInsert(
                      "sheet",
                      "Hikvision iVMS-4200 Attendance Integration",
                      "spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
                    )
                  }
                  className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted text-left text-xs transition-colors group"
                >
                  <GoogleChipIcon type="sheet" className="size-3.5 shrink-0" />
                  <span className="truncate flex-1 font-medium text-foreground">
                    Hikvision iVMS-4200 Attendance Integration
                  </span>
                  <span className="text-[10px] text-muted-foreground group-hover:text-foreground">Insert</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-1.5 pt-1.5 border-t border-border/50">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} className="h-7 px-2.5 text-xs">
                Cancel
              </Button>
              <Button size="sm" disabled={!url.trim()} onClick={handleInsert} className="h-7 px-3 text-xs">
                Insert chip
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
