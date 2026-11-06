import type { Participant } from "@mailfast/shared";

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const full = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "numeric", day: "numeric" });
const long = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Gmail-style list date: time today, "Mar 4" this year, "3/4/2023" otherwise. */
export function listDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time.format(d);
  if (d.getFullYear() === now.getFullYear()) return monthDay.format(d);
  return full.format(d);
}

export function longDate(ms: number): string {
  return long.format(new Date(ms));
}

/** "Alice, me (3)" */
export function sendersLabel(senders: Participant[], count: number): string {
  const names = senders.map((s) => (s.name === "me" ? "me" : s.name.split(/[\s,@]/)[0] || s.email));
  const shown = names.length > 3 ? [names[0], "…", ...names.slice(-2)] : names;
  return shown.join(", ") + (count > 1 ? ` (${count})` : "");
}

const SYSTEM_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  INBOX_PRIMARY: "Inbox · Primary",
  INBOX_SOCIAL: "Inbox · Social",
  INBOX_UPDATES: "Inbox · Updates",
  STARRED: "Starred",
  IMPORTANT: "Important",
  SENT: "Sent",
  DRAFT: "Drafts",
  ALL: "All Mail",
  SPAM: "Spam",
  TRASH: "Trash",
  CATEGORY_PERSONAL: "Personal",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
};

export const SIDEBAR_ORDER = ["INBOX", "STARRED", "IMPORTANT", "SENT", "DRAFT", "ALL", "SPAM", "TRASH"];
export const HIDDEN_LABELS = new Set(["UNREAD", "CHAT", "YELLOW_STAR"]);

export function labelName(id: string, fallback?: string): string {
  return SYSTEM_NAMES[id] ?? fallback ?? id;
}

/** Remove invisible marketing padding before displaying mail previews. */
export function cleanSnippet(value: string): string {
  return value
    .replace(/[\u034F\u200B-\u200F\u00AD\u2060-\u2064\uFEFF\u3164]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const monthYear = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });

export function dateGroup(ms: number, now = new Date()) {
  const date = new Date(ms);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  if (date >= today) return { key: "today", label: "Today", collapsed: false };
  if (date >= yesterday) return { key: "yesterday", label: "Yesterday", collapsed: false };
  if (date >= week) return { key: "week", label: "This week", collapsed: false };
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    label: monthYear.format(date),
    collapsed: date.getFullYear() !== now.getFullYear() || date.getMonth() !== now.getMonth(),
  };
}
