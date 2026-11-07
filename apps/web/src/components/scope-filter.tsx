import { CircleAlert, Inbox, Mails, Star } from "lucide-react";
import { isInboxCategory } from "@mailfast/shared";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// `below` is the .list-col container width (rem) under which the badge collapses to an
// icon circle. Scopes collapse one at a time — Important first, Inbox last — instead of
// all at once. `activeBelow` keeps the selected scope labeled a little longer.
const scopes = [
  { id: "INBOX", name: "Inbox", icon: Inbox, below: 28, activeBelow: 24 },
  { id: "ALL", name: "All mail", icon: Mails, below: 32, activeBelow: 28 },
  { id: "STARRED", name: "Starred", icon: Star, below: 40, activeBelow: 36 },
  { id: "IMPORTANT", name: "Important", icon: CircleAlert, below: 44, activeBelow: 40 },
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
  onChange,
}: {
  labelId: string;
  labels: { id: string; unread: number }[];
  onChange: (id: string) => void;
}) {
  const active = isInboxCategory(labelId) || labelId.startsWith("CATEGORY_") ? "INBOX" : labelId;
  return (
    <div
      role="radiogroup"
      aria-label="Mail scope"
      className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-none"
    >
      {scopes.map(({ id, name, icon: Icon, below, activeBelow }, index) => {
        const isActive = active === id;
        const compact = badgeCompact[isActive ? activeBelow : below];
        const unread = labels.find((label) => label.id === id)?.unread ?? 0;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                role="radio"
                aria-checked={isActive}
                tabIndex={isActive ? 0 : -1}
                aria-label={unread > 0 ? `${name}, ${unread} unread` : name}
                className={cn(filterBadge, compact.btn, isActive && activeFilterBadge)}
                onClick={() => onChange(id)}
                onKeyDown={(event) => {
                  const step =
                    event.key === "ArrowRight" || event.key === "ArrowDown"
                      ? 1
                      : event.key === "ArrowLeft" || event.key === "ArrowUp"
                        ? -1
                        : 0;
                  if (!step && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  event.stopPropagation();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? scopes.length - 1
                        : (index + step + scopes.length) % scopes.length;
                  const buttons =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                  buttons?.[next]?.focus();
                  const scope = scopes[next];
                  if (scope) onChange(scope.id);
                }}
              >
                <Icon aria-hidden="true" />
                <span className={compact.hide}>{name}</span>
                {unread > 0 && (
                  <>
                    <span
                      className={cn(
                        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] leading-none font-medium tabular-nums",
                        compact.hide,
                        isActive && "bg-primary/20 text-primary",
                      )}
                    >
                      {unread}
                    </span>
                    {/* Compact mode: a notification dot replaces the count. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-0.5 right-0.5 hidden size-1.5 rounded-full bg-primary ring-2 ring-background",
                        compact.dot,
                      )}
                    />
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{unread > 0 ? `${name} · ${unread} unread` : name}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
