import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (!context.me.user.isAdmin) throw redirect({ to: "/" });
  },
  component: Outlet,
});
