import { Fragment, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  PreviewWorkspaceContext,
  usePreviewWorkspace,
  usePreviewWorkspaceState,
  type DropZone,
  type Pane,
} from "@/hooks/use-preview-workspace";
import { ThreadView } from "@/components/thread-view";
import { EmptyPreview } from "@/components/empty-preview";
import { cn } from "@/lib/utils";

// ─── Provider ────────────────────────────────────────────────────────────────

export function PreviewWorkspaceProvider({ children }: { children: ReactNode }) {
  const state = usePreviewWorkspaceState();
  return <PreviewWorkspaceContext value={state}>{children}</PreviewWorkspaceContext>;
}

// ─── Main Workspace Component ────────────────────────────────────────────────

export function PreviewWorkspace({ onClose, summary }: { onClose: () => void; summary?: string }) {
  const workspace = usePreviewWorkspace();
  const { rows } = workspace;

  // Single row, single pane — no split groups needed
  if (rows.length === 1 && rows[0].panes.length === 1) {
    return <WorkspacePane pane={rows[0].panes[0]} summary={summary} onCloseThread={onClose} />;
  }

  // Multi-split: outer vertical group for rows, inner horizontal group for columns per row
  return (
    <Group id="mailfast.workspace-rows" orientation="vertical" className="h-full w-full min-h-0">
      {rows.map((row, rowIndex) => (
        <Fragment key={`row-${rowIndex}-${row.panes.map((p) => p.id).join(",")}`}>
          {rowIndex > 0 && (
            <Separator
              data-slot="resizable-handle"
              aria-label="Resize workspace rows"
              className="relative z-10 h-px bg-border after:absolute after:inset-x-0 after:-top-1 after:h-2 hover:bg-primary focus-visible:bg-primary data-[separator=active]:bg-primary"
            />
          )}
          <Panel id={`mailfast.workspace-row-panel-${rowIndex}`} defaultSize={`${100 / rows.length}%`} minSize="10%">
            {row.panes.length === 1 ? (
              <WorkspacePane pane={row.panes[0]} onCloseThread={onClose} summary={summary} />
            ) : (
              <Group
                id={`mailfast.workspace-row-${rowIndex}`}
                orientation="horizontal"
                className="h-full w-full min-w-0"
              >
                {row.panes.map((pane, paneIndex) => (
                  <Fragment key={pane.id}>
                    {paneIndex > 0 && (
                      <Separator
                        data-slot="resizable-handle"
                        aria-label="Resize workspace columns"
                        className="relative z-10 w-px bg-border after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary focus-visible:bg-primary data-[separator=active]:bg-primary"
                      />
                    )}
                    <Panel
                      id={`mailfast.workspace-pane-${pane.id}`}
                      defaultSize={`${100 / row.panes.length}%`}
                      minSize="10%"
                    >
                      <WorkspacePane pane={pane} onCloseThread={onClose} summary={summary} />
                    </Panel>
                  </Fragment>
                ))}
              </Group>
            )}
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

// ─── Drop Zone Calculation ───────────────────────────────────────────────────

function getDropZone(e: React.DragEvent, element: HTMLElement, canSplitCols: boolean, canSplitRows: boolean): DropZone {
  const rect = element.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const ratioX = Math.max(0, Math.min(1, x / rect.width));
  const ratioY = Math.max(0, Math.min(1, y / rect.height));

  const distLeft = ratioX;
  const distRight = 1 - ratioX;
  const distTop = ratioY;
  const distBottom = 1 - ratioY;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist < 0.25) {
    if (minDist === distLeft && canSplitCols) return "left";
    if (minDist === distRight && canSplitCols) return "right";
    if (minDist === distTop && canSplitRows) return "top";
    if (minDist === distBottom && canSplitRows) return "bottom";
  }

  return "center";
}

// ─── Individual Pane ─────────────────────────────────────────────────────────

function WorkspacePane({ pane, onCloseThread, summary }: { pane: Pane; onCloseThread: () => void; summary?: string }) {
  const workspace = usePreviewWorkspace();
  const isFocused = workspace.focusedPaneId === pane.id;
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const dragCounter = useRef(0);
  const paneRef = useRef<HTMLDivElement>(null);

  const canSplitCols = workspace.canSplitRight(pane.id);
  const canSplitRows = workspace.canSplitDown();

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (paneRef.current) {
      const zone = getDropZone(e, paneRef.current, canSplitCols, canSplitRows);
      setDropZone(zone);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDropZone(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    const zone = dropZone || "center";
    setDropZone(null);

    const threadId = e.dataTransfer.getData("application/mailfast-thread") || e.dataTransfer.getData("text/plain");
    const sourcePaneId = e.dataTransfer.getData("application/mailfast-source-pane") || undefined;

    if (threadId) {
      workspace.dropThread(pane.id, threadId, zone, sourcePaneId);
    }
  };

  const handleClose = () => {
    if (workspace.canClose()) {
      workspace.closePane(pane.id);
    } else {
      workspace.setThreadId(pane.id, null);
      if (isFocused) onCloseThread();
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: focus on click is intentional, pane is not a button
    <div
      ref={paneRef}
      className={cn("preview-pane", isFocused && "focused", !pane.threadId && "is-empty")}
      onClick={() => workspace.focusPane(pane.id)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropZone && <div data-slot="drop-overlay" className={cn("drop-target-overlay", `drop-target-${dropZone}`)} />}
      {pane.threadId ? (
        <ThreadView threadId={pane.threadId} paneId={pane.id} onClose={handleClose} />
      ) : (
        <EmptyPreview summary={summary} />
      )}
    </div>
  );
}
