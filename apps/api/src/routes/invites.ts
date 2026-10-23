import { users } from "@jangka/db";
import { acceptInviteRequest, type InviteInfo } from "@jangka/shared/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requestMeta } from "../lib/request-meta";
import { startSession } from "../lib/session";
import { zValidate } from "../lib/validate";
import { acceptInvite, findUsableInvite } from "../services/invites";
import { isAdmin, meFor, orgName } from "../services/users";
import type { AppEnv, RouteDeps } from "../types";

const tokenParam = z.object({ token: z.string().min(1).max(100) });

export function inviteRoutes({ db, config }: RouteDeps) {
  return new Hono<AppEnv>()
    .get("/:token", zValidate("param", tokenParam), async (c) => {
      const { invite, userName } = await findUsableInvite(db, c.req.valid("param").token);
      const info: InviteInfo = {
        kind: invite.kind,
        email: invite.email,
        orgName: await orgName(db),
        name: invite.kind === "password_reset" ? userName : null,
      };
      return c.json(info);
    })
    .post(
      "/:token/accept",
      zValidate("param", tokenParam),
      zValidate("json", acceptInviteRequest),
      async (c) => {
        const { userId } = await acceptInvite(db, c.req.valid("param").token, c.req.valid("json"));
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        if (!user) throw new Error("accepted invite user missing");

        await startSession(c, db, userId, config, requestMeta(c));
        await audit(c, { action: "invite.accept", targetType: "user", targetId: userId });
        const sessionUser = {
          id: user.id,
          name: user.name,
          email: user.email,
          isAdmin: await isAdmin(db, user.id),
        };
        return c.json(await meFor(db, sessionUser, config.publicUrl));
      },
    );
}
