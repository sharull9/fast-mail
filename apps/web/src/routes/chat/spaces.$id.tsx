import { createFileRoute } from "@tanstack/react-router";
import { ConversationView } from "@/components/chat/conversation-view";

export const Route = createFileRoute("/chat/spaces/$id")({
  component: ChatSpaceRoute,
});

function ChatSpaceRoute() {
  const { id } = Route.useParams();
  return <ConversationView spaceId={id} spaceType="SPACE" />;
}
