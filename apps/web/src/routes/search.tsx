import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ThreadList } from "../components/ThreadList";
import { ThreadView } from "../components/ThreadView";
import { searchQuery } from "../lib/data";

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): { q: string; t?: string } => ({
    q: typeof s.q === "string" ? s.q : "",
    t: typeof s.t === "string" ? s.t : undefined,
  }),
  component: Search,
});

function Search() {
  const { q, t } = Route.useSearch();
  const navigate = useNavigate();
  // Local FTS5 over cached metadata; the server also asks Gmail while backfill is still running.
  const { data } = useQuery({ ...searchQuery(q), placeholderData: keepPreviousData });
  const threads = data?.threads ?? [];

  const open = useCallback(
    (id: string) => void navigate({ to: "/search", search: { q, t: id }, replace: true }),
    [navigate, q],
  );
  const close = useCallback(() => void navigate({ to: "/search", search: { q }, replace: true }), [navigate, q]);

  return (
    <div className={`mailbox${t ? " with-pane" : ""}`}>
      <section className="list-col">
        <header className="list-head">
          <h2>Search</h2>
          <span className="muted">
            {threads.length.toLocaleString()} results for “{q}”
          </span>
        </header>
        <ThreadList
          threads={threads}
          selectedId={t}
          onOpen={open}
          onClose={close}
          empty="No matches in cached mail yet."
        />
      </section>
      {t && <ThreadView threadId={t} onClose={close} />}
    </div>
  );
}
