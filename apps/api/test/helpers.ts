import { randomBytes } from "node:crypto";
import { createDb, type Database, groupMembers, groups, users } from "@jangka/db";
import { requireTestDatabaseUrl } from "@jangka/db/testing";
import type { ProviderFactory } from "@jangka/llm";
import { hashPassword } from "@jangka/shared/crypto";
import type { JobQueue } from "@jangka/worker/jobs";
import { eq } from "drizzle-orm";
import pg from "pg";
import pino from "pino";
import { createApp } from "../src/app";
import { RateLimiter } from "../src/lib/rate-limit";
import type { Logger } from "../src/logger";
import { createPersonalCollection } from "../src/services/access";
import type { DiagramChecker } from "../src/services/diagrams";
import { ensureSetupToken, SetupState } from "../src/services/setup";
import { ensureBuiltinTemplates } from "../src/services/templates";

export const silentLogger = pino({ level: "silent" });
export const PUBLIC_URL = "http://jangka.test";
export const ORIGIN = PUBLIC_URL;

/** Pool pointing at a closed port: every query fails fast. */
export function unreachablePool(): pg.Pool {
  return new pg.Pool({
    connectionString: "postgres://x:x@127.0.0.1:1/x",
    connectionTimeoutMillis: 500,
  });
}

export function testDatabase() {
  return createDb(requireTestDatabaseUrl());
}

export const TEST_MASTER_KEY = randomBytes(32);

/** Records sent jobs instead of queueing them (no worker runs in api tests). */
export class RecordingQueue implements JobQueue {
  readonly sent: { name: string; payload: unknown }[] = [];

  async send(name: string, payload: unknown): Promise<void> {
    this.sent.push({ name, payload });
  }
}

/** Default for api tests: no verdict, so LLM diagrams are kept as written. */
export const noDiagramVerdict: DiagramChecker = { check: async () => null };

export function buildApp(
  db: Database,
  pool: pg.Pool,
  options: {
    logger?: Logger;
    llm?: ProviderFactory;
    enableFakeLlm?: boolean;
    forcePasswordLogin?: boolean;
    queue?: JobQueue;
    diagrams?: DiagramChecker;
  } = {},
) {
  const setupState = new SetupState(db);
  const queue = options.queue ?? new RecordingQueue();
  const app = createApp({
    db,
    pool,
    logger: options.logger ?? silentLogger,
    llm: options.llm,
    queue,
    diagrams: options.diagrams ?? noDiagramVerdict,
    config: {
      publicUrl: PUBLIC_URL,
      sessionTtlDays: 30,
      masterKey: TEST_MASTER_KEY,
      enableFakeLlm: options.enableFakeLlm ?? true,
      forcePasswordLogin: options.forcePasswordLogin ?? false,
    },
    setupState,
    loginLimiter: new RateLimiter(10, 15 * 60_000),
  });
  return { app, setupState, queue };
}

export type TestApp = ReturnType<typeof buildApp>["app"];

type RequestOptions = { cookie?: string | null; origin?: string | null; body?: unknown };

export function call(app: TestApp, method: string, path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.origin = origin;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return app.request(`/api/v1${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** `jangka_session=<token>` from a response, or null when the response cleared/didn't set it. */
export function sessionCookie(res: Response): string | null {
  for (const header of res.headers.getSetCookie()) {
    const match = /^jangka_session=([^;]*)/.exec(header);
    if (match) return match[1] ? `jangka_session=${match[1]}` : null;
  }
  return null;
}

export async function captureSetupToken(db: Database): Promise<string> {
  let output = "";
  await ensureSetupToken(db, (text) => {
    output += text;
  });
  const match = /SETUP TOKEN: (\S+)/.exec(output);
  if (!match?.[1]) throw new Error("setup token was not printed");
  return match[1];
}

export const ADMIN = { name: "Ada Admin", email: "ada@acme.co", password: "admin-password-123" };

/** Runs the real setup flow and returns the admin's session cookie. */
export async function setupInstance(app: TestApp, db: Database): Promise<string> {
  // Boot seeds templates; tests truncate every table, so seed again.
  await ensureBuiltinTemplates(db);
  const token = await captureSetupToken(db);
  const res = await call(app, "POST", "/setup", {
    body: {
      token,
      orgName: "Acme",
      adminName: ADMIN.name,
      adminEmail: ADMIN.email,
      password: ADMIN.password,
    },
  });
  const cookie = sessionCookie(res);
  if (res.status !== 201 || !cookie) throw new Error(`setup failed: ${res.status}`);
  return cookie;
}

export async function createUser(
  db: Database,
  input: { name: string; email: string; password: string; admin?: boolean; isActive?: boolean },
): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      isActive: input.isActive ?? true,
    })
    .returning({ id: users.id });
  if (!user) throw new Error("user not created");
  await createPersonalCollection(db, { id: user.id, name: input.name });
  if (input.admin) {
    const [admins] = await db.select().from(groups).where(eq(groups.systemKey, "admins"));
    if (!admins) throw new Error("admins group missing — run setupInstance first");
    await db.insert(groupMembers).values({ groupId: admins.id, userId: user.id });
  }
  return user.id;
}

export async function login(app: TestApp, email: string, password: string): Promise<string> {
  const res = await call(app, "POST", "/auth/login", { body: { email, password } });
  const cookie = sessionCookie(res);
  if (res.status !== 200 || !cookie) throw new Error(`login failed: ${res.status}`);
  return cookie;
}
