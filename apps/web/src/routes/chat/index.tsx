import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { chatSpacesQuery } from "@/lib/data";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/chat/")({
  validateSearch: (search: Record<string, unknown>): { space?: string } => ({
    space: typeof search.space === "string" ? search.space : undefined,
  }),
  component: ChatIndexRoute,
});

function ChatIndexRoute() {
  const { space: legacySpace } = Route.useSearch();
  const navigate = useNavigate();
  const { data: spacesData, isLoading } = useQuery(chatSpacesQuery());
  const spaces = spacesData?.spaces ?? [];

  useEffect(() => {
    if (spaces.length === 0) return;

    if (legacySpace) {
      const match = spaces.find(
        (s) =>
          s.id === legacySpace ||
          s.id === `spaces/${legacySpace}` ||
          s.id.replace(/^spaces\//, "") === legacySpace.replace(/^spaces\//, ""),
      );
      if (match) {
        const cleanId = match.id.replace(/^spaces\//, "");
        const to = match.type === "DIRECT_MESSAGE" ? "/chat/direct/$id" : "/chat/spaces/$id";
        void navigate({ to, params: { id: cleanId }, replace: true });
        return;
      }
    }

    const first = spaces[0];
    if (first) {
      const cleanId = first.id.replace(/^spaces\//, "");
      const to = first.type === "DIRECT_MESSAGE" ? "/chat/direct/$id" : "/chat/spaces/$id";
      void navigate({ to, params: { id: cleanId }, replace: true });
    }
  }, [spaces, legacySpace, navigate]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-6" aria-busy="true">
        <Skeleton className="size-12 rounded-2xl" />
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="mx-auto h-4 w-44" />
          <Skeleton className="mx-auto h-3 w-64 max-w-full" />
          <Skeleton className="mx-auto h-3 w-52 max-w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground p-6">
      <div className="rounded-2xl border border-border bg-muted/30 p-6">
        <MessageSquare className="size-10 text-primary/70" />
      </div>
      <h2 className="text-base font-semibold text-foreground">No conversation selected</h2>
      <p className="max-w-xs text-xs text-muted-foreground">
        Select a conversation from the list or start a new chat with a contact or space.
      </p>
    </div>
  );
}
