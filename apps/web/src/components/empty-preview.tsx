import { Mail } from "lucide-react";
import { useShortcutLabel, type ShortcutId } from "@/lib/hotkeys";

const shortcuts: { label: string; keys: ShortcutId[] }[] = [
  { label: "Next / previous conversation", keys: ["next", "previous"] },
  { label: "Search mail", keys: ["search"] },
  { label: "Select a conversation", keys: ["select"] },
  { label: "Star / unstar", keys: ["star"] },
  { label: "Close conversation or clear selection", keys: ["close"] },
  { label: "All keyboard shortcuts", keys: ["shortcuts"] },
];

export function EmptyPreview({ summary }: { summary?: string }) {
  const shortcutLabel = useShortcutLabel();
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center py-6">
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Mail aria-hidden="true" className="size-5" />
        </div>
        <h2 className="text-sm font-medium">No conversation selected</h2>
        <p className="mt-1 text-xs text-muted-foreground">Pick a conversation from the list to read it.</p>
        {summary && <p className="mt-3 text-xs text-muted-foreground tabular-nums">{summary}</p>}

        <section aria-label="Quick shortcuts" className="mt-6 border-t pt-5">
          <h3 className="text-xs font-medium">Quick shortcuts</h3>
          <dl className="mt-3 flex flex-col gap-3">
            {shortcuts.map(({ label, keys }) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="flex shrink-0 items-center gap-1">
                  {keys.map((key) => (
                    <kbd key={key} className="rounded border px-1.5 py-0.5 text-[11px] font-mono">
                      {shortcutLabel(key)}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Single-key shortcuts pause while typing. Actions apply to selected or focused conversations.
          </p>
        </section>

        <section aria-label="Mail tips" className="mt-5 border-t pt-5">
          <h3 className="text-xs font-medium">Make the most of your mail</h3>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Select multiple conversations to archive, move, or mark them read together.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Search your cached mail even while sync is running. Use the date filter to narrow a folder to a specific
            period.
          </p>
        </section>
      </div>
    </div>
  );
}
