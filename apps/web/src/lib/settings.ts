import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/data";
import { clearContactCache } from "@/lib/contact-cache";
export const accountSettingsQuery = (accountId: string | null) =>
  queryOptions({
    queryKey: ["account-settings", accountId],
    queryFn: () => api.accountSettings(accountId),
    enabled: Boolean(accountId),
  });
export function invalidateContactSuggestions(accountId: string | null) {
  clearContactCache(accountId);
  void queryClient.invalidateQueries({ queryKey: ["managed-contacts", accountId] });
}
