import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { statusQuery } from "@/lib/data";
import { CalendarIcon, X } from "lucide-react";
import type { DateRange as CalendarRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { activeFilterBadge, badgeCompact, filterBadge } from "@/components/scope-filter";
import { useIsMobile } from "@/hooks/use-mobile";
import { clampDateRange, dateParam, localDate, type DateRange } from "@/lib/format";
import { cn } from "@/lib/utils";

const presets = [
  "Any time",
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "This month",
  "Last month",
  "This year",
];
const compactDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function presetRange(name: string): DateRange {
  const today = new Date();
  const from = new Date(today);
  const to = new Date(today);
  switch (name) {
    case "Any time":
      return {};
    case "Yesterday":
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
      break;
    case "Last 7 days":
      from.setDate(from.getDate() - 6);
      break;
    case "Last 30 days":
      from.setDate(from.getDate() - 29);
      break;
    case "This month":
      from.setDate(1);
      break;
    case "Last month":
      from.setDate(1);
      from.setMonth(from.getMonth() - 1);
      to.setDate(0);
      break;
    case "This year":
      from.setMonth(0, 1);
      break;
  }
  return { from: dateParam(from), to: dateParam(to) };
}

export function DateRangeFilter({ range, onChange }: { range: DateRange; onChange: (range: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CalendarRange>();
  const isMobile = useIsMobile();
  const { data: status } = useQuery(statusQuery);
  const oldestMessageDate = status?.oldestMessageDate;
  const oldest = oldestMessageDate == null ? undefined : localDate(dateParam(new Date(oldestMessageDate)));
  console.log(oldestMessageDate, "oldest");
  const today = localDate(dateParam(new Date()));
  const active = !!(range.from || range.to);
  // Staged collapse: the date badge becomes an icon between the scope badges' steps,
  // and keeps its label a little longer while a range is applied.
  const compact = badgeCompact[active ? 32 : 36];
  const label =
    range.from && range.to
      ? `${compactDate.format(localDate(range.from))} – ${compactDate.format(localDate(range.to))}`
      : range.from
        ? `Since ${compactDate.format(localDate(range.from))}`
        : range.to
          ? `Until ${compactDate.format(localDate(range.to))}`
          : "Any time";
  const apply = (next: DateRange) => {
    onChange(clampDateRange(next, oldestMessageDate));
    setOpen(false);
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next)
            setDraft({
              from: range.from ? localDate(range.from) : undefined,
              to: range.to ? localDate(range.to) : undefined,
            });
          setOpen(next);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Date range: ${label}`}
                className={cn(filterBadge, compact.btn, active && activeFilterBadge)}
              >
                <CalendarIcon aria-hidden="true" />
                <span className={compact.hide}>{label}</span>
                {active && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-0.5 right-0.5 hidden size-1.5 rounded-full bg-primary ring-2 ring-background",
                      compact.dot,
                    )}
                  />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          className="w-auto max-w-[calc(100vw-16px)] p-0"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="flex flex-col sm:flex-row">
            <div
              className="flex shrink-0 flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:border-r sm:border-b-0"
              aria-label="Date presets"
            >
              {presets.map((name) => {
                const preset = presetRange(name);
                return (
                  <Button
                    key={name}
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    disabled={!!oldest && !!preset.to && localDate(preset.to) < oldest}
                    onClick={() => apply(preset)}
                  >
                    {name}
                  </Button>
                );
              })}
            </div>
            <div className="min-w-0">
              <Calendar
                mode="range"
                disabled={oldest ? [{ before: oldest }, { after: today }] : { after: today }}
                startMonth={oldest}
                endMonth={today}
                numberOfMonths={isMobile ? 1 : 2}
                selected={draft}
                onSelect={setDraft}
                defaultMonth={draft?.from ?? (range.to ? localDate(range.to) : undefined)}
              />
              <div className="flex items-center justify-end gap-2 border-t p-2">
                {oldest && (
                  <span className="mr-auto text-xs text-muted-foreground">
                    Mail from{" "}
                    {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
                      oldest,
                    )}
                  </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => apply({})}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    apply({
                      from: draft?.from ? dateParam(draft.from) : undefined,
                      to: draft?.to ? dateParam(draft.to) : undefined,
                    })
                  }
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {active && (
        <Button variant="ghost" size="icon-xs" aria-label="Clear date filter" onClick={() => onChange({})}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
