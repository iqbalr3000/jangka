/** Admin pages, for the admin sidebar and the command palette. */
export const adminLinks = [
  { to: "/admin/users", label: "Users & invites" },
  { to: "/admin/groups", label: "Groups" },
  { to: "/admin/permissions", label: "Permissions" },
  { to: "/admin/templates", label: "Templates" },
  { to: "/admin/llm", label: "LLM providers" },
  { to: "/admin/auth", label: "Authentication" },
  { to: "/admin/audit", label: "Audit log" },
] as const;
