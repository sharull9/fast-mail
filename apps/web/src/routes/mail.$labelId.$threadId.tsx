import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ThreadView } from "../components/ThreadView";
import { queryClient, threadQuery } from "../lib/data";

export const Route = createFileRoute("/mail/$labelId/$threadId")({
  loader: ({ params }) => queryClient.ensureQueryData(threadQuery(params.threadId)),
  component: Thread,
});

function Thread() {
  const { labelId, threadId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <ThreadView threadId={threadId} onClose={() => void navigate({ to: "/mail/$labelId", params: { labelId } })} />
  );
}
