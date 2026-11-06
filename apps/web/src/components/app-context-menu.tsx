import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Clipboard,
  Copy,
  ExternalLink,
  PanelLeft,
  RefreshCw,
  Scissors,
  Search,
  TextSelect,
} from "lucide-react";
import { api, openExternal } from "@/lib/api";
import { useSidebar } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function openCommandMenu(query?: string) {
  window.dispatchEvent(new CustomEvent("mailfast:command", { detail: query }));
}
type Context = { x: number; y: number; target: HTMLElement; text: string; link?: string; editable: boolean };

export function AppContextMenu({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<Context | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const generation = useRef(0);
  const { toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const location = useRouterState({ select: (s) => s.location });
  const threadOpen = !!params.threadId || ("t" in location.search && !!location.search.t);
  useEffect(() => {
    const onContext = (event: MouseEvent) => {
      const handled = event.defaultPrevented;
      event.preventDefault();
      if (
        handled ||
        !(event.target instanceof HTMLElement) ||
        event.target.closest('[data-slot="context-menu-content"], [data-slot="dropdown-menu-content"]')
      )
        return;
      const target = event.target;
      const editable =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
      const next = {
        x: event.clientX,
        y: event.clientY,
        target,
        editable,
        text: window.getSelection()?.toString().trim() ?? "",
        link: target.closest<HTMLAnchorElement>("a[href]")?.href,
      };
      setContext(next);
      setPaste(null);
      setOpen(true);
      const version = ++generation.current;
      if (editable && navigator.clipboard)
        void navigator.clipboard
          .readText()
          .then((value) => {
            if (version === generation.current) setPaste(value);
          })
          .catch(() => {});
    };
    document.addEventListener("contextmenu", onContext);
    return () => document.removeEventListener("contextmenu", onContext);
  }, []);
  const edit = (command: string) => {
    context?.target.focus();
    if (
      command === "selectAll" &&
      (context?.target instanceof HTMLInputElement || context?.target instanceof HTMLTextAreaElement)
    )
      context.target.select();
    else document.execCommand(command);
  };
  const pasteText = () => {
    const target = context?.target;
    target?.focus();
    if (paste === null) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      const descriptor = Object.getOwnPropertyDescriptor(
        target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        "value",
      );
      descriptor?.set?.call(target, target.value.slice(0, start) + paste + target.value.slice(end));
      target.setSelectionRange(start + paste.length, start + paste.length);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    } else document.execCommand("insertText", false, paste);
  };
  return (
    <>
      {children}
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: context?.x ?? 0, top: context?.y ?? 0 }}
        />
        <DropdownMenuContent
          align="start"
          sideOffset={0}
          className="w-64"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            context?.target.focus();
          }}
        >
          {context?.editable ? (
            <>
              <DropdownMenuItem onSelect={() => edit("cut")}>
                <Scissors />
                Cut
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => edit("copy")}>
                <Copy />
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem disabled={paste === null} onSelect={pasteText}>
                <Clipboard />
                Paste
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => edit("selectAll")}>
                <TextSelect />
                Select all
              </DropdownMenuItem>
            </>
          ) : context?.text ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard.writeText(context.text);
                }}
              >
                <Copy />
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openCommandMenu(context.text)}>
                <Search />
                <span className="truncate">Search mail for “{context.text}”</span>
              </DropdownMenuItem>
            </>
          ) : context?.link ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  if (context.link) openExternal(context.link);
                }}
              >
                <ExternalLink />
                Open link
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard.writeText(context.link ?? "");
                }}
              >
                <Copy />
                Copy link address
              </DropdownMenuItem>
            </>
          ) : (
            <>
              {threadOpen && (
                <DropdownMenuItem
                  onSelect={() => {
                    if (params.labelId) void navigate({ to: "/mail/$labelId", params: { labelId: params.labelId } });
                    else if ("q" in location.search && typeof location.search.q === "string")
                      void navigate({ to: "/search", search: { q: location.search.q } });
                  }}
                >
                  <ArrowLeft />
                  Back to list
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => openCommandMenu()}>
                <Search />
                Search mail
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void api.syncNow();
                }}
              >
                <RefreshCw />
                Sync now
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleSidebar}>
                <PanelLeft />
                Toggle sidebar
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
