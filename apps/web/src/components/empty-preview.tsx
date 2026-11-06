import { Mail } from "lucide-react";

export function EmptyPreview() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Mail className="size-5" />
      </div>
      <p className="text-sm font-medium">No conversation selected</p>
      <p className="text-xs text-muted-foreground">Pick one from the list, or press j / k</p>
    </div>
  );
}
