import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { appHotkeys } from "@/lib/hotkeys";
import {
  parsePreferences,
  PREFERENCES_KEY,
  resolveTheme,
  type DevicePreferences,
  type ThemePreference,
} from "@/lib/preferences";

type PreferencesContext = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  error: string;
  recovered: boolean;
};
const Context = createContext<PreferencesContext | null>(null);
export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("Preferences provider missing");
  return value;
}
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try {
      return { ...parsePreferences(localStorage.getItem(PREFERENCES_KEY)), error: "" };
    } catch {
      return {
        ...parsePreferences(null),
        error: "Device storage is unavailable. Preferences will not survive a restart.",
      };
    }
  });
  const [preferences, setPreferences] = useState(initial.value);
  const [error, setError] = useState(initial.error);
  const save = (value: DevicePreferences) => {
    setPreferences(value);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
      setError("");
    } catch {
      setError("Changes apply for this session but could not be saved. Check device storage and try again.");
    }
  };
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = resolveTheme(preferences.theme, media.matches);
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.style.colorScheme = theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key === PREFERENCES_KEY) setPreferences(parsePreferences(event.newValue).value);
    };
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, []);
  return (
    <Context
      value={{
        theme: preferences.theme,
        setTheme: (theme) => save({ ...preferences, theme }),
        error,
        recovered: initial.recovered,
      }}
    >
      <HotkeysProvider
        appHotkeys={appHotkeys}
        customHotkeys={preferences.shortcuts}
        onCustomHotkeysChange={(shortcuts) => save({ ...preferences, shortcuts })}
        scope="app"
        defaultOptions={{ hotkey: { preventDefault: true, stopPropagation: false } }}
      >
        {children}
      </HotkeysProvider>
    </Context>
  );
}
