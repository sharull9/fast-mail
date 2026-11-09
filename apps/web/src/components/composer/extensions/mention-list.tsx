import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { Contact } from "@mailfast/shared";
import { MailAvatar } from "@/components/mail-avatar";
import { cn } from "@/lib/utils";

export interface MentionListProps {
  items: Contact[];
  command: (item: { id: string; label: string; email: string }) => void;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      props.command({
        id: item.email,
        label: item.name || item.email.split("@")[0] || item.email,
        email: item.email,
      });
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
      <div className="z-50 min-w-48 overflow-hidden rounded-md border border-border bg-popover p-2 text-xs text-muted-foreground shadow-md">
        No contacts found
      </div>
    );
  }

  return (
    <div className="z-50 w-64 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md scrollbar-thin">
      <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Tag user</div>
      {props.items.map((item, index) => {
        const isSelected = index === selectedIndex;
        return (
          <button
            key={item.email}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
              isSelected ? "bg-accent text-accent-foreground font-medium" : "text-foreground hover:bg-muted/70",
            )}
            onClick={() => selectItem(index)}
          >
            <MailAvatar name={item.name} email={item.email} className="size-5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium leading-none">{item.name || item.email}</div>
              {item.name && <div className="truncate text-[10px] text-muted-foreground mt-0.5">{item.email}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
});

MentionList.displayName = "MentionList";
