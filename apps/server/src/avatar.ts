import { createHash } from "node:crypto";
import { z } from "zod";
import type { AvatarPhotos, AvatarRequest } from "@mailfast/shared";

const personSchema = z.object({
  emailAddresses: z.array(z.object({ value: z.string() })).optional(),
  photos: z
    .array(
      z.object({
        url: z.url().startsWith("https://"),
        default: z.boolean().optional(),
        metadata: z.object({ source: z.object({ type: z.string().optional() }).optional() }).optional(),
      }),
    )
    .optional(),
});
const searchSchema = z.object({ results: z.array(z.object({ person: personSchema })).optional() });

function profilePhoto(person: z.infer<typeof personSchema>): string | null {
  const photos = person.photos?.filter((photo) => !photo.default) ?? [];
  return (photos.find((photo) => photo.metadata?.source?.type === "PROFILE") ?? photos[0])?.url ?? null;
}

/** Each account keeps its own People search warmup; photos never cross account boundaries. */
export class GooglePhotos {
  private warmupToken: string | null = null;
  private warmup: Promise<boolean> | null = null;

  constructor(private readonly getToken: () => Promise<string>) {}

  private fetch(path: string, token: string) {
    return fetch(`https://people.googleapis.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  }

  async lookup({ email, googleUserId }: AvatarRequest): Promise<AvatarPhotos> {
    const gravatar = email
      ? `https://www.gravatar.com/avatar/${createHash("sha256").update(email).digest("hex")}?s=80&d=404`
      : null;
    try {
      const token = await this.getToken();
      if (googleUserId) {
        const res = await this.fetch(`people/${googleUserId.slice("users/".length)}?personFields=photos`, token);
        if (res.ok) {
          const person = personSchema.safeParse(await res.json());
          const google = person.success ? profilePhoto(person.data) : null;
          if (google) return { google, gravatar };
        }
      }
      if (email) {
        const params = new URLSearchParams({ readMask: "emailAddresses,photos", pageSize: "30", query: "" });
        params.append("sources", "READ_SOURCE_TYPE_CONTACT");
        params.append("sources", "READ_SOURCE_TYPE_PROFILE");
        // People search requires an empty-query warmup before the first real search.
        if (this.warmupToken !== token || !this.warmup) {
          this.warmupToken = token;
          this.warmup = this.fetch(`people:searchContacts?${params.toString()}`, token).then((res) => res.ok);
        }
        if (await this.warmup) {
          params.set("query", email);
          const res = await this.fetch(`people:searchContacts?${params.toString()}`, token);
          if (res.ok) {
            const data = searchSchema.safeParse(await res.json());
            const person = data.success
              ? data.data.results?.find(({ person }) =>
                  person.emailAddresses?.some(({ value }) => value.trim().toLowerCase() === email),
                )?.person
              : undefined;
            if (person) return { google: profilePhoto(person), gravatar };
          }
        }
      }
    } catch {
      // Missing permission, offline accounts and unavailable People API still allow public avatars.
      this.warmup = null;
    }
    return { google: null, gravatar };
  }
}
