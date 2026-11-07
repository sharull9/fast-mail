import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Table as TableIcon,
  Plus,
  Trash2,
  Rows,
  Columns,
  Heading,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface TableControlsProps {
  editor: Editor;
}

export function TableControls({ editor }: TableControlsProps) {
  const [open, setOpen] = useState(false);
  const [hoverRows, setHoverRows] = useState(3);
  const [hoverCols, setHoverCols] = useState(3);

  const isInsideTable = editor.isActive("table");

  const handleInsertTable = (rows: number, cols: number) => {
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Table options"
              className={`flex size-6 items-center justify-center rounded transition-colors ${
                isInsideTable
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              } focus:outline-none`}
            >
              <TableIcon className="size-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px] py-1 px-2">
          {isInsideTable ? "Table actions" : "Insert table"}
        </TooltipContent>
      </Tooltip>

      <PopoverContent className="w-64 p-2 shadow-xl border border-border" align="start">
        {isInsideTable ? (
          <div className="flex flex-col gap-1 text-xs">
            <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Table actions
            </div>

            <div className="grid grid-cols-2 gap-1 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 justify-start text-xs gap-1.5 px-2"
                onClick={() => {
                  editor.chain().focus().addRowBefore().run();
                  setOpen(false);
                }}
              >
                <Plus className="size-3" />
                <span>Row above</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 justify-start text-xs gap-1.5 px-2"
                onClick={() => {
                  editor.chain().focus().addRowAfter().run();
                  setOpen(false);
                }}
              >
                <Plus className="size-3" />
                <span>Row below</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 justify-start text-xs gap-1.5 px-2"
                onClick={() => {
                  editor.chain().focus().addColumnBefore().run();
                  setOpen(false);
                }}
              >
                <Plus className="size-3" />
                <span>Col left</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 justify-start text-xs gap-1.5 px-2"
                onClick={() => {
                  editor.chain().focus().addColumnAfter().run();
                  setOpen(false);
                }}
              >
                <Plus className="size-3" />
                <span>Col right</span>
              </Button>
            </div>

            <div className="my-1 border-t border-border/50" />

            <div className="flex flex-col gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 justify-start text-xs gap-1.5 px-2"
                onClick={() => {
                  editor.chain().focus().toggleHeaderRow().run();
                  setOpen(false);
                }}
              >
                <Heading className="size-3" />
                <span>Toggle header row</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 justify-start text-xs gap-1.5 px-2 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  editor.chain().focus().deleteRow().run();
                  setOpen(false);
                }}
              >
                <Rows className="size-3" />
                <span>Delete row</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 justify-start text-xs gap-1.5 px-2 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  editor.chain().focus().deleteColumn().run();
                  setOpen(false);
                }}
              >
                <Columns className="size-3" />
                <span>Delete column</span>
              </Button>
            </div>

            <div className="my-1 border-t border-border/50" />

            <Button
              variant="ghost-destructive"
              size="sm"
              className="h-7 justify-start text-xs gap-1.5 px-2 text-destructive hover:bg-destructive/10"
              onClick={() => {
                editor.chain().focus().deleteTable().run();
                setOpen(false);
              }}
            >
              <Trash2 className="size-3" />
              <span>Delete table</span>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-1">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Insert Table
              </span>
              <span className="text-xs font-mono font-medium text-foreground">
                {hoverRows} × {hoverCols}
              </span>
            </div>

            {/* Interactive Grid Selector */}
            <div className="grid grid-cols-5 gap-1 p-1 bg-muted/40 rounded border border-border/50 place-items-center">
              {Array.from({ length: 5 }).map((_, r) =>
                Array.from({ length: 5 }).map((__, c) => {
                  const row = r + 1;
                  const col = c + 1;
                  const isActive = row <= hoverRows && col <= hoverCols;
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      onMouseEnter={() => {
                        setHoverRows(row);
                        setHoverCols(col);
                      }}
                      onClick={() => handleInsertTable(row, col)}
                      aria-label={`Insert ${row} by ${col} table`}
                      className={`size-4 rounded-xs border transition-colors ${
                        isActive
                          ? "bg-primary border-primary"
                          : "bg-background border-border/60 hover:border-primary/50"
                      }`}
                    />
                  );
                }),
              )}
            </div>

            <div className="flex items-center gap-1 pt-1 border-t border-border/50">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs flex-1"
                onClick={() => handleInsertTable(2, 2)}
              >
                2 × 2
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs flex-1"
                onClick={() => handleInsertTable(3, 3)}
              >
                3 × 3
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={() => handleInsertTable(hoverRows, hoverCols)}
              >
                Insert
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
