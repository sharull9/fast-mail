import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function MailAvatar({ name, email, className }: { name: string; email: string; className?: string }) {
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
      <AvatarFallback
        className="text-[10px] font-medium"
        style={{ backgroundColor: `hsl(${hue} 25% 23%)`, color: `hsl(${hue} 55% 83%)` }}
      >
        {initials || "?"}
      </AvatarFallback>
    </Avatar>
  );
}
