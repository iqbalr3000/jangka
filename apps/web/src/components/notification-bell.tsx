import type { NotificationKind, NotificationView } from "@jangka/shared/notifications";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  AtSign,
  Bell,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  type LucideIcon,
  Reply,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { timeAgo } from "@/lib/llm";
import {
  badgeCount,
  notificationAction,
  notificationListQuery,
  notificationsKey,
  unreadCountQuery,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

const icons: Record<NotificationKind, LucideIcon> = {
  mention: AtSign,
  reply: Reply,
  resolved: CircleCheck,
  status: ArrowRightLeft,
  review_requested: ClipboardList,
  review_verdict: ClipboardCheck,
};

/** Top-bar bell: unread count (polled) and the notification list. */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = useQuery(unreadCountQuery);
  const list = useInfiniteQuery({ ...notificationListQuery, enabled: open });
  const count = unread.data?.count ?? 0;
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  // The list carries the current count; keep the badge in step with it.
  const listedCount = list.data?.pages[0]?.unreadCount;
  useEffect(() => {
    if (listedCount !== undefined)
      queryClient.setQueryData(unreadCountQuery.queryKey, { count: listedCount });
  }, [listedCount, queryClient]);

  const markRead = useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) =>
      apiFetch("/notifications/read", { method: "POST", body, schema: z.undefined() }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });

  function openNotification(n: NotificationView) {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    setOpen(false);
    void navigate({
      to: "/d/$documentId",
      params: { documentId: n.document.id },
      search:
        n.sectionKey && n.kind !== "status"
          ? { comments: n.sectionKey, thread: n.threadId ?? undefined }
          : {},
    });
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void queryClient.invalidateQueries({ queryKey: notificationListQuery.queryKey });
      }}
    >
      <Popover.Trigger
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        className="relative flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary"
      >
        <Bell className="size-4" aria-hidden />
        {count > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground"
          >
            {badgeCount(count)}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          aria-label="Notifications"
          className="z-50 flex max-h-[min(560px,var(--radix-popover-content-available-height))] w-[380px] max-w-[calc(100vw-32px)] flex-col rounded-md border bg-popover text-[13px] text-popover-foreground shadow-float"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-semibold">Notifications</span>
            <Button
              size="xs"
              variant="ghost"
              disabled={count === 0 || markRead.isPending}
              onClick={() => markRead.mutate({ all: true })}
            >
              Mark all as read
            </Button>
          </div>
          {list.error && (
            <div className="p-3">
              <ErrorBanner>{errorMessage(list.error)}</ErrorBanner>
            </div>
          )}
          <ol className="min-h-0 flex-1 overflow-y-auto">
            {list.isPending && (
              <li className="p-3">
                <LoadingRows />
              </li>
            )}
            {list.data && items.length === 0 && (
              <li className="px-3 py-6 text-center text-muted-foreground">No notifications yet.</li>
            )}
            {items.map((n) => {
              const Icon = icons[n.kind];
              const { action, preposition } = notificationAction(n);
              return (
                <li key={n.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    className={cn(
                      "flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-surface-hover",
                      !n.read && "bg-primary/5",
                    )}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="leading-snug">
                        <span className="font-medium">{action}</span>
                        <span className="text-muted-foreground"> {preposition} </span>
                        <span className="font-medium">{n.document.title}</span>
                        {n.sectionTitle && (
                          <span className="text-muted-foreground"> › {n.sectionTitle}</span>
                        )}
                      </span>
                      {n.excerpt && (
                        <span className="line-clamp-2 text-muted-foreground">{n.excerpt}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.read && (
                      <span
                        role="img"
                        aria-label="Unread"
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                  </button>
                </li>
              );
            })}
            {list.hasNextPage && (
              <li className="p-2 text-center">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  Load more
                </Button>
              </li>
            )}
          </ol>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
