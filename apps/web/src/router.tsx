import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/data";

export function getRouter() {
  return createRouter({
    routeTree,
    context: { queryClient },
    // Hovering any <Link> runs the target route's loader: data is warm before the click.
    defaultPreload: "intent",
    defaultPreloadDelay: 30,
    // TanStack Query/DB own caching; let loaders always run (they're cache-aware).
    defaultPreloadStaleTime: 0,
    scrollRestoration: false,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
