import type { ListThreadsParams, ListThreadsResponse } from "@mailfast/shared";
import type { AccountRuntime } from "@/accounts.ts";

/** Local reads return immediately; ensureLabel fills missing windows over SSE. */
export function listThreadsResponse(url: URL, { store, sync }: AccountRuntime): Response {
  const params: ListThreadsParams = { label: url.searchParams.get("label") ?? "INBOX" };
  for (const name of ["limit", "after", "before"] as const) {
    const value = url.searchParams.get(name);
    if (value === null) continue;
    const parsed = Number(value);
    if (!value.trim() || !Number.isSafeInteger(parsed) || (name === "limit" && parsed < 1)) {
      return Response.json({ error: `Invalid ${name}` }, { status: 400 });
    }
    params[name] = parsed;
  }
  const label = params.label ?? "INBOX";
  const limit = Math.min(params.limit ?? 100, 1000);
  const { after, before } = params;
  const threads = store.listThreads(label, before ?? Number.MAX_SAFE_INTEGER, limit + 1, after);
  const total = store.countThreads(label, { after, before });
  void sync.ensureLabel(label, { after, before, limit });
  return Response.json(
    { threads: threads.slice(0, limit), hasMore: threads.length > limit, total } satisfies ListThreadsResponse,
    { headers: { "cache-control": "no-store" } },
  );
}
