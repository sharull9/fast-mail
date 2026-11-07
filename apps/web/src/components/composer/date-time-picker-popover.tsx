import { useState } from "react";
import { format, addDays, nextMonday } from "date-fns";
import { Calendar as CalendarIcon, Clock, ChevronRight, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DateTimePickerPopoverProps {
  onInsert: (data: { date: string; label: string; hasTime: boolean }) => void;
  triggerButton?: React.ReactNode;
}

export function DateTimePickerPopover({ onInsert, triggerButton }: DateTimePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [selectedTime, setSelectedTime] = useState(() => format(new Date(), "HH:mm"));
  const [includeTime, setIncludeTime] = useState(true);

  const now = new Date();
  const tomorrow = addDays(now, 1);
  const monday = nextMonday(now);

  const handleSelectPreset = (dateObj: Date, labelPrefix?: string, withTime = false) => {
    let label = "";
    if (withTime) {
      label = `${labelPrefix ? `${labelPrefix}, ` : ""}${format(dateObj, "MMM d, yyyy, h:mm a")}`;
    } else {
      label = `${labelPrefix ? `${labelPrefix}, ` : ""}${format(dateObj, "MMM d, yyyy")}`;
    }

    onInsert({
      date: dateObj.toISOString(),
      label,
      hasTime: withTime,
    });
    setOpen(false);
    setShowCustom(false);
  };

  const handleCustomInsert = () => {
    try {
      const [year, month, day] = selectedDate.split("-").map(Number);
      const [hours, minutes] = selectedTime.split(":").map(Number);
      const d = new Date(year!, month! - 1, day!, includeTime ? hours : 0, includeTime ? minutes : 0);

      const label = includeTime ? format(d, "MMM d, yyyy, h:mm a") : format(d, "MMM d, yyyy");

      onInsert({
        date: d.toISOString(),
        label,
        hasTime: includeTime,
      });
      setOpen(false);
      setShowCustom(false);
    } catch {
      // ignore
    }
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
                aria-label="Insert date or time"
                className="flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none"
              >
                <CalendarIcon className="size-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[11px] py-1 px-2">
            Insert Date & Time
          </TooltipContent>
        </Tooltip>
      )}
      <PopoverContent className="w-64 p-2 shadow-xl border border-border" align="start">
        <div className="flex flex-col gap-1 text-xs">
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>Date & Time</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-primary hover:text-primary"
              onClick={() => setShowCustom(!showCustom)}
            >
              {showCustom ? "Presets" : "Custom"}
            </Button>
          </div>

          {!showCustom ? (
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-muted text-left transition-colors"
                onClick={() => handleSelectPreset(now, "Today", false)}
              >
                <div className="flex items-center gap-2">
                  <CalendarIcon className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">Today</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{format(now, "MMM d")}</span>
              </button>

              <button
                type="button"
                className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-muted text-left transition-colors"
                onClick={() => handleSelectPreset(tomorrow, "Tomorrow", false)}
              >
                <div className="flex items-center gap-2">
                  <CalendarIcon className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">Tomorrow</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{format(tomorrow, "MMM d")}</span>
              </button>

              <button
                type="button"
                className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-muted text-left transition-colors"
                onClick={() => handleSelectPreset(now, undefined, true)}
              >
                <div className="flex items-center gap-2">
                  <Clock className="size-3.5 text-primary" />
                  <span className="font-medium">Current Date & Time</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{format(now, "h:mm a")}</span>
              </button>

              <button
                type="button"
                className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-muted text-left transition-colors"
                onClick={() => handleSelectPreset(monday, "Next Monday", false)}
              >
                <div className="flex items-center gap-2">
                  <CalendarIcon className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">Next Monday</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{format(monday, "MMM d")}</span>
              </button>

              <div className="my-1 border-t border-border/50" />

              <button
                type="button"
                className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-muted text-left text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowCustom(true)}
              >
                <div className="flex items-center gap-2">
                  <Plus className="size-3.5" />
                  <span>Choose custom date...</span>
                </div>
                <ChevronRight className="size-3" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-1">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground font-medium">Date</label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>

              <div className="flex items-center justify-between py-1">
                <label htmlFor="inc-time-cb" className="text-[11px] text-muted-foreground font-medium cursor-pointer">
                  Include time
                </label>
                <input
                  id="inc-time-cb"
                  type="checkbox"
                  checked={includeTime}
                  onChange={(e) => setIncludeTime(e.target.checked)}
                  className="size-3.5 rounded border-border accent-primary cursor-pointer"
                />
              </div>

              {includeTime && (
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Time</label>
                  <Input
                    type="time"
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              )}

              <div className="flex items-center gap-1.5 pt-1 mt-1 border-t border-border/50">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-1"
                  onClick={() => setShowCustom(false)}
                >
                  Back
                </Button>
                <Button size="sm" className="h-7 text-xs flex-1" onClick={handleCustomInsert}>
                  Insert
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
