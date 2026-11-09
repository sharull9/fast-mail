import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { avatarRequestSchema } from "@mailfast/shared";
import { GooglePhotos } from "@/avatar.ts";

afterEach(() => mock.restore());

function mockFetch(handler: (url: URL, init?: RequestInit) => Promise<Response>) {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (input: string | URL | Request, init?: RequestInit) =>
        handler(new URL(input instanceof Request ? input.url : input), init),
      { preconnect() {} },
    ),
  );
}

test("contact photos match the exact email and prefer the Google profile over a saved contact photo", async () => {
  const requests: URL[] = [];
  mockFetch(async (url, init) => {
    requests.push(url);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-token");
    if (url.searchParams.get("query") === "") return Response.json({});
    return Response.json({
      results: [
        {
          person: {
            emailAddresses: [{ value: "alice@example.com.evil" }],
            photos: [{ url: "https://photos.example.com/wrong" }],
          },
        },
        {
          person: {
            emailAddresses: [{ value: "Alice@Example.com" }],
            photos: [
              { url: "https://photos.example.com/contact" },
              { url: "https://photos.example.com/profile", metadata: { source: { type: "PROFILE" } } },
            ],
          },
        },
      ],
    });
  });
  const photos = new GooglePhotos(async () => "fixture-token");
  const result = await photos.lookup(avatarRequestSchema.parse({ email: "  ALICE@EXAMPLE.COM " }));
  expect(result.google).toBe("https://photos.example.com/profile");
  expect(result.gravatar).toBe(
    `https://www.gravatar.com/avatar/${createHash("sha256").update("alice@example.com").digest("hex")}?s=80&d=404`,
  );
  await photos.lookup({ email: "bob@example.com" });
  expect(requests.map((url) => url.searchParams.get("query"))).toEqual(["", "alice@example.com", "bob@example.com"]);
  expect(requests[1]?.searchParams.get("readMask")).toBe("emailAddresses,photos");
});

test("Chat user IDs resolve profile photos without requiring an email", async () => {
  const fetch = mockFetch(async () =>
    Response.json({
      photos: [
        { url: "https://photos.example.com/default", default: true },
        { url: "https://photos.example.com/alice" },
      ],
    }),
  );
  const result = await new GooglePhotos(async () => "fixture-token").lookup({ googleUserId: "users/12345" });
  expect(result).toEqual({ google: "https://photos.example.com/alice", gravatar: null });
  expect(fetch.mock.calls[0]?.[0]).toBe("https://people.googleapis.com/v1/people/12345?personFields=photos");
});

test("unavailable profile photos fall back to an email contact lookup", async () => {
  mockFetch(async (url) => {
    if (url.pathname === "/v1/people/12345") return new Response(null, { status: 404 });
    if (url.searchParams.get("query") === "") return Response.json({});
    return Response.json({
      results: [
        {
          person: {
            emailAddresses: [{ value: "alice@example.com" }],
            photos: [{ url: "https://photos.example.com/contact" }],
          },
        },
      ],
    });
  });
  const result = await new GooglePhotos(async () => "fixture-token").lookup({
    googleUserId: "users/12345",
    email: "alice@example.com",
  });
  expect(result.google).toBe("https://photos.example.com/contact");
});

test("missing Google permissions return Gravatar and a refreshed grant retries the warmup", async () => {
  let token = "old-grant";
  const fetch = mockFetch(async (_url, init) =>
    new Headers(init?.headers).get("Authorization") === "Bearer old-grant"
      ? new Response(null, { status: 403 })
      : Response.json({}),
  );
  const photos = new GooglePhotos(async () => token);
  const first = await photos.lookup({ email: "alice@example.com" });
  expect(first.google).toBeNull();
  expect(first.gravatar).toContain("d=404");
  await photos.lookup({ email: "bob@example.com" });
  expect(fetch).toHaveBeenCalledTimes(1);
  token = "new-grant";
  await photos.lookup({ email: "alice@example.com" });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("default Google silhouettes and unmatched email addresses do not replace initials with the wrong photo", async () => {
  mockFetch(async () =>
    Response.json({
      results: [
        {
          person: {
            emailAddresses: [{ value: "alice@example.com" }],
            photos: [{ url: "https://photos.example.com/default", default: true }],
          },
        },
        {
          person: {
            emailAddresses: [{ value: "bob@example.com" }],
            photos: [{ url: "https://photos.example.com/bob" }],
          },
        },
      ],
    }),
  );
  const result = await new GooglePhotos(async () => "fixture-token").lookup({ email: "alice@example.com" });
  expect(result.google).toBeNull();
  expect(result.gravatar).not.toBeNull();
});

test("offline Google accounts still return Gravatar; invalid lookup identities are rejected", async () => {
  const photos = new GooglePhotos(async () => {
    throw new Error("offline");
  });
  expect((await photos.lookup({ email: "alice@example.com" })).gravatar).toContain("d=404");
  expect(avatarRequestSchema.safeParse({}).success).toBe(false);
  expect(avatarRequestSchema.safeParse({ email: "bad" }).success).toBe(false);
  expect(avatarRequestSchema.safeParse({ googleUserId: "users/../../anything" }).success).toBe(false);
});
