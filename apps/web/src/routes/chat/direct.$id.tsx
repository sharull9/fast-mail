import { createFileRoute } from "@tanstack/react-router";
import { ConversationView } from "@/components/chat/conversation-view";

export const Route = createFileRoute("/chat/direct/$id")({
  component: ChatDirectRoute,
});

function ChatDirectRoute() {
  const { id } = Route.useParams();
  return <ConversationView spaceId={id} spaceType="DIRECT_MESSAGE" />;
}
