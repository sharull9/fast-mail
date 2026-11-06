import { CircleAlert, Inbox, Mails, Star } from "lucide-react";
import { isInboxCategory } from "@mailfast/shared";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const scopes = [
  { id: "INBOX", name: "Inbox", icon: Inbox },
  { id: "ALL", name: "All mail", icon: Mails },
  { id: "STARRED", name: "Starred", icon: Star },
  { id: "IMPORTANT", name: "Important", icon: CircleAlert },
];

export const filterBadge =
  "relative h-7 gap-1.5 rounded-full border border-border px-2.5 text-[12px] text-muted-foreground hover:text-foreground [&_svg]:size-3.5";
/** Narrow list panel (< 32rem): badges collapse to 28px icon circles; names and counts move to tooltips. */
export const compactFilterBadge = "@max-[32rem]:w-7 @max-[32rem]:justify-center @max-[32rem]:px-0";
export const compactHidden = "@max-[32rem]:hidden";
export const activeFilterBadge = "border-primary/30 bg-primary/15 text-primary";

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
      className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
    >
      {scopes.map(({ id, name, icon: Icon }, index) => {
        const unread = labels.find((label) => label.id === id)?.unread ?? 0;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                role="radio"
                aria-checked={active === id}
                tabIndex={active === id ? 0 : -1}
                aria-label={unread > 0 ? `${name}, ${unread} unread` : name}
                className={cn(filterBadge, compactFilterBadge, active === id && activeFilterBadge)}
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
                <span className={compactHidden}>{name}</span>
                {unread > 0 && (
                  <>
                    <span
                      className={cn(
                        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] leading-none font-medium tabular-nums",
                        compactHidden,
                        active === id && "bg-primary/20 text-primary",
                      )}
                    >
                      {unread}
                    </span>
                    {/* Compact mode: a notification dot replaces the count. */}
                    <span
                      aria-hidden="true"
                      className="absolute top-0.5 right-0.5 hidden size-1.5 rounded-full bg-primary ring-2 ring-background @max-[32rem]:block"
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
