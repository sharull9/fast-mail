import { ALL_KEYS, parseHotkey, validateHotkey, type CustomHotkeys, type HotkeyChord } from "@tanstack/react-hotkeys";
import { devicePreferencesSchema } from "@mailfast/shared";
import { appHotkeys } from "@/lib/hotkeys";

export const PREFERENCES_KEY = "mailfast.preferences.v1";
export type ThemePreference = "light" | "dark" | "system";
export type DevicePreferences = { version: 1; theme: ThemePreference; shortcuts: CustomHotkeys<typeof appHotkeys> };
export function isChord(value: unknown): value is HotkeyChord {
  if (typeof value !== "string" || value.length > 80) return false;
  const result = validateHotkey(value);
  if (!result.valid || result.warnings.length) return false;
  const parsed = parseHotkey(value);
  return parsed.key !== undefined && (parsed.key.length === 1 || [...ALL_KEYS].some((key) => key === parsed.key));
}
export function parsePreferences(raw: string | null): { value: DevicePreferences; recovered: boolean } {
  const fallback: DevicePreferences = { version: 1, theme: "dark", shortcuts: {} };
  if (!raw) return { value: fallback, recovered: false };
  try {
    const parsed = devicePreferencesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { value: fallback, recovered: true };
    const shortcuts: DevicePreferences["shortcuts"] = {};
    let recovered = false;
    for (const [id, value] of Object.entries(parsed.data.shortcuts)) {
      if (Object.hasOwn(appHotkeys, id) && (value === null || isChord(value))) {
        Object.defineProperty(shortcuts, id, { value, enumerable: true, configurable: true, writable: true });
      } else recovered = true;
    }
    return { value: { version: 1, theme: parsed.data.theme, shortcuts }, recovered };
  } catch {
    return { value: fallback, recovered: true };
  }
}
export function resolveTheme(theme: ThemePreference, systemDark: boolean) {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}
// Runs before the UI paints; the provider reads the same validated preference.
export const themeBootstrap = `try{var p=JSON.parse(localStorage.getItem('${PREFERENCES_KEY}')||'null');var t=p&&p.version===1&&['light','dark','system'].includes(p.theme)?p.theme:'dark';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch{}`;
