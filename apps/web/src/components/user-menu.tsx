import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { z } from "zod";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { type Theme, themes, useTheme } from "@/lib/theme";
import type { ShellUser } from "./shell-types";

const themeLabels: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ user }: { user?: ShellUser }) {
  const [theme, setTheme] = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    try {
      await apiFetch("/auth/logout", { method: "POST", schema: z.undefined() });
    } finally {
      // Even if the request failed, drop cached data so the next screen reflects a signed-out state.
      queryClient.clear();
      await navigate({ to: "/login" });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-1.5 rounded-sm py-0.5 pr-1.5 pl-0.5 hover:bg-secondary data-[state=open]:bg-secondary"
        aria-label="Account menu"
      >
        <span className="flex size-7 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-semibold">
          {user ? initials(user.name) : "?"}
        </span>
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60 p-1.5 text-[13px]">
        {user && (
          <>
            <DropdownMenuLabel className="flex flex-col px-2.5 pt-2 pb-2.5 leading-snug font-normal">
              <span className="font-semibold">{user.name}</span>
              <span className="text-xs text-muted-foreground">
                {user.email}
                {user.isAdmin && " · Admin"}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="px-2.5 py-[7px] text-[13px]">
            Theme
            <span className="ml-auto text-xs text-muted-foreground">{themeLabels[theme]}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="text-[13px]">
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                const next = themes.find((option) => option === value);
                if (next) setTheme(next);
              }}
            >
              {themes.map((option) => (
                <DropdownMenuRadioItem key={option} value={option} className="text-[13px]">
                  {themeLabels[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {user?.isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              asChild
              className="px-2.5 py-[7px] text-[13px] font-medium text-primary focus:text-primary"
            >
              <Link to="/admin/users">
                <span
                  className="mx-px size-[9px] shrink-0 rotate-45 border-[1.5px] border-primary"
                  aria-hidden
                />
                Admin panel
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {user && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="px-2.5 py-[7px] text-[13px] text-muted-foreground"
              onSelect={() => void signOut()}
            >
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
