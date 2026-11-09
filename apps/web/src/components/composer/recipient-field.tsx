import { useState, useRef, useEffect, type KeyboardEvent, type ClipboardEvent } from "react";
import { X, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { MailAvatar } from "@/components/mail-avatar";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Contact } from "@mailfast/shared";

function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/);
  return (match ? match[1]! : str).trim().toLowerCase();
}

function parseRecipientInput(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (/[,;\n\r]/.test(trimmed)) {
    return trimmed
      .split(/[,;\n\r]+/)
      .map((s) => s.trim().replace(/^[,;\s]+|[,;\s]+$/g, ""))
      .filter(Boolean);
  }
  if (/<[^>]+>/.test(trimmed)) {
    return [trimmed];
  }
  if (/\s+/.test(trimmed)) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => p.includes("@"))) {
      return parts;
    }
  }
  return [trimmed];
}

interface RecipientFieldProps {
  label: string;
  recipients: string[];
  onChange: (recipients: string[]) => void;
  allRecipients?: string[];
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
  allRecipients,
  showCcToggle = false,
  showBccToggle = false,
  onToggleCc,
  onToggleBcc,
  placeholder,
  autoFocus = false,
}: RecipientFieldProps) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1);
    window.addEventListener("mailfast:contacts-changed", changed);
    return () => window.removeEventListener("mailfast:contacts-changed", changed);
  }, []);

  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [selectedEmail, setSelectedEmail] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingEmails = new Set((allRecipients ?? recipients).map((r) => extractEmail(r)).filter(Boolean));

  const filteredSuggestions = suggestions.filter((c) => {
    const email = extractEmail(c.email);
    return email && !existingEmails.has(email);
  });

  const trimmedInput = inputValue.trim();
  const hasExactMatch = filteredSuggestions.some(
    (c) =>
      extractEmail(c.email) === extractEmail(trimmedInput) ||
      (c.name && c.name.toLowerCase() === trimmedInput.toLowerCase()),
  );
  const showCustomAdd = Boolean(trimmedInput && !hasExactMatch);

  const selectableIds = [...filteredSuggestions.map((c) => c.email), ...(showCustomAdd ? ["__CUSTOM__"] : [])];

  // Keep selected item valid
  useEffect(() => {
    if (selectableIds.length > 0) {
      if (!selectableIds.includes(selectedEmail)) {
        setSelectedEmail(selectableIds[0]!);
      }
    } else {
      setSelectedEmail("");
    }
  }, [selectableIds, selectedEmail]);

  useEffect(() => {
    const q = inputValue.trim();
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api
        .contacts(q, 20, controller.signal)
        .then((res) => {
          if (active) {
            setSuggestions(res);
          }
        })
        .catch(() => {
          if (active) {
            setSuggestions([]);
          }
        });
    }, 40);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [inputValue, recipients, allRecipients, revision]);

  const addRecipient = (raw: string) => {
    const items = parseRecipientInput(raw);
    if (items.length === 0) return;

    const next = [...recipients];
    for (const item of items) {
      const cleanItem = item.trim();
      const cleanEmail = extractEmail(cleanItem);
      const alreadyHas = next.some((existing) => extractEmail(existing) === cleanEmail);
      if (!alreadyHas && cleanItem) {
        next.push(cleanItem);
      }
    }
    onChange(next);
    setInputValue("");
    setSelectedEmail("");
    setOpen(false);
  };

  const removeRecipient = (indexToRemove: number) => {
    onChange(recipients.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSelectContact = (contact: Contact) => {
    addRecipient(contact.email);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && selectableIds.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const currIdx = selectableIds.indexOf(selectedEmail);
        const nextIdx = currIdx === -1 ? 0 : (currIdx + 1) % selectableIds.length;
        setSelectedEmail(selectableIds[nextIdx]!);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const currIdx = selectableIds.indexOf(selectedEmail);
        const nextIdx = currIdx <= 0 ? selectableIds.length - 1 : currIdx - 1;
        setSelectedEmail(selectableIds[nextIdx]!);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (selectedEmail === "__CUSTOM__") {
          e.preventDefault();
          addRecipient(trimmedInput);
          return;
        }
        const matched = filteredSuggestions.find((c) => c.email === selectedEmail);
        if (matched) {
          e.preventDefault();
          handleSelectContact(matched);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }

    if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
      if (trimmedInput) {
        e.preventDefault();
        addRecipient(trimmedInput);
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
      className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border/40 py-1.5 px-3 text-xs bg-background/50 hover:bg-background/80 transition-colors relative"
      onClick={() => {
        inputRef.current?.focus();
        setOpen(true);
      }}
    >
      <span className="w-16 font-medium text-muted-foreground select-none shrink-0">{label}:</span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
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
                  className="text-muted-foreground hover:text-foreground focus:outline-none p-0.5 rounded-xs hover:bg-muted cursor-pointer"
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
              type="text"
              value={inputValue}
              autoFocus={autoFocus}
              placeholder={recipients.length === 0 ? (placeholder ?? "Add recipients...") : ""}
              className="flex-1 min-w-28 bg-transparent py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
              onFocus={() => {
                setOpen(true);
                void api.contacts(inputValue.trim(), 20).then((res) => {
                  setSuggestions(res);
                });
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (inputRef.current !== document.activeElement && inputValue.trim()) {
                    addRecipient(inputValue);
                  }
                  setOpen(false);
                }, 200);
              }}
              onChange={(e) => {
                setInputValue(e.target.value);
                setOpen(true);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          </div>
        </PopoverAnchor>

        <PopoverContent
          className="w-80 p-1 border border-border bg-popover shadow-2xl rounded-lg overflow-hidden z-100"
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="max-h-60 overflow-y-auto p-1 flex flex-col gap-0.5 scrollbar-thin">
            {filteredSuggestions.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Suggested contacts
                </div>
                {filteredSuggestions.map((contact) => {
                  const isSelected = contact.email === selectedEmail;
                  return (
                    <button
                      key={contact.email}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectContact(contact);
                      }}
                      onMouseEnter={() => setSelectedEmail(contact.email)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer",
                        isSelected
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-foreground hover:bg-muted/70",
                      )}
                    >
                      <MailAvatar
                        name={contact.name || contact.email}
                        email={contact.email}
                        className="size-6 text-[10px] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{contact.name || contact.email}</div>
                        {contact.name && (
                          <div className="truncate text-[10px] text-muted-foreground">{contact.email}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </>
            )}

            {showCustomAdd && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addRecipient(trimmedInput);
                }}
                onMouseEnter={() => setSelectedEmail("__CUSTOM__")}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-xs text-left transition-colors cursor-pointer",
                  filteredSuggestions.length > 0 ? "border-t border-border/40 mt-1 pt-2" : "",
                  selectedEmail === "__CUSTOM__"
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-foreground hover:bg-muted/70",
                )}
              >
                <div className="size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <UserPlus className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium flex items-center gap-1.5">
                    <span>Add</span>
                    <span className="font-semibold text-primary truncate">&quot;{trimmedInput}&quot;</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">Press Enter to add recipient</div>
                </div>
              </button>
            )}

            {filteredSuggestions.length === 0 && !showCustomAdd && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                Type an email or name to add recipient
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-1 shrink-0 select-none">
        {showCcToggle && (
          <button
            type="button"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
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
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
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
