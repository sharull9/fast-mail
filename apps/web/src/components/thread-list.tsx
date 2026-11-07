import { useHotkeys } from "@tanstack/react-hotkeys";
import { appHotkeys, shortcutLabel, type ShortcutId } from "@/lib/hotkeys";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, CircleAlert, MoreHorizontal } from "lucide-react";
import type { ThreadAction, ThreadRow } from "@mailfast/shared";
import { authQuery, prefetchThread, runThreadAction } from "@/lib/data";
import { cleanSnippet, dateGroup, listDate, sendersLabel } from "@/lib/format";
import { openExternal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useThreadSelection } from "@/hooks/use-thread-selection";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/icon";
import { IconButton } from "@/components/icon-button";
import { MailAvatar } from "@/components/mail-avatar";

interface Props {
  threads: ThreadRow[];
  selectedId: string | undefined;
  onOpen: (id: string) => void;
  onClose: () => void;
  onEndReached?: () => void;
  empty: string;
  labelId?: string;
  total?: number;
  toolbarStart?: ReactNode;
  emptyAction?: ReactNode;
}

export function act(ids: string[], action: ThreadAction) {
  if (ids.length > 0) runThreadAction({ threadIds: ids, action });
}

const GROUP_STORAGE_KEY = "mailfast.list-groups";

function readGroupOverrides(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(GROUP_STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

type ListItem =
  | { kind: "header"; key: string; label: string; count: number; collapsed: boolean }
  | { kind: "thread"; thread: ThreadRow };

export function ThreadList({
  threads,
  selectedId,
  onOpen,
  onClose,
  onEndReached,
  empty,
  labelId,
  total,
  toolbarStart,
  emptyAction,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [groupOverrides, setGroupOverrides] = useState(readGroupOverrides);
  const account = useQuery(authQuery).data?.account ?? "";
  const groups = useMemo(() => {
    const result: { group: ReturnType<typeof dateGroup>; threads: ThreadRow[] }[] = [];
    for (const thread of threads) {
      const group = dateGroup(thread.lastDate);
      let entry = result.at(-1);
      if (entry?.group.key !== group.key) {
        entry = { group, threads: [] };
        result.push(entry);
      }
      entry.threads.push(thread);
    }
    return result;
  }, [threads]);
  const flat = useMemo(() => {
    const result: ListItem[] = [];
    for (const { group, threads } of groups) {
      const collapsed = groupOverrides[group.key] ?? group.collapsed;
      result.push({ kind: "header", ...group, count: threads.length, collapsed });
      if (!collapsed) {
        for (const thread of threads) result.push({ kind: "thread", thread });
      }
    }
    return result;
  }, [groups, groupOverrides]);
  const visibleThreads = useMemo(() => flat.flatMap((item) => (item.kind === "thread" ? [item.thread] : [])), [flat]);
  const ids = useMemo(() => visibleThreads.map((thread) => thread.id), [visibleThreads]);
  const selection = useThreadSelection(ids);
  const setGroupCollapsed = useCallback((key: string, collapsed: boolean) => {
    setGroupOverrides((previous) => {
      const next = { ...previous, [key]: collapsed };
      try {
        localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Keep groups usable when browser storage is unavailable.
      }
      return next;
    });
  }, []);
  // Callback ref: the list element mounts after the empty/loading states, so measure its width
  // synchronously on attach (no 44px-stride first paint) and keep observing it while mounted.
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const attachList = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    resizeObserver.current?.disconnect();
    resizeObserver.current = null;
    if (!element) return;
    setNarrow(element.clientWidth < 560);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < 560);
    });
    observer.observe(element);
    resizeObserver.current = observer;
  }, []);
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (flat[index]?.kind === "header" ? 36 : narrow ? ROW_NARROW : ROW_WIDE),
    overscan: 15,
  });
  useEffect(() => {
    virtualizer.measure();
    if (pendingScroll.current) {
      const index = flat.findIndex((item) => item.kind === "thread" && item.thread.id === pendingScroll.current);
      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: "auto" });
        pendingScroll.current = null;
      }
    }
  }, [narrow, flat, virtualizer]);
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  const lastGroup = groups.at(-1)?.group;
  const lastGroupExpanded = !!lastGroup && !(groupOverrides[lastGroup.key] ?? lastGroup.collapsed);
  const lastGroupHeaderIndex = flat.findIndex((item) => item.kind === "header" && item.key === lastGroup?.key);
  useEffect(() => {
    if (onEndReached && lastGroupExpanded && lastIndex > lastGroupHeaderIndex && lastIndex >= flat.length - 30)
      onEndReached();
  }, [lastIndex, flat.length, lastGroupExpanded, lastGroupHeaderIndex, onEndReached]);
  const firstIds = threads
    .slice(0, 6)
    .map((t) => t.id)
    .join(",");
  useEffect(() => {
    if (!firstIds) return;
    const handle = requestIdleCallback(() => firstIds.split(",").forEach(prefetchThread));
    return () => cancelIdleCallback(handle);
  }, [firstIds]);
  const state = useRef({ threads, selectedId, onOpen, onClose, selection, account });
  state.current = { threads, selectedId, onOpen, onClose, selection, account };
  // The thread j/k last moved to. `selectedId` comes from the route and lags a render behind
  // navigation, so a fast second keypress would otherwise start from a stale position.
  const cursor = useRef(selectedId);
  useEffect(() => {
    cursor.current = selectedId;
  }, [selectedId]);
  const targetIds = useCallback((id: string) => {
    const { selection } = state.current;
    return selection.selectedIds.includes(id) ? selection.selectedIds : [id];
  }, []);
  const perform = useCallback(
    (id: string, action: ThreadAction) => {
      act(targetIds(id), action);
      state.current.selection.clear();
    },
    [targetIds],
  );
  const click = useCallback((id: string, event: MouseEvent) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      state.current.selection.toggle(id, event.shiftKey);
    } else {
      state.current.selection.anchorAt(id);
      state.current.onOpen(id);
    }
  }, []);
  const toggle = selection.toggle;
  const selectAll = selection.selectAll;
  const gmail = useCallback(
    (id: string) =>
      openExternal(`https://mail.google.com/mail/?authuser=${encodeURIComponent(state.current.account)}#all/${id}`),
    [],
  );
  const listHotkeys = [
    appHotkeys.next,
    appHotkeys.nextArrow,
    appHotkeys.previous,
    appHotkeys.previousArrow,
    appHotkeys.open,
    appHotkeys.close,
    appHotkeys.select,
    appHotkeys.selectAll,
    appHotkeys.archive,
    appHotkeys.trash,
    appHotkeys.trashDelete,
    appHotkeys.star,
    appHotkeys.read,
    appHotkeys.unread,
  ];
  useHotkeys(
    listHotkeys.map((hotkey) => ({
      hotkey,
      callback: (e) => {
        const id = hotkey.id;
        const el = e.target;
        if (!(el instanceof HTMLElement)) return;
        // Keep native activation on row controls and collapsible group headers.
        if (
          id === "open" &&
          el.closest(
            'button, [role="checkbox"], [role="tab"], [role="radio"], .group-header, .row-important, .row-star',
          )
        )
          return;
        const { threads, selectedId, onOpen, onClose, selection } = state.current;
        if (id === "selectAll") {
          e.preventDefault();
          selection.selectAll();
          return;
        }
        const focused = el.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId;
        const index = threads.findIndex((t) => t.id === (focused ?? cursor.current ?? selectedId));
        const sel = threads[index];
        const selected = selection.selectedIds.length ? selection.selectedIds : sel ? [sel.id] : [];
        const move = (to: number) => {
          if (to >= threads.length) onEndReached?.();
          const t = threads[Math.max(0, Math.min(threads.length - 1, to))];
          if (!t) return;
          const flatIndex = flat.findIndex((item) => item.kind === "thread" && item.thread.id === t.id);
          if (flatIndex < 0) {
            pendingScroll.current = t.id;
            setGroupCollapsed(dateGroup(t.lastDate).key, false);
          } else virtualizer.scrollToIndex(flatIndex, { align: "auto" });
          cursor.current = t.id;
          onOpen(t.id);
          if (focused) el.blur();
          for (const neighbour of threads.slice(Math.max(0, to - 1), to + 3)) prefetchThread(neighbour.id);
        };
        const run = (action: ThreadAction, advance = false) => {
          act(selected, action);
          if (selection.selectedIds.length) selection.clear();
          else if (advance && sel) {
            const next = threads[index + 1] ?? threads[index - 1];
            if (next) onOpen(next.id);
            else onClose();
          }
        };
        switch (id) {
          case "next":
          case "nextArrow":
            move(index + 1);
            break;
          case "previous":
          case "previousArrow":
            move(index < 0 ? 0 : index - 1);
            break;
          case "open":
            if (sel) onOpen(sel.id);
            else if (threads[0]) onOpen(threads[0].id);
            break;
          case "close":
            if (selection.selectedIds.length) selection.clear();
            else onClose();
            break;
          case "select":
            if (sel) selection.toggle(sel.id);
            break;
          case "archive":
            run({ kind: labelId === "ALL" || labelId === "ARCHIVE" ? "inbox" : "archive" }, true);
            break;
          case "trash":
          case "trashDelete":
            run({ kind: labelId === "TRASH" ? "untrash" : "trash" }, true);
            break;
          case "star":
            run({ kind: (sel ?? threads.find((t) => t.id === selected[0]))?.starred ? "unstar" : "star" });
            break;
          case "read":
            run({ kind: "read" });
            break;
          case "unread":
            run({ kind: "unread" });
            break;
          default:
            return;
        }
        e.preventDefault();
      },
    })),
    { ignoreInputs: true, ignoreDefaultPrevented: true, preventDefault: false },
  );
  const count = selection.selectedIds.length;
  const bulk = (action: ThreadAction) => {
    act(selection.selectedIds, action);
    selection.clear();
  };
  const archive = labelId === "ALL" || labelId === "ARCHIVE" ? "inbox" : "archive";
  const trash = labelId === "TRASH" ? "untrash" : "trash";
  return (
    <>
      <div className="selection-bar flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <Checkbox
          aria-label="Select all"
          checked={count > 0 && count === ids.length ? true : count > 0 ? "indeterminate" : false}
          onCheckedChange={() => (count === ids.length ? selection.clear() : selection.selectAll())}
        />
        {count ? (
          <span className="shrink-0 text-muted-foreground">{count} selected</span>
        ) : (
          (toolbarStart ?? <span className="shrink-0 text-muted-foreground">Select all</span>)
        )}
        {count ? (
          <div className="ml-auto flex items-center gap-0.5">
            {(
              [
                { kind: archive, name: archive === "inbox" ? "Move to Inbox" : "Archive", icon: "archive" },
                { kind: trash, name: trash === "untrash" ? "Restore" : "Delete", icon: "TRASH" },
                { kind: "read", name: "Mark read", icon: "read" },
                { kind: "unread", name: "Mark unread", icon: "unread" },
                { kind: "star", name: "Star", icon: "STARRED" },
              ] satisfies { kind: ThreadAction["kind"]; name: string; icon: string }[]
            ).map((a) => (
              <IconButton
                key={a.kind}
                label={a.name}
                variant={a.kind === "trash" ? "ghost-destructive" : "ghost"}
                onClick={() => bulk({ kind: a.kind })}
              >
                <Icon name={a.icon} />
              </IconButton>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More selection actions">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => bulk({ kind: "unstar" })}>Unstar</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => bulk({ kind: "important" })}>Mark important</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => bulk({ kind: "unimportant" })}>Mark unimportant</DropdownMenuItem>
                <DropdownMenuItem onSelect={selection.clear}>Clear selection</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <span
            className={cn(
              "ml-auto shrink-0 whitespace-nowrap text-muted-foreground tabular-nums @max-[30rem]:hidden",
              // Next to the inbox category tabs the count only fits in a wider list panel.
              toolbarStart && "@max-xl:hidden",
            )}
          >
            {threads.length
              ? `1–${threads.length} of ${Math.max(threads.length, total ?? 0).toLocaleString()}`
              : "0 of 0"}
          </span>
        )}
      </div>
      {threads.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>{empty}</EmptyDescription>
            {emptyAction}
          </EmptyHeader>
        </Empty>
      ) : (
        <div ref={attachList} className="list">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {items.map((v) => {
              const item = flat[v.index];
              if (!item) return null;
              if (item.kind === "header")
                return (
                  <button
                    key={`group:${item.key}`}
                    type="button"
                    aria-expanded={!item.collapsed}
                    onClick={() => setGroupCollapsed(item.key, !item.collapsed)}
                    className="group-header group/header absolute inset-x-0 flex h-9 w-full items-center gap-2 border-b border-border/60 bg-background/95 px-5 text-left text-[12px] font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                    style={{ transform: `translateY(${v.start}px)` }}
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 group-hover/header:text-foreground",
                        !item.collapsed && "rotate-90",
                      )}
                    />
                    {item.label}
                    <span className="rounded-full bg-foreground/[0.07] px-1.5 py-px text-[10.5px] font-medium tracking-normal tabular-nums group-hover/header:bg-foreground/12 group-hover/header:text-foreground">
                      {item.count}
                    </span>
                  </button>
                );
              const t = item.thread;
              return (
                <Row
                  key={t.id}
                  thread={t}
                  top={v.start}
                  opened={t.id === selectedId}
                  checked={selection.selected.has(t.id)}
                  narrow={narrow}
                  showImportant={labelId !== "IMPORTANT"}
                  onOpen={onOpen}
                  onClick={click}
                  onToggle={toggle}
                  onSelectAll={selectAll}
                  onAction={perform}
                  onGmail={gmail}
                  targetIds={targetIds}
                />
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// Card heights, including the 4px gutter between cards (2px above and below each card).
const ROW_WIDE = 70;
const ROW_NARROW = 90;
const ROW_GUTTER = 2;

const Row = memo(function Row({
  thread: t,
  top,
  opened,
  checked,
  narrow,
  showImportant,
  onOpen,
  onClick,
  onToggle,
  onSelectAll,
  onAction,
  onGmail,
  targetIds,
}: {
  thread: ThreadRow;
  top: number;
  opened: boolean;
  checked: boolean;
  narrow: boolean;
  showImportant: boolean;
  onOpen: (id: string) => void;
  onClick: (id: string, event: MouseEvent) => void;
  onToggle: (id: string, range?: boolean) => void;
  onSelectAll: () => void;
  onAction: (id: string, action: ThreadAction) => void;
  onGmail: (id: string) => void;
  targetIds: (id: string) => string[];
}) {
  const [contextCount, setContextCount] = useState(1);
  const inInbox = t.labelIds.includes("INBOX");
  const inTrash = t.labelIds.includes("TRASH");
  const actions: { name: string; icon: string; kind: ThreadAction["kind"]; shortcut?: ShortcutId }[] = [
    {
      name: inInbox ? "Archive" : "Move to Inbox",
      icon: "archive",
      kind: inInbox ? "archive" : "inbox",
      shortcut: "archive",
    },
    { name: inTrash ? "Restore" : "Delete", icon: "TRASH", kind: inTrash ? "untrash" : "trash", shortcut: "trash" },
    {
      name: t.unread ? "Mark read" : "Mark unread",
      icon: t.unread ? "read" : "unread",
      kind: t.unread ? "read" : "unread",
      shortcut: t.unread ? "read" : "unread",
    },
    { name: t.starred ? "Unstar" : "Star", icon: "STARRED", kind: t.starred ? "unstar" : "star", shortcut: "star" },
    {
      name: t.important ? "Mark unimportant" : "Mark important",
      icon: "IMPORTANT",
      kind: t.important ? "unimportant" : "important",
    },
  ];
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) setContextCount(targetIds(t.id).length);
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          data-thread-id={t.id}
          role="row"
          aria-label={`${sendersLabel(t.senders, t.messageCount)}, ${t.subject || "(no subject)"}${t.important ? ", important" : ""}`}
          aria-selected={checked}
          tabIndex={0}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/mailfast-thread", t.id);
            e.dataTransfer.setData("text/plain", t.id);
            e.dataTransfer.effectAllowed = "copyMove";
          }}
          className={cn(
            "row group cursor-grab active:cursor-grabbing",
            (opened || checked) && "selected",
            opened && "opened",
            t.unread && "unread",
            narrow && "narrow",
          )}
          style={{
            transform: `translateY(${top + ROW_GUTTER}px)`,
            height: (narrow ? ROW_NARROW : ROW_WIDE) - ROW_GUTTER * 2,
          }}
          onMouseEnter={() => prefetchThread(t.id)}
          onClick={(e) => onClick(t.id, e)}
        >
          {/* Level 0: state. Unread lives in the gutter so it never shifts the text. */}
          {t.unread && <span className="row-unread-dot" aria-hidden="true" />}
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={`Select ${t.subject || "conversation"}`}
            className={cn(
              "relative flex size-8 shrink-0 cursor-pointer items-center justify-center self-start rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              !checked && "group-hover:ring-1 group-hover:ring-border",
              checked && "bg-primary text-primary-foreground",
            )}
            data-avatar-slot
            onClick={(e) => {
              e.stopPropagation();
              onToggle(t.id, e.shiftKey);
            }}
          >
            {checked ? (
              <Check aria-hidden="true" className="row-selection-check size-4" strokeWidth={3} />
            ) : (
              <MailAvatar className="size-8" name={t.senders[0]?.name ?? ""} email={t.senders[0]?.email ?? ""} />
            )}
          </button>
          <div className="row-main">
            {/* Level 1: who + when, with signals as compact tags. */}
            <div className="row-head">
              <span className="from">{sendersLabel(t.senders, t.messageCount)}</span>
              <span className="row-meta translate-y-0 group-[:not(.narrow)]:-translate-y-2 transition-all">
                {t.important && showImportant && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Marked important — click to unmark"
                        className="row-important"
                        onClick={(e) => {
                          e.stopPropagation();
                          act([t.id], { kind: "unimportant" });
                        }}
                      >
                        <CircleAlert aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Important</TooltipContent>
                  </Tooltip>
                )}
                {t.starred && (
                  <button
                    type="button"
                    aria-label="Unstar"
                    className="row-star"
                    onClick={(e) => {
                      e.stopPropagation();
                      act([t.id], { kind: "unstar" });
                    }}
                  >
                    <Icon name="STARRED" />
                  </button>
                )}
                <span className="date">{listDate(t.lastDate)}</span>
              </span>
            </div>
            {/* Level 2: what (subject). Level 3: context (snippet), its own line when narrow. */}
            <div className="row-body">
              <span className="subject">{t.subject || "(no subject)"}</span>
              <span className="snippet">{cleanSnippet(t.snippet)}</span>
            </div>
          </div>
          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            {actions
              .slice(0, 3)
              .filter((_, i) => i !== 1)
              .concat(actions.slice(1, 2))
              .map((a) => (
                <IconButton
                  key={a.kind}
                  label={a.name}
                  variant={a.kind === "trash" ? "ghost-destructive" : "ghost"}
                  onClick={() => act([t.id], { kind: a.kind })}
                >
                  <Icon name={a.icon} />
                </IconButton>
              ))}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuLabel>{contextCount > 1 ? `${contextCount} conversations` : "Conversation"}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onOpen(t.id)}>
          <Icon name="unread" />
          Open
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onGmail(t.id)}>
          <Icon name="external" />
          Open in Gmail
        </ContextMenuItem>
        <ContextMenuSeparator />
        {actions.map((a) => (
          <ContextMenuItem
            key={a.kind}
            variant={a.kind === "trash" ? "destructive" : "default"}
            onSelect={() => onAction(t.id, { kind: a.kind })}
          >
            <Icon name={a.icon} />
            {a.name}
            {a.shortcut && <ContextMenuShortcut>{shortcutLabel(a.shortcut)}</ContextMenuShortcut>}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onToggle(t.id)}>
          <Icon name="command" />
          {checked ? "Deselect" : "Select"}
          <ContextMenuShortcut>{shortcutLabel("select")}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onSelectAll}>
          <Icon name="ALL" />
          Select all
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
