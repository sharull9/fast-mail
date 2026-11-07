import { expect, test } from "bun:test";
import { parsePreferences, resolveTheme } from "@/lib/preferences";
test("device preferences recover malformed values without losing valid shortcuts", () => {
  expect(parsePreferences(null).value.theme).toBe("dark");
  expect(parsePreferences("{").recovered).toBe(true);
  const parsed = parsePreferences(
    JSON.stringify({
      version: 1,
      theme: "system",
      shortcuts: { compose: "Alt+N", search: null, nonsense: "F2", next: "NotARealKey" },
    }),
  );
  expect(parsed.value.shortcuts).toEqual({ compose: "Alt+N", search: null });
  expect(parsed.recovered).toBe(true);
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("system", true)).toBe("dark");
});
