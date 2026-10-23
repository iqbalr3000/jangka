// Filled from the session once `auth` lands; the shell renders without them until then.
export type ShellUser = { name: string; email: string; isAdmin: boolean };
export type ShellOrg = { name: string; host: string };
