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

const EMPTY_DRAFT: ComposerDraft = {
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  bodyHtml: "",
  attachments: [],
};

interface ComposerContextValue {
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  mode: ComposerMode;
  draft: ComposerDraft;
  isSending: boolean;
  sendError: string | null;
  openComposer: (initial?: Partial<ComposerDraft>, mode?: ComposerMode) => void;
  closeComposer: () => void;
  toggleMinimize: () => void;
  toggleMaximize: () => void;
  setMode: (mode: ComposerMode) => void;
  updateDraft: (updates: Partial<ComposerDraft> | ((prev: ComposerDraft) => ComposerDraft)) => void;
  clearDraft: () => void;
  sendMessage: () => Promise<SendMessageResponse | null>;
  hasContent: () => boolean;
}

const ComposerContext = createContext<ComposerContextValue | null>(null);

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [mode, setModeState] = useState<ComposerMode>("floating");
  const [draft, setDraft] = useState<ComposerDraft>(EMPTY_DRAFT);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const openComposer = useCallback((initial?: Partial<ComposerDraft>, initialMode?: ComposerMode) => {
    setDraft({
      to: initial?.to ?? [],
      cc: initial?.cc ?? [],
      bcc: initial?.bcc ?? [],
      subject: initial?.subject ?? "",
      bodyHtml: initial?.bodyHtml ?? "",
      threadId: initial?.threadId,
      inReplyTo: initial?.inReplyTo,
      references: initial?.references,
      attachments: initial?.attachments ?? [],
    });
    if (initialMode) {
      setModeState(initialMode);
    }
    setIsOpen(true);
    setIsMinimized(false);
    setSendError(null);
  }, []);

  const closeComposer = useCallback(() => {
    setIsOpen(false);
    setIsMinimized(false);
    setIsMaximized(false);
    setDraft(EMPTY_DRAFT);
    setSendError(null);
  }, []);

  const toggleMinimize = useCallback(() => {
    setIsMinimized((prev) => !prev);
  }, []);

  const toggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  const setMode = useCallback((m: ComposerMode) => {
    setModeState(m);
  }, []);

  const updateDraft = useCallback((updates: Partial<ComposerDraft> | ((prev: ComposerDraft) => ComposerDraft)) => {
    setDraft((prev) => {
      if (typeof updates === "function") {
        return updates(prev);
      }
      return { ...prev, ...updates };
    });
  }, []);

  const clearDraft = useCallback(() => {
    setDraft((prev) => ({
      ...EMPTY_DRAFT,
      threadId: prev.threadId,
      inReplyTo: prev.inReplyTo,
      references: prev.references,
    }));
    setSendError(null);
  }, []);

  const hasContent = useCallback(() => {
    return (
      draft.to.length > 0 ||
      draft.subject.trim().length > 0 ||
      draft.bodyHtml.replace(/<[^>]*>/g, "").trim().length > 0 ||
      draft.attachments.length > 0
    );
  }, [draft]);

  const sendMessage = useCallback(async (): Promise<SendMessageResponse | null> => {
    const payload: SendMessageRequest = {
      to: draft.to,
      cc: draft.cc.length > 0 ? draft.cc : undefined,
      bcc: draft.bcc.length > 0 ? draft.bcc : undefined,
      subject: draft.subject,
      bodyHtml: draft.bodyHtml || "<p></p>",
      threadId: draft.threadId,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      attachments:
        draft.attachments.length > 0
          ? draft.attachments.map((att) => ({
              filename: att.filename,
              mimeType: att.mimeType,
              content: att.content,
              size: att.size,
            }))
          : undefined,
    };

    const parsed = sendMessageRequestSchema.safeParse(payload);
    if (!parsed.success) {
      setSendError(parsed.error.issues[0]?.message ?? "Invalid message");
      return null;
    }

    setIsSending(true);
    setSendError(null);

    try {
      const res = await api.sendMessage(parsed.data);

      // Invalidate relevant queries so new message appears
      if (draft.threadId) {
        void queryClient.invalidateQueries({ queryKey: ["threads", draft.threadId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["threads"] });

      closeComposer();
      return res;
    } catch (err) {
      console.error("[composer] failed to send message:", err);
      const msg = err instanceof Error ? err.message : "Failed to send message";
      setSendError(msg);
      return null;
    } finally {
      setIsSending(false);
    }
  }, [draft, closeComposer]);

  return (
    <ComposerContext.Provider
      value={{
        isOpen,
        isMinimized,
        isMaximized,
        mode,
        draft,
        isSending,
        sendError,
        openComposer,
        closeComposer,
        toggleMinimize,
        toggleMaximize,
        setMode,
        updateDraft,
        clearDraft,
        sendMessage,
        hasContent,
      }}
    >
      {children}
    </ComposerContext.Provider>
  );
}

export function useComposer() {
  const ctx = useContext(ComposerContext);
  if (!ctx) {
    throw new Error("useComposer must be used within ComposerProvider");
  }
  return ctx;
}
