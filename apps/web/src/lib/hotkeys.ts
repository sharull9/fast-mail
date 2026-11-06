import { defineAppHotkeys, formatForDisplay, type AppHotkeyInput } from "@tanstack/react-hotkeys";

export type ShortcutGroup = "Navigation" | "Actions" | "Selection" | "Search" | "Accounts";
type ShortcutDefinition = AppHotkeyInput & { meta: { name: string; description: string; group: ShortcutGroup } };

export const appHotkeys = defineAppHotkeys({
  search: {
    hotkey: "Mod+K",
    meta: { name: "Search mail", description: "Open search and select the query.", group: "Search" },
    scope: "global",
    options: { capture: true, ignoreInputs: false },
  },
  find: {
    hotkey: "Mod+F",
    meta: { name: "Find mail", description: "Open search and select the query.", group: "Search" },
    scope: "global",
    options: { capture: true, ignoreInputs: false },
  },
  searchSlash: {
    hotkey: "/",
    meta: { name: "Search mail", description: "Open search when not typing.", group: "Search" },
  },
  shortcuts: {
    hotkey: "?",
    meta: { name: "Keyboard shortcuts", description: "Show all keyboard shortcuts.", group: "Navigation" },
  },
  sidebar: {
    hotkey: "Mod+B",
    meta: { name: "Toggle sidebar", description: "Expand or collapse the sidebar.", group: "Navigation" },
  },
  next: {
    hotkey: "J",
    meta: {
      name: "Next conversation",
      description: "Move down through loaded conversations, expanding groups.",
      group: "Navigation",
    },
  },
  nextArrow: {
    hotkey: "ArrowDown",
    meta: {
      name: "Next conversation",
      description: "Move down through loaded conversations, expanding groups.",
      group: "Navigation",
    },
  },
  previous: {
    hotkey: "K",
    meta: {
      name: "Previous conversation",
      description: "Move up through loaded conversations, expanding groups.",
      group: "Navigation",
    },
  },
  previousArrow: {
    hotkey: "ArrowUp",
    meta: {
      name: "Previous conversation",
      description: "Move up through loaded conversations, expanding groups.",
      group: "Navigation",
    },
  },
  open: {
    hotkey: "Enter",
    meta: { name: "Open conversation", description: "Open the focused conversation.", group: "Navigation" },
  },
  close: {
    hotkey: "Escape",
    meta: {
      name: "Clear selection or close pane",
      description: "Clear selected rows first, otherwise close the conversation.",
      group: "Selection",
    },
  },
  select: {
    hotkey: "X",
    meta: { name: "Toggle selection", description: "Select or deselect the focused conversation.", group: "Selection" },
  },
  selectAll: {
    hotkey: "Mod+A",
    meta: { name: "Select all", description: "Select every visible conversation.", group: "Selection" },
  },
  archive: {
    hotkey: "E",
    meta: { name: "Archive", description: "Archive or move to Inbox; advance to the neighbour.", group: "Actions" },
  },
  trash: {
    hotkey: "#",
    meta: {
      name: "Trash or restore",
      description: "Trash a conversation, or restore it in Trash; advance to the neighbour.",
      group: "Actions",
    },
  },
  trashDelete: {
    hotkey: "Delete",
    meta: {
      name: "Trash or restore",
      description: "Trash a conversation, or restore it in Trash; advance to the neighbour.",
      group: "Actions",
    },
  },
  star: {
    hotkey: "S",
    meta: { name: "Toggle star", description: "Star or unstar the selected conversations.", group: "Actions" },
  },
  read: {
    hotkey: "Shift+I",
    meta: { name: "Mark read", description: "Mark the selected conversations read.", group: "Actions" },
  },
  unread: {
    hotkey: "Shift+U",
    meta: { name: "Mark unread", description: "Mark the selected conversations unread.", group: "Actions" },
  },
  account1: {
    hotkey: "Mod+1",
    meta: { name: "Switch to account 1", description: "Switch to account 1 when not typing.", group: "Accounts" },
  },
  account2: {
    hotkey: "Mod+2",
    meta: { name: "Switch to account 2", description: "Switch to account 2 when not typing.", group: "Accounts" },
  },
  account3: {
    hotkey: "Mod+3",
    meta: { name: "Switch to account 3", description: "Switch to account 3 when not typing.", group: "Accounts" },
  },
  account4: {
    hotkey: "Mod+4",
    meta: { name: "Switch to account 4", description: "Switch to account 4 when not typing.", group: "Accounts" },
  },
  account5: {
    hotkey: "Mod+5",
    meta: { name: "Switch to account 5", description: "Switch to account 5 when not typing.", group: "Accounts" },
  },
  account6: {
    hotkey: "Mod+6",
    meta: { name: "Switch to account 6", description: "Switch to account 6 when not typing.", group: "Accounts" },
  },
  account7: {
    hotkey: "Mod+7",
    meta: { name: "Switch to account 7", description: "Switch to account 7 when not typing.", group: "Accounts" },
  },
  account8: {
    hotkey: "Mod+8",
    meta: { name: "Switch to account 8", description: "Switch to account 8 when not typing.", group: "Accounts" },
  },
  account9: {
    hotkey: "Mod+9",
    meta: { name: "Switch to account 9", description: "Switch to account 9 when not typing.", group: "Accounts" },
  },
} satisfies Record<string, ShortcutDefinition>);

export type ShortcutId = keyof typeof appHotkeys;
export const accountHotkeys = [
  appHotkeys.account1,
  appHotkeys.account2,
  appHotkeys.account3,
  appHotkeys.account4,
  appHotkeys.account5,
  appHotkeys.account6,
  appHotkeys.account7,
  appHotkeys.account8,
  appHotkeys.account9,
];

export function shortcutLabel(id: ShortcutId) {
  const hotkey = appHotkeys[id].defaultHotkey;
  return formatForDisplay(hotkey, {
    keyLabels: /^[A-Z]$/.test(hotkey) ? { [hotkey]: hotkey.toLowerCase() } : undefined,
  });
}

declare module "@tanstack/react-hotkeys" {
  interface Register {
    appHotkeys: typeof appHotkeys;
  }
}
