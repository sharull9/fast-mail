import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: ({ location }) => {
    throw redirect({ to: "/mail/$labelId", params: { labelId: "INBOX" }, hash: location.hash });
  },
});
