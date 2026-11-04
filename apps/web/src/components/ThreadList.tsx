import { memo, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ThreadAction, ThreadRow } from "@mailfast/shared";
import { prefetchThread, runThreadAction } from "../lib/data";
import { listDate, sendersLabel } from "../lib/format";

const ROW = 60;

interface Props {
  threads: ThreadRow[];
  selectedId: string | undefined;
  onOpen: (id: string) => void;
  onClose: () => void;
  onEndReached?: () => void;
  empty: string;
}

export function act(ids: string[], action: ThreadAction) {
  if (ids.length > 0) runThreadAction({ threadIds: ids, action });
}

/**
 * Virtualised mailbox list: only visible rows are in the DOM, so 10k threads
 * scroll as smoothly as 10. Keyboard: j/k move, Enter open, e archive,
 * # trash, s star, Shift+I read, Shift+U unread, Esc close.
 */
export function ThreadList({ threads, selectedId, onOpen, onClose, onEndReached, empty }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 15,
  });
  const items = virtualizer.getVirtualItems();

  // Infinite scroll: ask for more when within 30 rows of the end.
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (onEndReached && threads.length > 0 && lastIndex >= threads.length - 30) onEndReached();
  }, [lastIndex, threads.length, onEndReached]);

  // Warm the first visible threads once the list settles.
  const firstIds = threads
    .slice(0, 6)
    .map((t) => t.id)
    .join(",");
  useEffect(() => {
    if (!firstIds) return;
    const handle = requestIdleCallback(() => firstIds.split(",").forEach(prefetchThread));
    return () => cancelIdleCallback(handle);
  }, [firstIds]);

  // Keep a ref so the key handler always sees current data without re-binding.
  const state = useRef({ threads, selectedId, onOpen, onClose });
  state.current = { threads, selectedId, onOpen, onClose };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const { threads, selectedId, onOpen, onClose } = state.current;
      const index = threads.findIndex((t) => t.id === selectedId);
      const sel = index >= 0 ? threads[index] : undefined;
      const move = (to: number) => {
        const t = threads[Math.max(0, Math.min(threads.length - 1, to))];
        if (!t) return;
        onOpen(t.id);
        virtualizer.scrollToIndex(threads.indexOf(t), { align: "auto" });
        // Prefetch neighbours so the next j/k is instant too.
        for (const n of [threads.indexOf(t) + 1, threads.indexOf(t) + 2, threads.indexOf(t) - 1]) {
          const id = threads[n]?.id;
          if (id) prefetchThread(id);
        }
      };
      // After removing the selected thread from this view, select its neighbour.
      const removeAndAdvance = (action: ThreadAction) => {
        if (!sel) return;
        const next = threads[index + 1] ?? threads[index - 1];
        act([sel.id], action);
        if (next) onOpen(next.id);
        else onClose();
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
          if (!sel && threads[0]) onOpen(threads[0].id);
          break;
        case "Escape":
          onClose();
          break;
        case "e":
          removeAndAdvance({ kind: "archive" });
          break;
        case "#":
        case "Delete":
          removeAndAdvance({ kind: "trash" });
          break;
        case "s":
          if (sel) act([sel.id], { kind: sel.starred ? "unstar" : "star" });
          break;
        case "I":
          if (sel) act([sel.id], { kind: "read" });
          break;
        case "U":
          if (sel) act([sel.id], { kind: "unread" });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [virtualizer]);

  if (threads.length === 0) return <div className="empty">{empty}</div>;

  return (
    <div ref={scrollRef} className="list">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((v) => {
          const t = threads[v.index]!;
          return <Row key={t.id} thread={t} top={v.start} selected={t.id === selectedId} onOpen={onOpen} />;
        })}
      </div>
    </div>
  );
}

const Row = memo(function Row({
  thread: t,
  top,
  selected,
  onOpen,
}: {
  thread: ThreadRow;
  top: number;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div
      className={`row${t.unread ? " unread" : ""}${selected ? " selected" : ""}`}
      style={{ transform: `translateY(${top}px)`, height: ROW }}
      onMouseEnter={() => prefetchThread(t.id)}
      onMouseDown={() => onOpen(t.id)}
    >
      <button
        className={`star${t.starred ? " on" : ""}`}
        title={t.starred ? "Unstar (s)" : "Star (s)"}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => act([t.id], { kind: t.starred ? "unstar" : "star" })}
      >
        {t.starred ? "★" : "☆"}
      </button>
      <div className="row-main">
        <div className="row-top">
          <span className="from">{sendersLabel(t.senders, t.messageCount)}</span>
          <span className="date">{listDate(t.lastDate)}</span>
        </div>
        <div className="row-bottom">
          <span className="subject">{t.subject || "(no subject)"}</span>
          <span className="snippet"> — {t.snippet}</span>
        </div>
      </div>
      <div className="row-actions" onMouseDown={(e) => e.stopPropagation()}>
        <button title="Archive (e)" onClick={() => act([t.id], { kind: "archive" })}>
          ⤓
        </button>
        <button
          title={t.unread ? "Mark read" : "Mark unread"}
          onClick={() => act([t.id], { kind: t.unread ? "read" : "unread" })}
        >
          {t.unread ? "◉" : "○"}
        </button>
        <button title="Delete (#)" onClick={() => act([t.id], { kind: "trash" })}>
          🗑
        </button>
      </div>
    </div>
  );
});
