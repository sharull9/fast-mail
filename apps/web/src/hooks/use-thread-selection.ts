import { useCallback, useMemo, useRef, useState } from "react";

export function useThreadSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const currentIds = useRef(ids);
  currentIds.current = ids;
  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);
  const toggle = useCallback((id: string, range = false) => {
    setSelected((previous) => {
      const next = new Set(previous);
      const list = currentIds.current;
      const start = anchor.current ? list.indexOf(anchor.current) : -1;
      const end = list.indexOf(id);
      if (range && start >= 0 && end >= 0) {
        for (const item of list.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(item);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!range) anchor.current = id;
  }, []);
  const anchorAt = useCallback((id: string) => {
    anchor.current = id;
  }, []);
  const selectAll = useCallback(() => setSelected(new Set(currentIds.current)), []);
  const selectedIds = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);
  return { selected, selectedIds, toggle, clear, selectAll, anchorAt };
}
