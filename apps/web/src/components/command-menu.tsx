import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "@tanstack/react-db";
import { INBOX_TABS, type ThreadAction } from "@mailfast/shared";
import { authQuery, labelsCollection, queryClient, searchQuery } from "@/lib/data";
import { api, openExternal } from "@/lib/api";
import { cleanSnippet, listDate, labelName, SCOPES, SIDEBAR_ORDER, sendersLabel } from "@/lib/format";
import { act } from "@/components/thread-list";
import { Badge } from "@/components/ui/badge";
import { MailAvatar } from "@/components/mail-avatar";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";

const ACTIONS: { name: string; action: ThreadAction; shortcut?: string }[] = [
  { name: "Archive", action: { kind: "archive" }, shortcut: "e" },
  { name: "Move to inbox", action: { kind: "inbox" } },
  { name: "Trash", action: { kind: "trash" }, shortcut: "#" },
  { name: "Restore from trash", action: { kind: "untrash" } },
  { name: "Mark read", action: { kind: "read" }, shortcut: "I" },
  { name: "Mark unread", action: { kind: "unread" }, shortcut: "U" },
  { name: "Star", action: { kind: "star" }, shortcut: "s" },
  { name: "Unstar", action: { kind: "unstar" }, shortcut: "s" },
  { name: "Mark important", action: { kind: "important" } },
  { name: "Mark unimportant", action: { kind: "unimportant" } },
];

type MenuCommand = {
  id: string;
  name: string;
  token: string;
  icon: string;
  shortcut?: string;
  /** Rendered in the destructive colour (delete, sign out). */
  destructive?: boolean;
  run: () => void | Promise<void>;
  disabled: boolean;
};

export function CommandMenu({
  open,
  onClose,
  onToggleSidebar,
  onPairBrowser,
  initialQuery,
}: {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
  onToggleSidebar: () => void;
  onPairBrowser: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const location = useRouterState({ select: (s) => s.location });
  const routeQuery = "q" in location.search && typeof location.search.q === "string" ? location.search.q : "";
  const selectedId =
    params.threadId ??
    ("t" in location.search && typeof location.search.t === "string" ? location.search.t : undefined);
  const { data: labels } = useLiveQuery({ query: (q) => q.from({ l: labelsCollection }) });
  const account = useQuery(authQuery).data?.account ?? "";
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [commandError, setCommandError] = useState("");
  const commandOnly = value.trimStart().startsWith("@") && !/^@user:/i.test(value.trimStart());
  const mailQuery = commandOnly ? "" : debounced.trim();
  const search = useQuery({ ...searchQuery(mailQuery), enabled: open && !!mailQuery });
  useEffect(() => {
    if (open) {
      setValue(initialQuery ?? routeQuery);
      setDebounced(initialQuery ?? routeQuery);
      setCommandError("");
    }
  }, [open, routeQuery, initialQuery]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 100);
    return () => clearTimeout(timer);
  }, [value]);
  const goLabel = (id: string) => void navigate({ to: "/mail/$labelId", params: { labelId: id } });
  const commands: MenuCommand[] = [
    ...[...SCOPES, ...SIDEBAR_ORDER.filter((id) => !SCOPES.includes(id))].map((id) => ({
      id: `label:${id.toLowerCase()}`,
      name: labelName(id),
      token: id.toLowerCase(),
      icon: id,
      run: () => goLabel(id),
      disabled: false,
    })),
    ...INBOX_TABS.filter((tab) => tab.id !== "INBOX").map((tab) => ({
      id: `tab:${tab.id.toLowerCase()}`,
      name: `${tab.name} inbox`,
      token: tab.name.toLowerCase(),
      icon: "INBOX",
      run: () => goLabel(tab.id),
      disabled: false,
    })),
    ...labels
      .filter((label) => label.type === "user")
      .map((label) => ({
        id: `user-label:${label.id.toLowerCase()}`,
        name: label.name,
        token: label.name.toLowerCase(),
        icon: "tag",
        run: () => goLabel(label.id),
        disabled: false,
      })),
    {
      id: "global:sync",
      name: "Sync mail",
      token: "sync",
      icon: "ALL",
      disabled: false,
      run: async () => {
        await api.syncNow();
      },
    },
    {
      id: "global:sidebar",
      name: "Toggle sidebar",
      token: "sidebar",
      icon: "panel",
      run: onToggleSidebar,
      disabled: false,
    },
    {
      id: "global:pair-browser",
      name: "Pair browser",
      token: "pair",
      icon: "external",
      run: onPairBrowser,
      disabled: false,
    },
    {
      id: "global:disconnect-browser",
      name: "Disconnect browser",
      token: "disconnect",
      icon: "command",
      disabled: false,
      run: async () => {
        await api.disconnectBrowser();
      },
    },
    {
      id: "global:gmail",
      name: "Open in Gmail",
      token: "gmail",
      icon: "external",
      disabled: !selectedId,
      run: () => {
        if (selectedId)
          openExternal(`https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${selectedId}`);
      },
    },
    {
      id: "global:signout",
      name: "Sign out",
      token: "signout",
      icon: "command",
      destructive: true,
      disabled: false,
      run: async () => {
        await api.logout();
        queryClient.clear();
        window.location.reload();
      },
    },
    ...ACTIONS.map(({ name, action, shortcut }) => ({
      id: `action:${action.kind}`,
      name,
      token: action.kind,
      shortcut,
      icon: action.kind === "trash" ? "TRASH" : action.kind === "archive" ? "archive" : "command",
      destructive: action.kind === "trash",
      run: () => {
        if (selectedId) act([selectedId], action);
      },
      disabled: !selectedId,
    })),
  ];
  const needle = value.trim().replace(/^@/, "").toLowerCase();
  const matchingCommands = /^@user:/i.test(value.trim())
    ? []
    : commands.filter((command) => !needle || `${command.token} ${command.name}`.toLowerCase().includes(needle));
  const threads = !commandOnly && mailQuery === value.trim() ? (search.data?.threads.slice(0, 8) ?? []) : [];
  const items = [
    ...matchingCommands.map((command) => ({
      ...command,
      detail: `@${command.token}`,
      group: value.trim()
        ? "Commands"
        : command.id.startsWith("label:") || command.id.startsWith("tab:") || command.id.startsWith("user-label:")
          ? "Go to"
          : "Actions",
    })),
    ...threads.map((thread) => ({
      id: `mail:${thread.id}`,
      name: thread.subject || "(no subject)",
      icon: "INBOX",
      disabled: false,
      detail: sendersLabel(thread.senders, thread.messageCount),
      group: "Mail",
      shortcut: undefined,
      run: () => void navigate({ to: "/search", search: { q: value.trim(), t: thread.id } }),
    })),
    ...(!commandOnly && value.trim() && threads.length > 0
      ? [
          {
            id: "results",
            name: "Show all mail results",
            icon: "search",
            disabled: false,
            detail: value.trim(),
            group: "Mail",
            shortcut: undefined,
            run: () => void navigate({ to: "/search", search: { q: value.trim() } }),
          },
        ]
      : []),
  ];
  items.sort(
    (a, b) =>
      ["Mail", "Go to", "Actions", "Commands"].indexOf(a.group) -
      ["Mail", "Go to", "Actions", "Commands"].indexOf(b.group),
  );
  const itemIds = items.map((item) => item.id);
  const itemSignature = itemIds.join("\u0000");
  const firstItemId = itemIds[0] ?? "";
  useEffect(() => {
    setSelectedItem(firstItemId);
  }, [firstItemId, itemSignature]);
  const execute = async (id: string) => {
    const item = items.find((item) => item.id === id);
    if (!item || item.disabled) return;
    try {
      await item.run();
      onClose();
    } catch {
      setCommandError("Could not run that command. Try again.");
    }
  };
  return (
    <CommandDialog
      title="Search mail and commands"
      description="Search cached mail, filter with @user:alice, or type @ to find an action."
      className="top-[14vh] w-[640px] max-w-[92vw] translate-y-0 gap-0 rounded-xl border bg-popover shadow-2xl sm:max-w-[92vw]"
      showCloseButton={false}
      commandProps={{ value: selectedItem, onValueChange: setSelectedItem, shouldFilter: false, loop: true }}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      contentProps={{
        onOpenAutoFocus: (event) => {
          event.preventDefault();
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          input.current?.focus();
          input.current?.select();
        },
        onCloseAutoFocus: (event) => {
          const previousFocus = returnFocus.current;
          returnFocus.current = null;
          if (previousFocus?.isConnected) {
            event.preventDefault();
            previousFocus.focus();
          }
        },
        onKeyDown: (event) => {
          if (event.key !== "Escape") event.stopPropagation();
        },
      }}
    >
      <CommandInput
        ref={input}
        value={value}
        aria-label="Search mail or type @ for commands"
        placeholder="Search mail or type @ for commands"
        onValueChange={(next) => {
          setValue(next);
          if (!next.trim() && location.pathname === "/search") goLabel("INBOX");
        }}
        trailing={
          value ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear search"
              onClick={() => {
                setValue("");
                setDebounced("");
                input.current?.focus();
                if (location.pathname === "/search") goLabel("INBOX");
              }}
            >
              <Icon name="close" />
            </Button>
          ) : (
            <kbd className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">Esc</kbd>
          )
        }
      />
      {commandError && (
        <Alert variant="destructive">
          <AlertDescription>{commandError}</AlertDescription>
        </Alert>
      )}
      <CommandList className="max-h-[min(400px,calc(86dvh-86px))]">
        <CommandEmpty>No results for “{value.trim()}”</CommandEmpty>
        {["Mail", "Go to", "Actions", "Commands"].map((group) => {
          const entries = items.filter((item) => item.group === group);
          return (
            entries.length > 0 && (
              <CommandGroup heading={group} key={group}>
                {entries.map((item) => {
                  const thread = threads.find((t) => item.id === `mail:${t.id}`);
                  const primary = thread
                    ? (["TRASH", "SPAM", "INBOX", "SENT"].find((id) => thread.labelIds.includes(id)) ?? "Archive")
                    : "";
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      disabled={item.disabled}
                      className={cn(
                        thread && "h-[52px]",
                        "destructive" in item &&
                          item.destructive &&
                          "text-destructive data-[selected=true]:bg-destructive/10 data-[selected=true]:text-destructive [&_svg]:text-destructive",
                      )}
                      onSelect={() => void execute(item.id)}
                    >
                      {thread ? (
                        <>
                          <MailAvatar
                            name={thread.senders[0]?.name ?? ""}
                            email={thread.senders[0]?.email ?? ""}
                            className="size-7"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-xs font-medium">
                                {sendersLabel(thread.senders, thread.messageCount)}
                              </span>
                              <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px]">
                                {labelName(primary)}
                              </Badge>
                              <time className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
                                {listDate(thread.lastDate)}
                              </time>
                            </span>
                            <span className="block truncate text-xs leading-5">
                              <Highlight text={thread.subject || "(no subject)"} query={value} />
                              <span className="text-muted-foreground">
                                {" · "}
                                <Highlight text={cleanSnippet(thread.snippet)} query={value} />
                              </span>
                            </span>
                          </span>
                        </>
                      ) : (
                        <>
                          <Icon name={item.icon} />
                          <span className="min-w-0 truncate text-sm">{item.name}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">{item.detail}</span>
                            {item.shortcut && (
                              <kbd className="rounded border px-1.5 text-[11px] text-muted-foreground">
                                {item.shortcut}
                              </kbd>
                            )}
                          </span>
                        </>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )
          );
        })}
        {!commandOnly && value.trim() && (value !== debounced || search.isFetching || search.isError) && (
          <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
            {search.isError ? "Could not search cached mail. Try again." : "Searching cached mail..."}
          </p>
        )}
      </CommandList>
      <footer className="flex h-9 shrink-0 items-center justify-between gap-2 border-t px-3 text-[11px] text-muted-foreground">
        <span role="status">
          {value.trim() ? `${threads.length + matchingCommands.length} results` : "Type @ for commands"}
        </span>
        <span className="flex items-center gap-1">
          {["↑↓ navigate", "↵ open", "esc close"].map((hint) => (
            <kbd key={hint} className="rounded border px-1.5 py-0.5 font-sans">
              {hint}
            </kbd>
          ))}
        </span>
      </footer>
    </CommandDialog>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .replace(/(?:from:|@user:)\S+/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return text;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  return text.split(regex).map((part, index) =>
    index % 2 ? (
      <mark key={index} className="rounded-sm bg-accent px-0.5 text-accent-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
