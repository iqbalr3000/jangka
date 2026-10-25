import {
  KeyRound,
  LayoutTemplate,
  type LucideIcon,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";

/** Admin pages, for the admin sidebar and the command palette. */
export const adminLinks: readonly { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/admin/users", label: "Users & invites", icon: Users },
  { to: "/admin/groups", label: "Groups", icon: UsersRound },
  { to: "/admin/permissions", label: "Permissions", icon: ShieldCheck },
  { to: "/admin/templates", label: "Templates", icon: LayoutTemplate },
  { to: "/admin/llm", label: "LLM providers", icon: Sparkles },
  { to: "/admin/auth", label: "Authentication", icon: KeyRound },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
];
