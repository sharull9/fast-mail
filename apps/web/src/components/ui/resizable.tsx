import type { ComponentProps } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { cn } from "@/lib/utils";

function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "mailfast.mail-split",
    panelIds: ["list", "preview"],
  });
  return (
    <Group
      id="mailfast.mail-split"
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      data-slot="resizable-panel-group"
      className={cn("h-full w-full min-w-0", className)}
      {...props}
    />
  );
}

function ResizableHandle({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="resizable-handle"
      aria-label="Resize conversation panels"
      className={cn(
        "relative z-10 w-px bg-border after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary focus-visible:bg-primary data-[separator=active]:bg-primary",
        className,
      )}
      {...props}
    />
  );
}

export { ResizablePanelGroup, Panel as ResizablePanel, ResizableHandle };
