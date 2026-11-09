import { createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { queryClient } from "@/lib/data";
import { resetLivePreviewWorkspace } from "@/hooks/use-preview-workspace";

export function getRouter() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Hovering any <Link> runs the target route's loader: data is warm before the click.
    defaultPreload: "intent",
    defaultPreloadDelay: 30,
    // TanStack Query/DB own caching; let loaders always run (they're cache-aware).
    defaultPreloadStaleTime: 0,
    scrollRestoration: false,
  });

  if (typeof window !== "undefined" && router.history) {
    let previousPath = window.location.pathname;
    router.history.subscribe((e) => {
      const nextPath = e.location.pathname;
      if (previousPath.startsWith("/chat") && nextPath.startsWith("/mail/INBOX")) {
        resetLivePreviewWorkspace();
      }
      previousPath = nextPath;
    });
  }

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
