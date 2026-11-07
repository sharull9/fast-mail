import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ThreadAttachment } from "@mailfast/shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PaneId = string;

export interface Pane {
  id: PaneId;
  threadId: string | null;
  attachment?: ThreadAttachment | null;
}

export interface WorkspaceLayout {
  /** Rows of panes. Each row is an array of panes arranged horizontally. Max 4 rows, max 4 panes per row. */
  rows: Array<{ panes: Pane[] }>;
  focusedPaneId: PaneId;
}

export interface WorkspaceActions {
  /** Add a pane to the right of the given pane's row (max 4 per row). */
  splitRight: (paneId: PaneId) => void;
  /** Add a new row below the row containing the given pane (max 4 rows). */
  splitDown: (paneId: PaneId) => void;
  /** Remove a pane. Removes the row if it becomes empty. */
  closePane: (paneId: PaneId) => void;
  /** Mark a pane as the active target for thread-list clicks. */
  focusPane: (paneId: PaneId) => void;
  /** Assign a thread to a pane. */
  setThreadId: (paneId: PaneId, threadId: string | null) => void;
  /** Assign an attachment to a pane. */
  setAttachment: (paneId: PaneId, attachment: ThreadAttachment | null) => void;
  /** Reset to a single empty pane. */
  resetWorkspace: () => void;
  /** Whether a split-right is possible for the given pane. */
  canSplitRight: (paneId: PaneId) => boolean;
  /** Whether a split-down is possible. */
  canSplitDown: () => boolean;
  /** Whether this pane can be closed (more than 1 pane total). */
  canClose: () => boolean;
  /** Drop a thread into a pane or split space (VS Code style). */
  dropThread: (targetPaneId: PaneId, threadId: string, zone: DropZone, sourcePaneId?: PaneId) => void;
  /** Drop an attachment into a pane or split space. */
  dropAttachment: (targetPaneId: PaneId, attachment: ThreadAttachment, zone: DropZone, sourcePaneId?: PaneId) => void;
}

export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export type WorkspaceState = WorkspaceLayout & WorkspaceActions;

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_COLUMNS = 4;
const MAX_ROWS = 4;
const STORAGE_KEY = "mailfast.preview-workspace";

// ─── Context ─────────────────────────────────────────────────────────────────

export const PreviewWorkspaceContext = createContext<WorkspaceState | null>(null);

export function usePreviewWorkspace(): WorkspaceState {
  const ctx = useContext(PreviewWorkspaceContext);
  if (!ctx) throw new Error("usePreviewWorkspace must be used within a PreviewWorkspaceProvider");
  return ctx;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let counter = 0;
function paneId(): PaneId {
  return `pane-${Date.now()}-${++counter}`;
}

function createPane(threadId: string | null = null, attachment: ThreadAttachment | null = null): Pane {
  return { id: paneId(), threadId, attachment };
}

function defaultLayout(): WorkspaceLayout {
  const pane = createPane();
  return { rows: [{ panes: [pane] }], focusedPaneId: pane.id };
}

function totalPanes(layout: WorkspaceLayout): number {
  return layout.rows.reduce((sum, row) => sum + row.panes.length, 0);
}

function findPane(layout: WorkspaceLayout, id: PaneId): { rowIndex: number; paneIndex: number } | null {
  for (let r = 0; r < layout.rows.length; r++) {
    const p = layout.rows[r].panes.findIndex((pane) => pane.id === id);
    if (p >= 0) return { rowIndex: r, paneIndex: p };
  }
  return null;
}

/** Pick the nearest remaining pane when one is removed. */
function nearestPaneId(layout: WorkspaceLayout, _removedRowIndex: number, removedPaneIndex: number): PaneId {
  // Try same row first, then adjacent rows
  for (const row of layout.rows) {
    if (row.panes.length > 0) {
      const idx = Math.min(removedPaneIndex, row.panes.length - 1);
      return row.panes[idx].id;
    }
  }
  return layout.rows[0].panes[0].id;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function saveLayout(layout: WorkspaceLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage full or unavailable — silently ignore.
  }
}

function loadLayout(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as WorkspaceLayout;
    // Validate shape
    if (!parsed.rows || !Array.isArray(parsed.rows) || parsed.rows.length === 0 || !parsed.focusedPaneId) {
      return defaultLayout();
    }
    // Ensure focused pane still exists
    if (!findPane(parsed, parsed.focusedPaneId)) {
      parsed.focusedPaneId = parsed.rows[0].panes[0].id;
    }
    return parsed;
  } catch {
    return defaultLayout();
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePreviewWorkspaceState(): WorkspaceState {
  const [layout, setLayout] = useState<WorkspaceLayout>(loadLayout);

  const update = useCallback((fn: (prev: WorkspaceLayout) => WorkspaceLayout) => {
    setLayout((prev) => {
      const next = fn(prev);
      saveLayout(next);
      return next;
    });
  }, []);

  const splitRight = useCallback(
    (id: PaneId) => {
      update((prev) => {
        const loc = findPane(prev, id);
        if (!loc) return prev;
        const row = prev.rows[loc.rowIndex];
        if (row.panes.length >= MAX_COLUMNS) return prev;
        const newPane = createPane();
        const newPanes = [...row.panes];
        newPanes.splice(loc.paneIndex + 1, 0, newPane);
        const newRows = prev.rows.map((r, i) => (i === loc.rowIndex ? { panes: newPanes } : r));
        return { rows: newRows, focusedPaneId: newPane.id };
      });
    },
    [update],
  );

  const splitDown = useCallback(
    (id: PaneId) => {
      update((prev) => {
        if (prev.rows.length >= MAX_ROWS) return prev;
        const loc = findPane(prev, id);
        if (!loc) return prev;
        const newPane = createPane();
        const newRows = [...prev.rows];
        newRows.splice(loc.rowIndex + 1, 0, { panes: [newPane] });
        return { rows: newRows, focusedPaneId: newPane.id };
      });
    },
    [update],
  );

  const closePane = useCallback(
    (id: PaneId) => {
      update((prev) => {
        if (totalPanes(prev) <= 1) return prev;
        const loc = findPane(prev, id);
        if (!loc) return prev;
        const row = prev.rows[loc.rowIndex];
        const newPanes = row.panes.filter((p) => p.id !== id);
        let newRows: WorkspaceLayout["rows"];
        if (newPanes.length === 0) {
          // Remove entire row
          newRows = prev.rows.filter((_, i) => i !== loc.rowIndex);
        } else {
          newRows = prev.rows.map((r, i) => (i === loc.rowIndex ? { panes: newPanes } : r));
        }
        const focused =
          prev.focusedPaneId === id
            ? nearestPaneId({ rows: newRows, focusedPaneId: "" }, loc.rowIndex, loc.paneIndex)
            : prev.focusedPaneId;
        return { rows: newRows, focusedPaneId: focused };
      });
    },
    [update],
  );

  const focusPane = useCallback(
    (id: PaneId) => {
      update((prev) => {
        if (prev.focusedPaneId === id) return prev;
        return { ...prev, focusedPaneId: id };
      });
    },
    [update],
  );

  const setThreadId = useCallback(
    (id: PaneId, threadId: string | null) => {
      update((prev) => {
        const loc = findPane(prev, id);
        if (!loc) return prev;
        const row = prev.rows[loc.rowIndex];
        const pane = row.panes[loc.paneIndex];
        if (pane.threadId === threadId && !pane.attachment) return prev;
        const newPanes = row.panes.map((p, i) => (i === loc.paneIndex ? { ...p, threadId, attachment: null } : p));
        const newRows = prev.rows.map((r, i) => (i === loc.rowIndex ? { panes: newPanes } : r));
        return { ...prev, rows: newRows };
      });
    },
    [update],
  );

  const setAttachment = useCallback(
    (id: PaneId, attachment: ThreadAttachment | null) => {
      update((prev) => {
        const loc = findPane(prev, id);
        if (!loc) return prev;
        const row = prev.rows[loc.rowIndex];
        const pane = row.panes[loc.paneIndex];
        if (pane.attachment === attachment && !pane.threadId) return prev;
        const newPanes = row.panes.map((p, i) => (i === loc.paneIndex ? { ...p, attachment, threadId: null } : p));
        const newRows = prev.rows.map((r, i) => (i === loc.rowIndex ? { panes: newPanes } : r));
        return { ...prev, rows: newRows };
      });
    },
    [update],
  );

  const resetWorkspace = useCallback(() => {
    const fresh = defaultLayout();
    saveLayout(fresh);
    setLayout(fresh);
  }, []);

  const canSplitRight = useCallback(
    (id: PaneId) => {
      const loc = findPane(layout, id);
      if (!loc) return false;
      return layout.rows[loc.rowIndex].panes.length < MAX_COLUMNS;
    },
    [layout],
  );

  const canSplitDown = useCallback(() => layout.rows.length < MAX_ROWS, [layout]);

  const canClose = useCallback(() => totalPanes(layout) > 1, [layout]);

  const dropThread = useCallback(
    (targetPaneId: PaneId, threadId: string, zone: DropZone, sourcePaneId?: PaneId) => {
      update((prev) => {
        const loc = findPane(prev, targetPaneId);
        if (!loc) return prev;

        // Center drop: replaces thread in this pane
        if (zone === "center") {
          let newRows = prev.rows.map((r, ri) =>
            ri === loc.rowIndex
              ? {
                  panes: r.panes.map((p) => (p.id === targetPaneId ? { ...p, threadId, attachment: null } : p)),
                }
              : r,
          );

          if (sourcePaneId && sourcePaneId !== targetPaneId && totalPanes(prev) > 1) {
            const srcLoc = findPane({ rows: newRows, focusedPaneId: "" }, sourcePaneId);
            if (srcLoc) {
              const srcRow = newRows[srcLoc.rowIndex];
              const filtered = srcRow.panes.filter((p) => p.id !== sourcePaneId);
              if (filtered.length === 0) {
                newRows = newRows.filter((_, i) => i !== srcLoc.rowIndex);
              } else {
                newRows = newRows.map((r, i) => (i === srcLoc.rowIndex ? { panes: filtered } : r));
              }
            }
          }

          return { rows: newRows, focusedPaneId: targetPaneId };
        }

        // Left / Right split
        if (zone === "left" || zone === "right") {
          const row = prev.rows[loc.rowIndex];
          if (row.panes.length >= MAX_COLUMNS) {
            // Cannot split more columns, fallback to replacing target
            return {
              rows: prev.rows.map((r, ri) =>
                ri === loc.rowIndex
                  ? {
                      panes: r.panes.map((p) => (p.id === targetPaneId ? { ...p, threadId, attachment: null } : p)),
                    }
                  : r,
              ),
              focusedPaneId: targetPaneId,
            };
          }

          const newPane = createPane(threadId, null);
          const insertIndex = zone === "left" ? loc.paneIndex : loc.paneIndex + 1;
          const newPanes = [...row.panes];
          newPanes.splice(insertIndex, 0, newPane);

          let newRows = prev.rows.map((r, i) => (i === loc.rowIndex ? { panes: newPanes } : r));

          if (sourcePaneId && sourcePaneId !== newPane.id && totalPanes(prev) > 1) {
            const srcLoc = findPane({ rows: newRows, focusedPaneId: "" }, sourcePaneId);
            if (srcLoc) {
              const srcRow = newRows[srcLoc.rowIndex];
              const filtered = srcRow.panes.filter((p) => p.id !== sourcePaneId);
              if (filtered.length === 0) {
                newRows = newRows.filter((_, i) => i !== srcLoc.rowIndex);
              } else {
                newRows = newRows.map((r, i) => (i === srcLoc.rowIndex ? { panes: filtered } : r));
              }
            }
          }

          return { rows: newRows, focusedPaneId: newPane.id };
        }

        // Top / Bottom split
        if (zone === "top" || zone === "bottom") {
          if (prev.rows.length >= MAX_ROWS) {
            // Cannot split more rows, fallback to replacing target
            return {
              rows: prev.rows.map((r, ri) =>
                ri === loc.rowIndex
                  ? {
                      panes: r.panes.map((p) => (p.id === targetPaneId ? { ...p, threadId, attachment: null } : p)),
                    }
                  : r,
              ),
              focusedPaneId: targetPaneId,
            };
          }

          const newPane = createPane(threadId, null);
          const insertRowIndex = zone === "top" ? loc.rowIndex : loc.rowIndex + 1;
          const newRows = [...prev.rows];
          newRows.splice(insertRowIndex, 0, { panes: [newPane] });

          let finalRows = newRows;
          if (sourcePaneId && sourcePaneId !== newPane.id && totalPanes(prev) > 1) {
            const srcLoc = findPane({ rows: finalRows, focusedPaneId: "" }, sourcePaneId);
            if (srcLoc) {
              const srcRow = finalRows[srcLoc.rowIndex];
              const filtered = srcRow.panes.filter((p) => p.id !== sourcePaneId);
              if (filtered.length === 0) {
                finalRows = finalRows.filter((_, i) => i !== srcLoc.rowIndex);
              } else {
                finalRows = finalRows.map((r, i) => (i === srcLoc.rowIndex ? { panes: filtered } : r));
              }
            }
          }

          return { rows: finalRows, focusedPaneId: newPane.id };
        }

        return prev;
      });
    },
    [update],
  );

  const dropAttachment = useCallback(
    (targetPaneId: PaneId, attachment: ThreadAttachment, zone: DropZone, sourcePaneId?: PaneId) => {
      update((prev) => {
        const loc = findPane(prev, targetPaneId);
        if (!loc) return prev;

        // Center drop: replaces content in this pane
        if (zone === "center") {
          let newRows = prev.rows.map((r, ri) =>
            ri === loc.rowIndex
              ? {
                  panes: r.panes.map((p) => (p.id === targetPaneId ? { ...p, threadId: null, attachment } : p)),
                }
              : r,
          );

          if (sourcePaneId && sourcePaneId !== targetPaneId && totalPanes(prev) > 1) {
            const srcLoc = findPane({ rows: newRows, focusedPaneId: "" }, sourcePaneId);
            if (srcLoc) {
              const srcRow = newRows[srcLoc.rowIndex];
              const filtered = srcRow.panes.filter((p) => p.id !== sourcePaneId);
              if (filtered.length === 0) {
                newRows = newRows.filter((_, i) => i !== srcLoc.rowIndex);
              } else {
                newRows = newRows.map((r, i) => (i === srcLoc.rowIndex ? { panes: filtered } : r));
              }
            }
          }

          return { rows: newRows, focusedPaneId: targetPaneId };
        }

        // Left / Right split
        if (zone === "left" || zone === "right") {
          const row = prev.rows[loc.rowIndex];
          if (row.panes.length >= MAX_COLUMNS) {
            return {
              rows: prev.rows.map((r, ri) =>
                ri === loc.rowIndex
                  ? {
                      panes: r.panes.map((p) => (p.id === targetPaneId ? { ...p, threadId: null, attachment } : p)),
                    }
                  : r,
              ),
              focusedPaneId: targetPaneId,
            };
          }

          const newPane = createPane(null, attachment);
          const insertIndex = zone === "left" ? loc.paneIndex : loc.paneIndex + 1;
          const newPanes = [...row.panes];
          newPanes.splice(insertIndex, 0, newPane);

          let newRows = prev.rows.map((r, i) => (i === loc.rowIndex ? { panes: newPanes } : r));

          if (sourcePaneId && sourcePaneId !== newPane.id && totalPanes(prev) > 1) {
            const srcLoc = findPane({ rows: newRows, focusedPaneId: "" }, sourcePaneId);
            if (srcLoc) {
              const srcRow = newRows[srcLoc.rowIndex];
              const filtered = srcRow.panes.filter((p) => p.id !== sourcePaneId);
              if (filtered.length === 0) {
                newRows = newRows.filter((_, i) => i !== srcLoc.rowIndex);
              } else {
                newRows = newRows.map((r, i) => (i === srcLoc.rowIndex ? { panes: filtered } : r));
              }
            }
          }

          return { rows: newRows, focusedPaneId: newPane.id };
        }

        // Top / Bottom split
        if (zone === "top" || zone === "bottom") {
          if (prev.rows.length >= MAX_ROWS) {
            return {
              rows: prev.rows.map((r, ri) =>
                ri === loc.rowIndex
                  ? {
                      panes: r.panes.map((p) => (p.id === targetPaneId ? { ...p, threadId: null, attachment } : p)),
                    }
                  : r,
              ),
              focusedPaneId: targetPaneId,
            };
          }

          const newPane = createPane(null, attachment);
          const insertRowIndex = zone === "top" ? loc.rowIndex : loc.rowIndex + 1;
          const newRows = [...prev.rows];
          newRows.splice(insertRowIndex, 0, { panes: [newPane] });

          let finalRows = newRows;
          if (sourcePaneId && sourcePaneId !== newPane.id && totalPanes(prev) > 1) {
            const srcLoc = findPane({ rows: finalRows, focusedPaneId: "" }, sourcePaneId);
            if (srcLoc) {
              const srcRow = finalRows[srcLoc.rowIndex];
              const filtered = srcRow.panes.filter((p) => p.id !== sourcePaneId);
              if (filtered.length === 0) {
                finalRows = finalRows.filter((_, i) => i !== srcLoc.rowIndex);
              } else {
                finalRows = finalRows.map((r, i) => (i === srcLoc.rowIndex ? { panes: filtered } : r));
              }
            }
          }

          return { rows: finalRows, focusedPaneId: newPane.id };
        }

        return prev;
      });
    },
    [update],
  );

  return useMemo(
    () => ({
      ...layout,
      splitRight,
      splitDown,
      closePane,
      focusPane,
      setThreadId,
      setAttachment,
      resetWorkspace,
      canSplitRight,
      canSplitDown,
      canClose,
      dropThread,
      dropAttachment,
    }),
    [
      layout,
      splitRight,
      splitDown,
      closePane,
      focusPane,
      setThreadId,
      setAttachment,
      resetWorkspace,
      canSplitRight,
      canSplitDown,
      canClose,
      dropThread,
      dropAttachment,
    ],
  );
}
