import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { Editor, Range } from "@tiptap/core";
import { cn } from "@/lib/utils";

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  keywords: string[];
  command: (params: { editor: Editor; range: Range }) => void;
}

export interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      props.command(item);
    }
  };

  const upHandler = () => {
    setSelectedIndex((prevIndex) => (prevIndex + props.items.length - 1) % (props.items.length || 1));
  };

  const downHandler = () => {
    setSelectedIndex((prevIndex) => (prevIndex + 1) % (props.items.length || 1));
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        upHandler();
        return true;
      }
      if (event.key === "ArrowDown") {
        downHandler();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        enterHandler();
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="z-100 min-w-56 overflow-hidden rounded-md border border-border bg-popover p-2.5 text-xs text-muted-foreground shadow-xl">
        No commands found
      </div>
    );
  }

  return (
    <div className="z-100 w-72 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl scrollbar-thin">
      <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        Slash commands
      </div>
      <div className="flex flex-col gap-0.5">
        {props.items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={item.title}
              type="button"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors cursor-pointer",
                isSelected ? "bg-accent text-accent-foreground font-medium" : "text-foreground hover:bg-muted/70",
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                selectItem(index);
              }}
            >
              <div className="flex size-6 shrink-0 items-center justify-center rounded bg-muted/80 text-foreground">
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-xs leading-tight truncate">{item.title}</div>
                <div className="text-[10px] text-muted-foreground leading-tight truncate">{item.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

SlashCommandList.displayName = "SlashCommandList";
