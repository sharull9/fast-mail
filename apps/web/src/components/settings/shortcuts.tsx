import { useState } from "react";
import { useAppHotkeyList, useCustomHotkeys, useHotkeyRecorder, formatForDisplay } from "@tanstack/react-hotkeys";
import { Button } from "@/components/ui/button";
import type { ShortcutId } from "@/lib/hotkeys";

function ShortcutRow({
  id,
  name,
  description,
  binding,
}: {
  id: ShortcutId;
  name: string;
  description: string;
  binding: string;
}) {
  const { findConflicts, setCustomHotkey, resetCustomHotkey } = useCustomHotkeys();
  const [error, setError] = useState("");
  const recorder = useHotkeyRecorder({
    maxSteps: 1,
    recordBy: "key",
    validate: (value) => {
      const [conflict] = findConflicts(id, value);
      return conflict ? `Already used by ${conflict.meta?.name ?? conflict.id}.` : true;
    },
    onReject: (rejection) => setError(rejection.message),
    onRecord: (value) => {
      setCustomHotkey(id, value);
      setError("");
    },
    onCancel: () => setError(""),
  });
  return (
    <div className="settings-shortcut-row">
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Change ${name} shortcut`}
          onClick={() => {
            setError("");
            recorder.startRecording();
          }}
        >
          <kbd>{recorder.isRecording ? "Press keys… (Esc cancels)" : binding || "Unassigned"}</kbd>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Disable ${name} shortcut`}
          disabled={recorder.isRecording || !binding}
          onClick={() => setCustomHotkey(id, null)}
        >
          Disable
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Reset ${name} shortcut`}
          disabled={recorder.isRecording}
          onClick={() => {
            resetCustomHotkey(id);
            setError("");
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
export function ShortcutSettings() {
  const items = useAppHotkeyList();
  const { resetCustomHotkeys } = useCustomHotkeys();
  const groups = [...new Set(items.map(({ appHotkey }) => appHotkey.meta?.group))];
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-lg text-sm text-muted-foreground">
          Select a binding and press a new key combination. Changes save on this device.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (window.confirm("Restore all default keyboard shortcuts?")) resetCustomHotkeys();
          }}
        >
          Restore all defaults
        </Button>
      </div>
      {groups.map((group) => (
        <section key={group} aria-label={`${group} shortcuts`}>
          <h3 className="mb-3 text-sm font-semibold">{group}</h3>
          <div className="divide-y border-t">
            {items
              .filter(({ appHotkey }) => appHotkey.meta?.group === group)
              .map(({ appHotkey }) => (
                <ShortcutRow
                  key={appHotkey.id}
                  id={appHotkey.id}
                  name={appHotkey.meta?.name ?? appHotkey.id}
                  description={appHotkey.meta?.description ?? ""}
                  binding={appHotkey.hotkey ? formatForDisplay(appHotkey.hotkey) : ""}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
