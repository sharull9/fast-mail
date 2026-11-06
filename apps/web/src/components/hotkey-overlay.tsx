import { useId, type ReactNode } from "react";
import { HotkeysProvider } from "@tanstack/react-hotkeys";

// Mounted inside Radix Content, so the exclusive scope follows the overlay's lifetime.
export function HotkeyOverlay({ children }: { children: ReactNode }) {
  const id = useId();
  return (
    <HotkeysProvider scope={`overlay-${id}`} exclusive={{ allow: ["global"] }}>
      {children}
    </HotkeysProvider>
  );
}
