import {
  mentionableList,
  type NotificationView,
  notificationList,
  unreadCount,
} from "@jangka/shared/notifications";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { statusLabels } from "./review";

export const notificationsKey = ["notifications"] as const;

/** Polled for the bell; the list query refreshes it too. */
export const unreadCountQuery = queryOptions({
  queryKey: [...notificationsKey, "unread"],
  queryFn: () => apiFetch("/notifications/unread-count", { schema: unreadCount }),
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
});

export const notificationListQuery = infiniteQueryOptions({
  queryKey: [...notificationsKey, "list"],
  queryFn: ({ pageParam }) =>
    apiFetch(`/notifications${pageParam ? `?cursor=${pageParam}` : ""}`, {
      schema: notificationList,
    }),
  initialPageParam: "",
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});

export const mentionableQuery = (documentId: string, q: string) =>
  queryOptions({
    queryKey: ["documents", documentId, "mentionable", q],
    queryFn: () =>
      apiFetch(`/documents/${documentId}/mentionable?q=${encodeURIComponent(q)}`, {
        schema: mentionableList,
      }),
    staleTime: 30_000,
  });

/** "Ada mentioned you", "Ada moved it to In review". */
export function notificationAction(n: NotificationView): string {
  const who = n.actor?.name ?? "Someone";
  switch (n.kind) {
    case "mention":
      return `${who} mentioned you`;
    case "reply":
      return `${who} replied`;
    case "resolved":
      return `${who} resolved your comment`;
    case "status":
      return `${who} moved it to ${n.status ? statusLabels[n.status] : "another status"}`;
  }
}

export const badgeCount = (count: number) => (count > 99 ? "99+" : String(count));
