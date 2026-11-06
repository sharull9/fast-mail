import { useAppHotkeyList } from "@tanstack/react-hotkeys";
import { shortcutLabel } from "@/lib/hotkeys";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function KeyboardShortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const items = useAppHotkeyList();
  const groups = [...new Set(items.map(({ appHotkey }) => appHotkey.meta?.group))];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single-key shortcuts pause while typing. Actions use your selection or the focused conversation.
          </DialogDescription>
        </DialogHeader>
        {groups.map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{group}</h3>
            <dl className="flex flex-col gap-2">
              {items
                .filter(({ appHotkey }) => appHotkey.meta?.group === group)
                .map(({ appHotkey }) => (
                  <div
                    key={appHotkey.id}
                    className="flex items-center justify-between gap-4"
                    title={appHotkey.meta?.description}
                  >
                    <dt className="text-sm">{appHotkey.meta?.name}</dt>
                    <dd>
                      <kbd className="rounded border px-1.5 text-[11px] font-mono">{shortcutLabel(appHotkey.id)}</kbd>
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
