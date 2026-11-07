import { useState, useRef, useEffect, type KeyboardEvent, type ClipboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { Contact } from "@mailfast/shared";
import { cn } from "@/lib/utils";

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
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = inputValue.trim();
    if (!q) {
      setSuggestions([]);
      setSelectedIndex(-1);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api
        .contacts(q, 8, controller.signal)
        .then((res) => {
          if (active) {
            setSuggestions(res);
            setSelectedIndex(-1);
          }
        })
        .catch(() => {
          if (active) setSuggestions([]);
        });
    }, 100);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [inputValue]);

  const filteredSuggestions = suggestions.filter((c) => !recipients.includes(c.email));
  const showDropdown = isFocused && inputValue.trim().length > 0 && filteredSuggestions.length > 0;

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
    setSuggestions([]);
    setSelectedIndex(-1);
  };

  const removeRecipient = (indexToRemove: number) => {
    onChange(recipients.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSelectContact = (contact: Contact) => {
    addRecipient(contact.email);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showDropdown) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? filteredSuggestions.length - 1 : prev - 1));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && selectedIndex >= 0 && filteredSuggestions[selectedIndex]) {
        e.preventDefault();
        handleSelectContact(filteredSuggestions[selectedIndex]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggestions([]);
        setSelectedIndex(-1);
        return;
      }
    }

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
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-2 border-b border-border/40 py-1.5 px-3 text-xs bg-background/50 hover:bg-background/80 transition-colors relative",
        showDropdown && "z-30",
      )}
      onClick={() => inputRef.current?.focus()}
    >
      <span className="w-16 font-medium text-muted-foreground select-none shrink-0">{label}:</span>

      <div className="flex flex-1 flex-wrap items-center gap-1.5 min-w-40 relative">
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
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            // Small timeout allows mousedown on suggestions to trigger
            setTimeout(() => {
              setIsFocused(false);
              if (inputValue.trim() && selectedIndex === -1) {
                addRecipient(inputValue);
              }
            }, 180);
          }}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        {/* Contact Autocomplete Suggestions */}
        {showDropdown && (
          <div
            className="absolute left-0 top-full z-50 mt-1 max-h-56 w-80 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-2xl"
            role="listbox"
          >
            {filteredSuggestions.map((contact, idx) => {
              const isSelected = idx === selectedIndex;
              const initials = (contact.name || contact.email).slice(0, 2).toUpperCase();
              return (
                <div
                  key={`${contact.email}-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition-colors select-none",
                    isSelected ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectContact(contact);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{contact.name || contact.email}</div>
                    {contact.name && <div className="truncate text-[10px] text-muted-foreground">{contact.email}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
