import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import type { ThreadAction, ThreadRow } from "@mailfast/shared";
import { authQuery, prefetchThread, runThreadAction } from "@/lib/data";
import { cleanSnippet, dateGroup, listDate, sendersLabel } from "@/lib/format";
import { openExternal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useThreadSelection } from "@/hooks/use-thread-selection";
import { Checkbox } from "@/components/ui/checkbox";
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

export function ThreadList({ threads, selectedId, onOpen, onClose, onEndReached, empty, labelId, total }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const toggleGroup = (key: string, collapsed: boolean) => {
    setGroupOverrides((previous) => {
      const next = { ...previous, [key]: !collapsed };
      try {
        localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Keep groups usable when browser storage is unavailable.
      }
      return next;
    });
  };
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < 560);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [threads.length === 0]);
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (flat[index]?.kind === "header" ? 32 : narrow ? 56 : 44),
    overscan: 15,
  });
  useEffect(() => {
    virtualizer.measure();
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
  const state = useRef({ threads: visibleThreads, selectedId, onOpen, onClose, selection, account });
  state.current = { threads: visibleThreads, selectedId, onOpen, onClose, selection, account };
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (
        !(el instanceof HTMLElement) ||
        el.closest('[role="dialog"], [role="menu"]') ||
        el.isContentEditable ||
        /INPUT|TEXTAREA|SELECT/.test(el.tagName) ||
        e.altKey
      )
        return;
      if (el.closest(".group-header") && (e.key === "Enter" || e.key === " ")) return;
      const { threads, selectedId, onOpen, onClose, selection } = state.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selection.selectAll();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      const focused = el.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId;
      const index = threads.findIndex((t) => t.id === (focused ?? selectedId));
      const sel = threads[index];
      const selected = selection.selectedIds.length ? selection.selectedIds : sel ? [sel.id] : [];
      const move = (to: number) => {
        const t = threads[Math.max(0, Math.min(threads.length - 1, to))];
        if (!t) return;
        onOpen(t.id);
        const flatIndex = flat.findIndex((item) => item.kind === "thread" && item.thread.id === t.id);
        virtualizer.scrollToIndex(flatIndex, { align: "auto" });
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
      switch (e.key) {
        case "j":
        case "ArrowDown":
          move(index + 1);
          break;
        case "k":
        case "ArrowUp":
          move(index < 0 ? 0 : index - 1);
          break;
        case "Enter":
          if (sel) onOpen(sel.id);
          else if (threads[0]) onOpen(threads[0].id);
          break;
        case "Escape":
          if (selection.selectedIds.length) selection.clear();
          else onClose();
          break;
        case "x":
          if (sel) selection.toggle(sel.id);
          break;
        case "e":
          run({ kind: labelId === "ALL" || labelId === "ARCHIVE" ? "inbox" : "archive" }, true);
          break;
        case "#":
        case "Delete":
          run({ kind: labelId === "TRASH" ? "untrash" : "trash" }, true);
          break;
        case "s":
          run({ kind: (sel ?? threads.find((t) => t.id === selected[0]))?.starred ? "unstar" : "star" });
          break;
        case "I":
          run({ kind: "read" });
          break;
        case "U":
          run({ kind: "unread" });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [virtualizer, flat, labelId]);
  const count = selection.selectedIds.length;
  const bulk = (action: ThreadAction) => {
    act(selection.selectedIds, action);
    selection.clear();
  };
  const archive = labelId === "ALL" || labelId === "ARCHIVE" ? "inbox" : "archive";
  const trash = labelId === "TRASH" ? "untrash" : "trash";
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <Checkbox
          aria-label="Select all"
          checked={count > 0 && count === ids.length ? true : count > 0 ? "indeterminate" : false}
          onCheckedChange={() => (count === ids.length ? selection.clear() : selection.selectAll())}
        />
        <span className="shrink-0 text-muted-foreground">{count ? `${count} selected` : "Select all"}</span>
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
              <IconButton key={a.kind} label={a.name} onClick={() => bulk({ kind: a.kind })}>
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
          <span className="ml-auto text-muted-foreground tabular-nums">
            {threads.length ? `1–${threads.length} of ${Math.max(threads.length, total ?? 0)}` : "0 of 0"}
          </span>
        )}
      </div>
      {threads.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>{empty}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div ref={scrollRef} className="list">
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
                    onClick={() => toggleGroup(item.key, item.collapsed)}
                    className="group-header absolute inset-x-0 flex h-8 w-full items-center gap-2 bg-background/95 px-3 text-left text-[11px] font-medium hover:bg-accent"
                    style={{ transform: `translateY(${v.start}px)` }}
                  >
                    {item.collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    {item.label}
                    <span className="text-muted-foreground">{item.count}</span>
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
                  selecting={count > 0}
                  narrow={narrow}
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

const Row = memo(function Row({
  thread: t,
  top,
  opened,
  checked,
  selecting,
  narrow,
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
  selecting: boolean;
  narrow: boolean;
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
  const actions: { name: string; icon: string; kind: ThreadAction["kind"]; shortcut?: string }[] = [
    {
      name: inInbox ? "Archive" : "Move to Inbox",
      icon: "archive",
      kind: inInbox ? "archive" : "inbox",
      shortcut: "e",
    },
    { name: inTrash ? "Restore" : "Delete", icon: "TRASH", kind: inTrash ? "untrash" : "trash", shortcut: "#" },
    {
      name: t.unread ? "Mark read" : "Mark unread",
      icon: t.unread ? "read" : "unread",
      kind: t.unread ? "read" : "unread",
      shortcut: t.unread ? "Shift+I" : "Shift+U",
    },
    { name: t.starred ? "Unstar" : "Star", icon: "STARRED", kind: t.starred ? "unstar" : "star", shortcut: "s" },
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
          aria-selected={checked}
          tabIndex={0}
          className={cn("row group", (opened || checked) && "selected", t.unread && "unread", narrow && "narrow")}
          style={{ transform: `translateY(${top}px)`, height: narrow ? 56 : 44 }}
          onMouseEnter={() => prefetchThread(t.id)}
          onClick={(e) => onClick(t.id, e)}
        >
          <div
            className="relative flex size-7 shrink-0 items-center justify-center"
            data-avatar-slot
            onClick={(e) => {
              e.stopPropagation();
              onToggle(t.id, e.shiftKey);
            }}
          >
            <MailAvatar
              name={t.senders[0]?.name ?? ""}
              email={t.senders[0]?.email ?? ""}
              className={cn(
                "pointer-events-none group-hover:invisible group-focus-within:invisible",
                (checked || selecting) && "invisible",
              )}
            />
            <Checkbox
              className={cn(
                "absolute size-[18px] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                (checked || selecting) && "opacity-100",
              )}
              aria-label={`Select ${t.subject || "conversation"}`}
              checked={checked}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(t.id, e.shiftKey);
              }}
            />
          </div>
          <div className="row-main">
            <span className="from">{sendersLabel(t.senders, t.messageCount)}</span>
            <div className="row-preview">
              {t.unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
              <span className="subject">
                {t.subject || "(no subject)"}
                <span className="snippet"> · {cleanSnippet(t.snippet)}</span>
              </span>
            </div>
          </div>
          {t.starred && (
            <IconButton
              label="Unstar"
              className="star on"
              onClick={(e) => {
                e.stopPropagation();
                act([t.id], { kind: "unstar" });
              }}
            >
              <Icon name="STARRED" />
            </IconButton>
          )}
          <span className="date">{listDate(t.lastDate)}</span>
          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            {actions
              .slice(0, 3)
              .filter((_, i) => i !== 1)
              .concat(actions.slice(1, 2))
              .map((a) => (
                <IconButton key={a.kind} label={a.name} onClick={() => act([t.id], { kind: a.kind })}>
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
          <ContextMenuItem key={a.kind} onSelect={() => onAction(t.id, { kind: a.kind })}>
            <Icon name={a.icon} />
            {a.name}
            {a.shortcut && <ContextMenuShortcut>{a.shortcut}</ContextMenuShortcut>}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onToggle(t.id)}>
          <Icon name="command" />
          {checked ? "Deselect" : "Select"}
          <ContextMenuShortcut>x</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onSelectAll}>
          <Icon name="ALL" />
          Select all
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
