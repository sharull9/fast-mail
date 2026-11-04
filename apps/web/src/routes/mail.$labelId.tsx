import { useCallback } from "react";
import { Outlet, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { ThreadList } from "../components/ThreadList";
import { loadMore, threadsCollection } from "../lib/data";
import { labelName } from "../lib/format";

export const Route = createFileRoute("/mail/$labelId")({
  // Runs on hover too (defaultPreload: "intent"), so the mailbox is synced before the click.
  loader: async ({ params }) => {
    await threadsCollection(params.labelId).preload();
  },
  component: Mailbox,
});

function Mailbox() {
  const { labelId } = Route.useParams();
  const threadId = useParams({ strict: false }).threadId as string | undefined;
  const navigate = useNavigate();
  const collection = threadsCollection(labelId);

  const { data: threads, isLoading } = useLiveQuery({
    query: (q) => q.from({ t: collection }).orderBy(({ t }) => t.lastDate, "desc"),
  });

  const open = useCallback(
    (id: string) => void navigate({ to: "/mail/$labelId/$threadId", params: { labelId, threadId: id }, replace: true }),
    [navigate, labelId],
  );
  const close = useCallback(() => void navigate({ to: "/mail/$labelId", params: { labelId } }), [navigate, labelId]);
  const more = useCallback(() => void loadMore(labelId), [labelId]);

  return (
    <div className={`mailbox${threadId ? " with-pane" : ""}`}>
      <section className="list-col">
        <header className="list-head">
          <h2>{labelName(labelId)}</h2>
          <span className="muted">{threads.length.toLocaleString()} conversations</span>
        </header>
        {isLoading ? (
          <div className="empty">Loading…</div>
        ) : (
          <ThreadList
            threads={threads}
            selectedId={threadId}
            onOpen={open}
            onClose={close}
            onEndReached={more}
            empty="Nothing here."
          />
        )}
      </section>
      <Outlet />
    </div>
  );
}
