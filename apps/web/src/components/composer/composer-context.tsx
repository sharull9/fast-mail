import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/data";
import { sendMessageRequestSchema, type SendMessageRequest, type SendMessageResponse } from "@mailfast/shared";

export interface ComposerAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string; // base64
}

export interface ComposerDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments: ComposerAttachment[];
}

export type ComposerMode = "floating" | "fixed";

export const EMPTY_DRAFT: ComposerDraft = {
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  bodyHtml: "",
  attachments: [],
};

export const MAX_COMPOSERS = 5;

export interface ComposerSession {
  id: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  mode: ComposerMode;
  draft: ComposerDraft;
  isSending: boolean;
  sendError: string | null;
  zIndex: number;
  createdAt: number;
}

export function hasDraftContent(draft: ComposerDraft): boolean {
  return (
    draft.to.length > 0 ||
    draft.cc.length > 0 ||
    draft.bcc.length > 0 ||
    draft.subject.trim().length > 0 ||
    draft.bodyHtml.replace(/<[^>]*>/g, "").trim().length > 0 ||
    draft.attachments.length > 0
  );
}

export interface ComposerContextValue {
  composers: ComposerSession[];
  activeComposerId: string | null;
  openComposer: (initial?: Partial<ComposerDraft>, mode?: ComposerMode) => string | null;
  closeComposer: (id?: string) => void;
  toggleMinimize: (id?: string) => void;
  toggleMaximize: (id?: string) => void;
  setMode: (mode: ComposerMode, id?: string) => void;
  updateDraft: (updates: Partial<ComposerDraft> | ((prev: ComposerDraft) => ComposerDraft), id?: string) => void;
  clearDraft: (id?: string) => void;
  sendMessage: (id?: string) => Promise<SendMessageResponse | null>;
  hasContent: (id?: string) => boolean;
  bringToFront: (id: string) => void;
}

export interface SingleComposerHookValue {
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  mode: ComposerMode;
  draft: ComposerDraft;
  isSending: boolean;
  sendError: string | null;
  composers: ComposerSession[];
  activeComposerId: string | null;
  openComposer: (initial?: Partial<ComposerDraft>, mode?: ComposerMode) => string | null;
  closeComposer: (id?: string) => void;
  toggleMinimize: (id?: string) => void;
  toggleMaximize: (id?: string) => void;
  setMode: (mode: ComposerMode, id?: string) => void;
  updateDraft: (updates: Partial<ComposerDraft> | ((prev: ComposerDraft) => ComposerDraft), id?: string) => void;
  clearDraft: (id?: string) => void;
  sendMessage: (id?: string) => Promise<SendMessageResponse | null>;
  hasContent: (id?: string) => boolean;
  bringToFront: (id: string) => void;
}

const ComposerContext = createContext<ComposerContextValue | null>(null);

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [composers, setComposers] = useState<ComposerSession[]>([]);
  const [activeComposerId, setActiveComposerId] = useState<string | null>(null);

  const closeComposer = useCallback(
    (id?: string) => {
      setComposers((prev) => {
        const targetId = id ?? activeComposerId ?? (prev.length > 0 ? prev[prev.length - 1].id : null);
        if (!targetId) return prev;
        return prev.filter((c) => c.id !== targetId);
      });
      setActiveComposerId((currActive) => {
        const targetId = id ?? currActive;
        if (currActive === targetId) {
          setComposers((prev) => {
            const remaining = prev.filter((c) => c.id !== targetId);
            return remaining;
          });
          return null;
        }
        return currActive;
      });
    },
    [activeComposerId],
  );

  const openComposer = useCallback((initial?: Partial<ComposerDraft>, initialMode?: ComposerMode): string | null => {
    const mode = initialMode ?? "floating";

    // If opening an inline fixed reply for a thread, check if an inline composer for this thread already exists
    if (mode === "fixed" && initial?.threadId) {
      let existingId: string | null = null;
      setComposers((prev) => {
        const found = prev.find((c) => c.isOpen && c.mode === "fixed" && c.draft.threadId === initial.threadId);
        if (found) {
          existingId = found.id;
          return prev.map((c) =>
            c.id === found.id
              ? {
                  ...c,
                  draft: {
                    ...c.draft,
                    to: initial?.to ?? c.draft.to,
                    cc: initial?.cc ?? c.draft.cc,
                    bcc: initial?.bcc ?? c.draft.bcc,
                    subject: initial?.subject ?? c.draft.subject,
                    bodyHtml: initial?.bodyHtml ?? c.draft.bodyHtml,
                    inReplyTo: initial?.inReplyTo ?? c.draft.inReplyTo,
                    references: initial?.references ?? c.draft.references,
                    attachments: initial?.attachments ?? c.draft.attachments,
                  },
                }
              : c,
          );
        }
        return prev;
      });
      if (existingId) {
        setActiveComposerId(existingId);
        return existingId;
      }
    }

    let openedId: string | null = null;

    setComposers((prev) => {
      // Check if we hit MAX_COMPOSERS limit (5)
      if (prev.length >= MAX_COMPOSERS) {
        // Reuse an empty composer if available
        const emptyIdx = prev.findIndex((c) => !hasDraftContent(c.draft));
        if (emptyIdx !== -1) {
          const target = prev[emptyIdx];
          openedId = target.id;
          return prev.map((c, i) =>
            i === emptyIdx
              ? {
                  ...c,
                  isOpen: true,
                  isMinimized: false,
                  mode,
                  draft: {
                    to: initial?.to ?? [],
                    cc: initial?.cc ?? [],
                    bcc: initial?.bcc ?? [],
                    subject: initial?.subject ?? "",
                    bodyHtml: initial?.bodyHtml ?? "",
                    threadId: initial?.threadId,
                    inReplyTo: initial?.inReplyTo,
                    references: initial?.references,
                    attachments: initial?.attachments ?? [],
                  },
                  sendError: null,
                }
              : c,
          );
        }
        // All 5 have content; focus active without opening a 6th
        openedId = prev[prev.length - 1].id;
        return prev;
      }

      // Create a new composer panel session
      const id = `composer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      openedId = id;
      const newSession: ComposerSession = {
        id,
        isOpen: true,
        isMinimized: false,
        isMaximized: false,
        mode,
        draft: {
          to: initial?.to ?? [],
          cc: initial?.cc ?? [],
          bcc: initial?.bcc ?? [],
          subject: initial?.subject ?? "",
          bodyHtml: initial?.bodyHtml ?? "",
          threadId: initial?.threadId,
          inReplyTo: initial?.inReplyTo,
          references: initial?.references,
          attachments: initial?.attachments ?? [],
        },
        isSending: false,
        sendError: null,
        zIndex: 50,
        createdAt: Date.now(),
      };
      return [...prev, newSession];
    });

    if (openedId) {
      setActiveComposerId(openedId);
    }
    return openedId;
  }, []);

  const toggleMinimize = useCallback(
    (id?: string) => {
      setComposers((prev) => {
        const targetId = id ?? activeComposerId ?? (prev.length > 0 ? prev[prev.length - 1].id : null);
        if (!targetId) return prev;
        return prev.map((c) => (c.id === targetId ? { ...c, isMinimized: !c.isMinimized } : c));
      });
    },
    [activeComposerId],
  );

  const toggleMaximize = useCallback(
    (id?: string) => {
      setComposers((prev) => {
        const targetId = id ?? activeComposerId ?? (prev.length > 0 ? prev[prev.length - 1].id : null);
        if (!targetId) return prev;
        return prev.map((c) => (c.id === targetId ? { ...c, isMaximized: !c.isMaximized } : c));
      });
    },
    [activeComposerId],
  );

  const setMode = useCallback(
    (m: ComposerMode, id?: string) => {
      setComposers((prev) => {
        const targetId = id ?? activeComposerId ?? (prev.length > 0 ? prev[prev.length - 1].id : null);
        if (!targetId) return prev;
        return prev.map((c) => (c.id === targetId ? { ...c, mode: m } : c));
      });
    },
    [activeComposerId],
  );

  const updateDraft = useCallback(
    (updates: Partial<ComposerDraft> | ((prev: ComposerDraft) => ComposerDraft), id?: string) => {
      setComposers((prev) => {
        const targetId = id ?? activeComposerId ?? (prev.length > 0 ? prev[prev.length - 1].id : null);
        if (!targetId) return prev;
        return prev.map((c) => {
          if (c.id !== targetId) return c;
          const nextDraft = typeof updates === "function" ? updates(c.draft) : { ...c.draft, ...updates };
          return { ...c, draft: nextDraft };
        });
      });
    },
    [activeComposerId],
  );

  const clearDraft = useCallback(
    (id?: string) => {
      setComposers((prev) => {
        const targetId = id ?? activeComposerId ?? (prev.length > 0 ? prev[prev.length - 1].id : null);
        if (!targetId) return prev;
        return prev.map((c) => {
          if (c.id !== targetId) return c;
          return {
            ...c,
            draft: {
              ...EMPTY_DRAFT,
              threadId: c.draft.threadId,
              inReplyTo: c.draft.inReplyTo,
              references: c.draft.references,
            },
            sendError: null,
          };
        });
      });
    },
    [activeComposerId],
  );

  const hasContent = useCallback(
    (id?: string): boolean => {
      const target = composers.find((c) => c.id === (id ?? activeComposerId));
      if (!target) return false;
      return hasDraftContent(target.draft);
    },
    [activeComposerId, composers],
  );

  const sendMessage = useCallback(
    async (id?: string): Promise<SendMessageResponse | null> => {
      const targetId = id ?? activeComposerId ?? (composers.length > 0 ? composers[composers.length - 1].id : null);
      if (!targetId) return null;
      const session = composers.find((c) => c.id === targetId);
      if (!session) return null;

      const payload: SendMessageRequest = {
        to: session.draft.to,
        cc: session.draft.cc.length > 0 ? session.draft.cc : undefined,
        bcc: session.draft.bcc.length > 0 ? session.draft.bcc : undefined,
        subject: session.draft.subject,
        bodyHtml: session.draft.bodyHtml || "<p></p>",
        threadId: session.draft.threadId,
        inReplyTo: session.draft.inReplyTo,
        references: session.draft.references,
        attachments:
          session.draft.attachments.length > 0
            ? session.draft.attachments.map((att) => ({
                filename: att.filename,
                mimeType: att.mimeType,
                content: att.content,
                size: att.size,
              }))
            : undefined,
      };

      const parsed = sendMessageRequestSchema.safeParse(payload);
      if (!parsed.success) {
        const errMsg = parsed.error.issues[0]?.message ?? "Invalid message";
        setComposers((prev) => prev.map((c) => (c.id === targetId ? { ...c, sendError: errMsg } : c)));
        return null;
      }

      setComposers((prev) => prev.map((c) => (c.id === targetId ? { ...c, isSending: true, sendError: null } : c)));

      try {
        const res = await api.sendMessage(parsed.data);

        // Invalidate relevant queries so new message appears
        if (session.draft.threadId) {
          void queryClient.invalidateQueries({ queryKey: ["threads", session.draft.threadId] });
          void queryClient.invalidateQueries({ queryKey: ["thread"] });
        }
        void queryClient.invalidateQueries({ queryKey: ["threads"] });

        closeComposer(targetId);
        return res;
      } catch (err) {
        console.error("[composer] failed to send message:", err);
        const msg = err instanceof Error ? err.message : "Failed to send message";
        setComposers((prev) => prev.map((c) => (c.id === targetId ? { ...c, sendError: msg, isSending: false } : c)));
        return null;
      }
    },
    [activeComposerId, composers, closeComposer],
  );

  const bringToFront = useCallback((id: string) => {
    setActiveComposerId(id);
  }, []);

  return (
    <ComposerContext.Provider
      value={{
        composers,
        activeComposerId,
        openComposer,
        closeComposer,
        toggleMinimize,
        toggleMaximize,
        setMode,
        updateDraft,
        clearDraft,
        sendMessage,
        hasContent,
        bringToFront,
      }}
    >
      {children}
    </ComposerContext.Provider>
  );
}

export function useComposer(composerId?: string): SingleComposerHookValue {
  const ctx = useContext(ComposerContext);
  if (!ctx) {
    throw new Error("useComposer must be used within ComposerProvider");
  }

  const {
    composers,
    activeComposerId,
    openComposer,
    closeComposer,
    toggleMinimize,
    toggleMaximize,
    setMode,
    updateDraft,
    clearDraft,
    sendMessage,
    hasContent,
    bringToFront,
  } = ctx;

  if (composerId) {
    const session = composers.find((c) => c.id === composerId);
    return {
      isOpen: session?.isOpen ?? false,
      isMinimized: session?.isMinimized ?? false,
      isMaximized: session?.isMaximized ?? false,
      mode: session?.mode ?? "floating",
      draft: session?.draft ?? EMPTY_DRAFT,
      isSending: session?.isSending ?? false,
      sendError: session?.sendError ?? null,
      composers,
      activeComposerId,
      openComposer,
      closeComposer: () => closeComposer(composerId),
      toggleMinimize: () => toggleMinimize(composerId),
      toggleMaximize: () => toggleMaximize(composerId),
      setMode: (m: ComposerMode) => setMode(m, composerId),
      updateDraft: (updates) => updateDraft(updates, composerId),
      clearDraft: () => clearDraft(composerId),
      sendMessage: () => sendMessage(composerId),
      hasContent: () => hasContent(composerId),
      bringToFront,
    };
  }

  const active = composers.find((c) => c.id === activeComposerId) ?? composers[composers.length - 1];

  return {
    isOpen: composers.some((c) => c.isOpen),
    isMinimized: active?.isMinimized ?? false,
    isMaximized: active?.isMaximized ?? false,
    mode: active?.mode ?? "floating",
    draft: active?.draft ?? EMPTY_DRAFT,
    isSending: active?.isSending ?? false,
    sendError: active?.sendError ?? null,
    composers,
    activeComposerId,
    openComposer,
    closeComposer,
    toggleMinimize,
    toggleMaximize,
    setMode,
    updateDraft,
    clearDraft,
    sendMessage,
    hasContent,
    bringToFront,
  };
}
