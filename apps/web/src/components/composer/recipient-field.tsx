import { useState, useRef, type KeyboardEvent, type ClipboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface RecipientFieldProps {
  label: string;
  recipients: string[];
  onChange: (recipients: string[]) => void;
  showCcToggle?: boolean;
  showBccToggle?: boolean;
  onToggleCc?: () => void;
  onToggleBcc?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function RecipientField({
  label,
  recipients,
  onChange,
  showCcToggle = false,
  showBccToggle = false,
  onToggleCc,
  onToggleBcc,
  placeholder,
  autoFocus = false,
}: RecipientFieldProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addRecipient = (raw: string) => {
    const cleaned = raw.trim().replace(/^[,;\s]+|[,;\s]+$/g, "");
    if (!cleaned) return;

    // Check if multiple addresses were entered or pasted
    const items = cleaned
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = [...recipients];
    for (const item of items) {
      if (!next.includes(item)) {
        next.push(item);
      }
    }
    onChange(next);
    setInputValue("");
  };

  const removeRecipient = (indexToRemove: number) => {
    onChange(recipients.filter((_, idx) => idx !== indexToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
      if (inputValue.trim()) {
        e.preventDefault();
        addRecipient(inputValue);
      }
    } else if (e.key === "Backspace" && !inputValue && recipients.length > 0) {
      e.preventDefault();
      removeRecipient(recipients.length - 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (pasted.includes(",") || pasted.includes(";") || pasted.includes("\n") || pasted.includes(" ")) {
      e.preventDefault();
      addRecipient(pasted);
    }
  };

  return (
    <div
      className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border/40 py-1.5 px-3 text-xs bg-background/50 hover:bg-background/80 transition-colors"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="w-16 font-medium text-muted-foreground select-none shrink-0">{label}:</span>

      <div className="flex flex-1 flex-wrap items-center gap-1.5 min-w-40">
        {recipients.map((email, idx) => (
          <Badge
            key={`${email}-${idx}`}
            variant="secondary"
            className="gap-1 pl-2 pr-1 py-0.5 text-xs font-normal border border-border/60 max-w-64 truncate"
          >
            <span className="truncate">{email}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground focus:outline-none p-0.5 rounded-sm hover:bg-muted"
              onClick={(e) => {
                e.stopPropagation();
                removeRecipient(idx);
              }}
              title={`Remove ${email}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}

        <input
          ref={inputRef}
          type="email"
          value={inputValue}
          autoFocus={autoFocus}
          placeholder={recipients.length === 0 ? (placeholder ?? "Add recipients...") : ""}
          className="flex-1 min-w-28 bg-transparent py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => {
            if (inputValue.trim()) {
              addRecipient(inputValue);
            }
          }}
        />
      </div>

      <div className="flex items-center gap-1 shrink-0 select-none">
        {showCcToggle && (
          <button
            type="button"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-muted transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCc?.();
            }}
          >
            Cc
          </button>
        )}
        {showBccToggle && (
          <button
            type="button"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-muted transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onToggleBcc?.();
            }}
          >
            Bcc
          </button>
        )}
      </div>
    </div>
  );
}
