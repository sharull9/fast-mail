import { useState } from "react";
import { Check, ChevronDown, CircleAlert, Inbox, Mails, Star } from "lucide-react";
import { isInboxCategory } from "@mailfast/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { labelName } from "@/lib/format";
import { cn } from "@/lib/utils";

const scopes = [
  { id: "INBOX", name: "Inbox", icon: Inbox },
  { id: "ALL", name: "All mail", icon: Mails },
  { id: "STARRED", name: "Starred", icon: Star },
  { id: "IMPORTANT", name: "Important", icon: CircleAlert },
];

export const filterBadge =
  "relative h-7 gap-1.5 rounded-full border border-border px-2.5 text-[12px] text-muted-foreground hover:text-foreground [&_svg]:size-3.5";
export const activeFilterBadge = "border-primary/30 bg-primary/15 text-primary";

/** Icon-circle collapse classes for filter badges, keyed by container width in rem.
 *  Each control picks its own step so items collapse progressively as the panel narrows. */
export const badgeCompact: Record<number, { btn: string; hide: string; dot: string }> = {
  24: {
    btn: "@max-sm:w-7 @max-sm:justify-center @max-sm:px-0",
    hide: "@max-sm:hidden",
    dot: "@max-sm:block",
  },
  28: {
    btn: "@max-md:w-7 @max-md:justify-center @max-md:px-0",
    hide: "@max-md:hidden",
    dot: "@max-md:block",
  },
  32: {
    btn: "@max-lg:w-7 @max-lg:justify-center @max-lg:px-0",
    hide: "@max-lg:hidden",
    dot: "@max-lg:block",
  },
  36: {
    btn: "@max-xl:w-7 @max-xl:justify-center @max-xl:px-0",
    hide: "@max-xl:hidden",
    dot: "@max-xl:block",
  },
  40: {
    btn: "@max-[40rem]:w-7 @max-[40rem]:justify-center @max-[40rem]:px-0",
    hide: "@max-[40rem]:hidden",
    dot: "@max-[40rem]:block",
  },
  44: {
    btn: "@max-[44rem]:w-7 @max-[44rem]:justify-center @max-[44rem]:px-0",
    hide: "@max-[44rem]:hidden",
    dot: "@max-[44rem]:block",
  },
};

export function ScopeFilter({
  labelId,
  labels,
  collapsed,
  onChange,
}: {
  labelId: string;
  labels: { id: string; unread: number }[];
  collapsed?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = isInboxCategory(labelId) || labelId.startsWith("CATEGORY_") ? "INBOX" : labelId;
  const currentScope = scopes.find((s) => s.id === active) ?? {
    id: labelId,
    name: labelName(labelId),
    icon: Inbox,
  };
  const CurrentIcon = currentScope.icon;
  const unread = labels.find((label) => label.id === currentScope.id)?.unread ?? 0;
  const compact = badgeCompact[32];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {collapsed ? (
              <Button
                variant="ghost"
                size="icon"
                role="combobox"
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={`Filter: ${currentScope.name}${unread > 0 ? `, ${unread} unread` : ""}`}
                className={cn(
                  "relative size-8 shrink-0 rounded-full border border-border/80 text-muted-foreground hover:text-foreground cursor-pointer font-medium hover:bg-primary/20",
                  activeFilterBadge,
                )}
              >
                <CurrentIcon className="size-4 shrink-0" aria-hidden="true" />
                {unread > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-1.5 ring-background"
                  />
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                role="combobox"
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={`Filter: ${currentScope.name}${unread > 0 ? `, ${unread} unread` : ""}`}
                className={cn(
                  filterBadge,
                  compact.btn,
                  activeFilterBadge,
                  "cursor-pointer font-medium hover:bg-primary/20",
                )}
              >
                <CurrentIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className={cn("truncate", compact.hide)}>{currentScope.name}</span>
                {unread > 0 && (
                  <>
                    <span
                      className={cn(
                        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] leading-none font-medium tabular-nums text-primary",
                        compact.hide,
                      )}
                    >
                      {unread}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-1 right-1 hidden size-1.5 rounded-full bg-primary ring-1.5 ring-background",
                        compact.dot,
                      )}
                    />
                  </>
                )}
                <ChevronDown className={cn("size-3 shrink-0 opacity-60", compact.hide)} aria-hidden="true" />
              </Button>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={collapsed ? "right" : "bottom"}>
          Filter: {currentScope.name}
          {unread > 0 ? ` · ${unread} unread` : ""}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side={collapsed ? "right" : "bottom"}
        align="start"
        className="w-48 p-1"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div role="radiogroup" aria-label="Mail filter options" className="flex flex-col gap-0.5">
          {scopes.map(({ id, name, icon: Icon }) => {
            const isActive = active === id;
            const count = labels.find((label) => label.id === id)?.unread ?? 0;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-left transition-colors outline-hidden cursor-pointer",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">{name}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] leading-none font-medium tabular-nums",
                      isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
                {isActive && <Check className="size-3.5 shrink-0 text-primary ml-1" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
