import type { Participant, ThreadDateRange } from "@mailfast/shared";

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

export const SCOPES = ["INBOX", "ALL", "STARRED", "IMPORTANT"];
export const SIDEBAR_ORDER = ["INBOX", "SENT", "DRAFT", "SPAM", "TRASH"];
export const HIDDEN_LABELS = new Set(["UNREAD", "CHAT", "YELLOW_STAR"]);

export function labelName(id: string, fallback?: string): string {
  return SYSTEM_NAMES[id] ?? fallback ?? id;
}

export type DateRange = { from?: string; to?: string };

/** URL dates are inclusive local calendar dates, never UTC midnights. */
export function localDate(value: string): Date {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function dateParam(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validateDateRange(search: Record<string, unknown>): DateRange {
  const valid = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateParam(localDate(value)) === value
      ? value
      : undefined;
  const today = dateParam(new Date());
  const parsedFrom = valid(search.from);
  const parsedTo = valid(search.to);
  const from = parsedFrom && parsedFrom <= today ? parsedFrom : undefined;
  const to = parsedTo && parsedTo > today ? today : parsedTo;
  return from && to && from > to ? { from: to, to: from } : { from, to };
}

/** Inclusive URL calendar days become [local midnight, next local midnight). */
export function threadDateRange({ from, to }: DateRange): ThreadDateRange {
  const end = to ? localDate(to) : undefined;
  end?.setDate(end.getDate() + 1);
  return { after: from ? localDate(from).getTime() : undefined, before: end?.getTime() };
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

/** Splits a raw To/Cc header ("Ann <a@x.com>, \"Doe, Bob\" <b@x.com>, c@x.com") into addresses. */
export function parseAddresses(header: string): { name: string; email: string }[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angle = false;
  for (const char of header) {
    if (char === '"') quoted = !quoted;
    else if (char === "<") angle = true;
    else if (char === ">") angle = false;
    if (char === "," && !quoted && !angle) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(.*?)\s*<([^>]+)>$/.exec(part);
      if (!match) return { name: "", email: part };
      const name = (match[1] ?? "").trim().replace(/^"|"$/g, "");
      // Senders sometimes leave template gaps such as "Arafatulla undefined".
      return { name: name.replace(/\s+(undefined|null)$/i, ""), email: (match[2] ?? "").trim() };
    });
}
