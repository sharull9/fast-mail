import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ThreadView } from "@/components/thread-view";
import { connectionQuery, queryClient, threadQuery } from "@/lib/data";

export const Route = createFileRoute("/mail/$labelId/$threadId")({
  loader: async ({ params }) => {
    const connection = await queryClient.ensureQueryData(connectionQuery).catch(() => undefined);
    if (connection?.paired) await queryClient.ensureQueryData(threadQuery(params.threadId));
  },
  component: Thread,
});

function Thread() {
  const { labelId, threadId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <ThreadView threadId={threadId} onClose={() => void navigate({ to: "/mail/$labelId", params: { labelId } })} />
  );
}
