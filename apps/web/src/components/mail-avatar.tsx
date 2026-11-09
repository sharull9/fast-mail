import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { avatarRequestSchema } from "@mailfast/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { authQuery } from "@/lib/data";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function MailAvatar({
  name,
  email,
  image,
  googleUserId,
  className,
}: {
  name: string;
  email: string;
  image?: string | null;
  googleUserId?: string;
  className?: string;
}) {
  const auth = useQuery(authQuery).data;
  const normalizedEmail = email.trim().toLowerCase();
  const accountPhoto = auth?.accounts.find((account) => account.email.toLowerCase() === normalizedEmail)?.image;
  const profilePhoto = image || accountPhoto;
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const identity = avatarRequestSchema.safeParse({
    email: normalizedEmail || undefined,
    googleUserId: googleUserId && /^users\/\d+$/.test(googleUserId) ? googleUserId : undefined,
  });
  const { data: photos } = useQuery({
    queryKey: ["avatar", auth?.activeAccountId, normalizedEmail, googleUserId],
    queryFn: () => (identity.success ? api.avatar(identity.data, auth?.activeAccountId) : null),
    enabled: Boolean(auth?.signedIn && identity.success && (!profilePhoto || failedImages.includes(profilePhoto))),
    staleTime: 60 * 60_000,
    retry: false,
  });
  const src = [profilePhoto, photos?.google, photos?.gravatar].find((url) => url && !failedImages.includes(url));
  const hue = Array.from(email).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0);
  const initials = (name || email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <Avatar className={cn("size-7 shrink-0", className)}>
      {src && (
        <AvatarImage
          key={src}
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="object-cover"
          onLoadingStatusChange={(status) => {
            if (status === "error") setFailedImages((failed) => (failed.includes(src) ? failed : [...failed, src]));
          }}
        />
      )}
      <AvatarFallback
        className="text-[10px] font-medium"
        style={{ backgroundColor: `hsl(${hue} 25% 23%)`, color: `hsl(${hue} 55% 83%)` }}
      >
        {initials || "?"}
      </AvatarFallback>
    </Avatar>
  );
}
