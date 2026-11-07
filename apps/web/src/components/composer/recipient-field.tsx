import { useState, useRef, useEffect, type KeyboardEvent, type ClipboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { MailAvatar } from "@/components/mail-avatar";
import { api } from "@/lib/api";
import type { Contact } from "@mailfast/shared";

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
  const [selectedEmail, setSelectedEmail] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = inputValue.trim();
    if (!q) {
      setSuggestions([]);
      setSelectedEmail("");
      setOpen(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api
        .contacts(q, 15, controller.signal)
        .then((res) => {
          if (active) {
            setSuggestions(res);
            const available = res.filter((c) => !recipients.includes(c.email));
            if (available.length > 0) {
              setSelectedEmail(available[0]!.email);
              setOpen(true);
            } else {
              setSelectedEmail("");
              setOpen(false);
            }
          }
        })
        .catch(() => {
          if (active) {
            setSuggestions([]);
            setOpen(false);
          }
        });
    }, 100);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [inputValue, recipients]);

  const filteredSuggestions = suggestions.filter((c) => !recipients.includes(c.email));

  useEffect(() => {
    if (selectedEmail) {
      const el = document.querySelector(`[cmdk-item][data-value="${selectedEmail}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedEmail]);

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
    if (open && filteredSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const currIdx = filteredSuggestions.findIndex((c) => c.email === selectedEmail);
        const nextIdx = currIdx === -1 ? 0 : (currIdx + 1) % filteredSuggestions.length;
        setSelectedEmail(filteredSuggestions[nextIdx]!.email);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const currIdx = filteredSuggestions.findIndex((c) => c.email === selectedEmail);
        const nextIdx = currIdx <= 0 ? filteredSuggestions.length - 1 : currIdx - 1;
        setSelectedEmail(filteredSuggestions[nextIdx]!.email);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && selectedEmail) {
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
      className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border/40 py-1.5 px-3 text-xs bg-background/50 hover:bg-background/80 transition-colors relative"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="w-16 font-medium text-muted-foreground select-none shrink-0">{label}:</span>

      <Popover open={open && filteredSuggestions.length > 0} onOpenChange={setOpen}>
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
              onFocus={() => {
                if (filteredSuggestions.length > 0) setOpen(true);
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (inputValue.trim() && !open) {
                    addRecipient(inputValue);
                  }
                }, 150);
              }}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          </div>
        </PopoverAnchor>

        <PopoverContent
          className="w-80 p-0 border border-border bg-popover shadow-2xl rounded-lg overflow-hidden"
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Command
            shouldFilter={false}
            value={selectedEmail}
            onValueChange={setSelectedEmail}
            className="bg-transparent"
          >
            <CommandList className="max-h-56 p-1 scrollbar-thin">
              {filteredSuggestions.length === 0 ? (
                <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
                  No contacts found
                </CommandEmpty>
              ) : (
                <CommandGroup
                  heading="Contacts"
                  className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-[10px]"
                >
                  {filteredSuggestions.map((contact) => (
                    <CommandItem
                      key={contact.email}
                      value={contact.email}
                      onSelect={() => handleSelectContact(contact)}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs cursor-pointer select-none"
                    >
                      <MailAvatar
                        name={contact.name || contact.email}
                        email={contact.email}
                        className="size-6 text-[10px]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{contact.name || contact.email}</div>
                        {contact.name && (
                          <div className="truncate text-[10px] text-muted-foreground">{contact.email}</div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

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
