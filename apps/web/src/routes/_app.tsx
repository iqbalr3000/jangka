import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { meQuery, setupStatusQuery } from "@/lib/queries";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQuery);
    if (!status.completed) throw redirect({ to: "/setup" });
    try {
      return { me: await context.queryClient.ensureQueryData(meQuery) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: "/login", search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { data: me } = useSuspenseQuery(meQuery);
  const inAdmin = useRouterState({ select: (s) => s.location.pathname.startsWith("/admin") });

  return (
    <AppShell user={me.user} org={me.org} section={inAdmin ? "admin" : "documents"}>
      <Outlet />
    </AppShell>
  );
}
