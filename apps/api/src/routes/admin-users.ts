import { invites, sessions, users } from "@jangka/db";
import {
  type AdminUser,
  createInviteRequest,
  type PendingInvite,
  paginationQuery,
  updateUserRequest,
} from "@jangka/shared/auth";
import { AppError } from "@jangka/shared/errors";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/session";
import { zValidate } from "../lib/validate";
import { createLink } from "../services/invites";
import { adminUserIds } from "../services/users";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });

export function adminUserRoutes({ db, config }: RouteDeps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    requireAdmin(c);
    await next();
  });

  return app
    .get("/users", zValidate("query", paginationQuery), async (c) => {
      const { cursor, limit } = c.req.valid("query");
      const rows = await db
        .select()
        .from(users)
        .where(cursor ? gt(users.id, cursor) : undefined)
        .orderBy(asc(users.id))
        .limit(limit + 1);
      const admins = await adminUserIds(db);
      const page = rows.slice(0, limit);
      const items: AdminUser[] = page.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        isAdmin: admins.has(user.id),
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      }));
      const nextCursor = rows.length > limit ? (page.at(-1)?.id ?? null) : null;
      return c.json({ items, nextCursor });
    })
    .patch(
      "/users/:id",
      zValidate("param", idParam),
      zValidate("json", updateUserRequest),
      async (c) => {
        const actor = requireAdmin(c);
        const { id } = c.req.valid("param");
        const { isActive } = c.req.valid("json");
        if (id === actor.user.id && !isActive) {
          throw new AppError("conflict", 409, "You can't deactivate your own account");
        }
        const [user] = await db.update(users).set({ isActive }).where(eq(users.id, id)).returning();
        if (!user) throw new AppError("not_found", 404, "User not found");
        if (!isActive) await db.delete(sessions).where(eq(sessions.userId, id));

        await audit(c, {
          action: isActive ? "user.activate" : "user.deactivate",
          targetType: "user",
          targetId: id,
        });
        return c.json({ id: user.id, isActive: user.isActive });
      },
    )
    .post("/users/:id/reset-link", zValidate("param", idParam), async (c) => {
      const actor = requireAdmin(c);
      const { id } = c.req.valid("param");
      const link = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(users).where(eq(users.id, id));
        if (!user) throw new AppError("not_found", 404, "User not found");
        if (!user.isActive) throw new AppError("conflict", 409, "Reactivate the user first");
        await tx
          .update(invites)
          .set({ expiresAt: new Date() })
          .where(
            and(eq(invites.userId, id), eq(invites.kind, "password_reset"), isNull(invites.usedAt)),
          );
        return createLink(
          tx,
          { kind: "password_reset", email: user.email, userId: id, createdBy: actor.user.id },
          config.publicUrl,
        );
      });
      await audit(c, { action: "user.reset_link", targetType: "user", targetId: id });
      return c.json(link, 201);
    })
    .get("/invites", async (c) => {
      const rows = await db
        .select()
        .from(invites)
        .where(
          and(
            eq(invites.kind, "invite"),
            isNull(invites.usedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .orderBy(asc(invites.createdAt));
      const items: PendingInvite[] = rows.map((invite) => ({
        id: invite.id,
        email: invite.email,
        createdAt: invite.createdAt.toISOString(),
        expiresAt: invite.expiresAt.toISOString(),
      }));
      return c.json({ items });
    })
    .post("/invites", zValidate("json", createInviteRequest), async (c) => {
      const actor = requireAdmin(c);
      const { email } = c.req.valid("json");
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (existing)
        throw new AppError("conflict", 409, "An account with this email already exists");

      const link = await createLink(
        db,
        { kind: "invite", email, userId: null, createdBy: actor.user.id },
        config.publicUrl,
      );
      await audit(c, {
        action: "invite.create",
        targetType: "invite",
        targetId: null,
        metadata: { email },
      });
      return c.json(link, 201);
    })
    .delete("/invites/:id", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const [deleted] = await db
        .delete(invites)
        .where(and(eq(invites.id, id), eq(invites.kind, "invite"), isNull(invites.usedAt)))
        .returning({ id: invites.id });
      if (!deleted) throw new AppError("not_found", 404, "Invite not found");
      await audit(c, { action: "invite.revoke", targetType: "invite", targetId: id });
      return c.body(null, 204);
    });
}
