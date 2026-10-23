import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="blueprint-grid flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-base font-medium">No documents yet.</p>
      <p className="text-sm text-muted-foreground">
        Precise specs for product & engineering teams.
      </p>
    </div>
  );
}
