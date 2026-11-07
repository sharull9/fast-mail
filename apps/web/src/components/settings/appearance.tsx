import { Monitor, Moon, Sun } from "lucide-react";
import { usePreferences } from "@/components/preferences-provider";
import type { ThemePreference } from "@/lib/preferences";
const themes = [
  { id: "light", name: "Light", description: "A clear, bright workspace.", icon: Sun },
  { id: "dark", name: "Dark", description: "Softer light for late hours.", icon: Moon },
  { id: "system", name: "System", description: "Follow your device appearance.", icon: Monitor },
] satisfies { id: ThemePreference; name: string; description: string; icon: typeof Sun }[];
export function AppearanceSettings() {
  const { theme, setTheme } = usePreferences();
  return (
    <fieldset>
      <legend className="mb-4 text-sm font-medium">Theme</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {themes.map(({ id, name, description, icon: Icon }) => (
          <label key={id} className={`settings-theme ${theme === id ? "settings-theme-selected" : ""}`}>
            <input
              type="radio"
              name="theme"
              value={id}
              checked={theme === id}
              onChange={() => setTheme(id)}
              className="sr-only"
            />
            <Icon className="size-5" />
            <span className="text-sm font-medium">{name}</span>
            <span className="text-xs text-muted-foreground">{description}</span>
          </label>
        ))}
      </div>
      <p className="mt-5 text-sm text-muted-foreground">
        Appearance saves on this device and applies to all your accounts.
      </p>
    </fieldset>
  );
}
