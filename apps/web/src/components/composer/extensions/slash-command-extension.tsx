import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { format } from "date-fns";
import {
  AtSign,
  Calendar,
  Table as TableIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Minus,
} from "lucide-react";
import { SlashCommandList, type SlashCommandItem, type SlashCommandListRef } from "./slash-command-list";
import { GoogleSheetsIcon } from "./google-chip-extension";

export interface SlashCommandOptions {
  onOpenGoogleChipDialog?: () => void;
  onOpenDateTimePicker?: () => void;
}

export const getSlashCommands = (options?: SlashCommandOptions): SlashCommandItem[] => [
  {
    title: "Tag User",
    description: "Mention a contact using @",
    icon: <AtSign className="size-3.5 text-primary" />,
    keywords: ["mention", "user", "tag", "contact", "@", "people"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent("@").run();
    },
  },
  {
    title: "Date & Time",
    description: "Insert interactive date/time chip",
    icon: <Calendar className="size-3.5 text-blue-500" />,
    keywords: ["date", "time", "today", "tomorrow", "calendar", "clock"],
    command: ({ editor, range }) => {
      if (options?.onOpenDateTimePicker) {
        editor.chain().focus().deleteRange(range).run();
        options.onOpenDateTimePicker();
      } else {
        const now = new Date();
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "dateTimeChip",
            attrs: {
              date: now.toISOString(),
              label: format(now, "MMM d, yyyy, h:mm a"),
              hasTime: true,
            },
          })
          .run();
      }
    },
  },
  {
    title: "Table",
    description: "Insert a 3 × 3 formatted table",
    icon: <TableIcon className="size-3.5 text-emerald-500" />,
    keywords: ["table", "grid", "rows", "columns", "spreadsheet"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },
  {
    title: "Google Smart Chip",
    description: "Drive, Sheet, Slide, or Doc chip",
    icon: <GoogleSheetsIcon className="size-3.5" />,
    keywords: ["google", "drive", "sheet", "slide", "doc", "docs", "sheets", "chip", "link"],
    command: ({ editor, range }) => {
      if (options?.onOpenGoogleChipDialog) {
        editor.chain().focus().deleteRange(range).run();
        options.onOpenGoogleChipDialog();
      } else {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "googleChip",
            attrs: {
              href: "https://docs.google.com/spreadsheets",
              title: "Hikvision iVMS-4200 Attendance Integration",
              type: "sheet",
            },
          })
          .run();
      }
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: <Heading1 className="size-3.5" />,
    keywords: ["h1", "heading", "title", "large"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: <Heading2 className="size-3.5" />,
    keywords: ["h2", "heading", "subtitle", "medium"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small subsection heading",
    icon: <Heading3 className="size-3.5" />,
    keywords: ["h3", "heading", "small"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Bullet List",
    description: "Create an unordered list",
    icon: <List className="size-3.5" />,
    keywords: ["bullet", "list", "unordered", "points"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Create an ordered list",
    icon: <ListOrdered className="size-3.5" />,
    keywords: ["number", "ordered", "list", "123"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Quote",
    description: "Capture a quote or citation",
    icon: <Quote className="size-3.5" />,
    keywords: ["quote", "blockquote", "cite"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Code Block",
    description: "Preformatted code snippet",
    icon: <SquareCode className="size-3.5" />,
    keywords: ["code", "block", "snippet", "syntax"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: "Divider",
    description: "Insert horizontal dividing line",
    icon: <Minus className="size-3.5" />,
    keywords: ["divider", "line", "horizontal", "separator", "hr"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
];

export const SlashCommandExtension = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onOpenGoogleChipDialog: undefined,
      onOpenDateTimePicker: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        items: ({ query }: { query: string }) => {
          const q = query.trim().toLowerCase();
          const all = getSlashCommands(this.options);
          if (!q) return all;
          return all.filter(
            (item) =>
              item.title.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              item.keywords.some((k) => k.toLowerCase().includes(q)),
          );
        },
        command: ({ editor, range, props }: any) => {
          props.command({ editor, range });
        },
        render: () => {
          let component: ReactRenderer<SlashCommandListRef> | null = null;
          let popupElement: HTMLDivElement | null = null;

          const updatePosition = (clientRect?: DOMRect | null) => {
            if (!popupElement || !clientRect) return;
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;
            const spaceBelow = viewportHeight - clientRect.bottom;
            const left = Math.max(8, Math.min(viewportWidth - 300, clientRect.left));

            if (spaceBelow < 280 && clientRect.top > 280) {
              popupElement.style.left = `${left}px`;
              popupElement.style.bottom = `${viewportHeight - clientRect.top + 6}px`;
              popupElement.style.top = "auto";
            } else {
              popupElement.style.left = `${left}px`;
              popupElement.style.top = `${clientRect.bottom + 6}px`;
              popupElement.style.bottom = "auto";
            }
          };

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(SlashCommandList, {
                props: {
                  items: props.items,
                  command: (item: SlashCommandItem) => {
                    props.command(item);
                  },
                },
                editor: props.editor,
              });

              popupElement = document.createElement("div");
              popupElement.className = "tiptap-slash-portal";
              popupElement.style.position = "fixed";
              popupElement.style.zIndex = "99999";
              popupElement.appendChild(component.element);
              document.body.appendChild(popupElement);

              updatePosition(props.clientRect?.());
            },

            onUpdate(props: any) {
              if (!component) return;
              component.updateProps({
                items: props.items,
                command: (item: SlashCommandItem) => {
                  props.command(item);
                },
              });
              updatePosition(props.clientRect?.());
            },

            onKeyDown(props: any) {
              if (props.event.key === "Escape") {
                if (popupElement) {
                  popupElement.remove();
                  popupElement = null;
                }
                return true;
              }
              return component?.ref?.onKeyDown(props) || false;
            },

            onExit() {
              if (popupElement) {
                popupElement.remove();
                popupElement = null;
              }
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
