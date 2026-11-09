import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useRef, useEffect } from "react";
import { Calendar as CalendarIcon, Clock, Trash2, Edit2, Check, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function DateTimeChipNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected } = props;
  const label = (node.attrs.label as string) || "Date";
  const date = (node.attrs.date as string) || "";
  const hasTime = Boolean(node.attrs.hasTime);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedLabel, setEditedLabel] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditedLabel(label);
  }, [label]);

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isEditing]);

  const handleSaveLabel = () => {
    const trimmed = editedLabel.trim();
    if (trimmed) {
      updateAttributes({ label: trimmed });
    }
    setIsEditing(false);
    setPopoverOpen(false);
  };

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle my-0.5 mx-1 select-none">
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] text-xs border font-medium cursor-pointer transition-colors ${
              selected
                ? "bg-primary/15 text-primary border-primary ring-1 ring-primary"
                : "bg-muted/70 hover:bg-muted border-border/70 text-foreground"
            }`}
          >
            {hasTime ? (
              <Clock className="size-3 text-muted-foreground shrink-0" />
            ) : (
              <CalendarIcon className="size-3 text-muted-foreground shrink-0" />
            )}
            <span>{label}</span>
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2.5 shadow-lg border border-border" align="start">
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-foreground">Edit date label</span>
              <div className="flex items-center gap-1">
                <Input
                  ref={inputRef}
                  value={editedLabel}
                  onChange={(e) => setEditedLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveLabel();
                    } else if (e.key === "Escape") {
                      setIsEditing(false);
                    }
                  }}
                  className="h-7 text-xs flex-1"
                />
                <Button size="sm" onClick={handleSaveLabel} className="h-7 px-2">
                  <Check className="size-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-7 px-2">
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {hasTime ? (
                  <Clock className="size-4 text-primary shrink-0" />
                ) : (
                  <CalendarIcon className="size-4 text-primary shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{label}</p>
                  {date && <p className="text-[10px] text-muted-foreground truncate">{date}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1 pt-1 border-t border-border/50 justify-between">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setIsEditing(true)}>
                  <Edit2 className="size-3" />
                  <span>Edit label</span>
                </Button>
                <Button
                  variant="ghost-destructive"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-destructive hover:bg-destructive/10"
                  onClick={() => deleteNode()}
                >
                  <Trash2 className="size-3" />
                  <span>Remove</span>
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

export const DateTimeExtension = Node.create({
  name: "dateTimeChip",

  group: "inline",

  inline: true,

  atom: true,

  selectable: true,

  addAttributes() {
    return {
      date: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-date") || "",
        renderHTML: (attrs: Record<string, any>) => ({
          "data-date": attrs.date,
        }),
      },
      label: {
        default: "Date",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-label") || el.textContent?.trim() || "Date",
        renderHTML: (attrs: Record<string, any>) => ({
          "data-label": attrs.label,
        }),
      },
      hasTime: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-has-time") === "true",
        renderHTML: (attrs: Record<string, any>) => ({
          "data-has-time": attrs.hasTime ? "true" : "false",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="date-time-chip"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }: { node: any; HTMLAttributes: Record<string, any> }) {
    const label = node.attrs.label || "Date";
    const date = node.attrs.date || "";
    const hasTime = Boolean(node.attrs.hasTime);

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "date-time-chip",
        "data-date": date,
        "data-label": label,
        "data-has-time": hasTime ? "true" : "false",
        class: "date-time-chip",
        style:
          "display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 5px; background-color: #f1f3f4; color: #3c4043; font-size: 12px; font-weight: 500; border: 1px solid #dadce0; margin: 0 2px; vertical-align: middle;",
      }),
      ["span", { style: "font-size: 11px;" }, hasTime ? "🕒" : "📅"],
      ["span", { style: "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;" }, label],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DateTimeChipNodeView);
  },
});
