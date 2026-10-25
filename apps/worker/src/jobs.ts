import { PgBoss } from "pg-boss";
import { z } from "zod";

/** Job names and payloads, shared by the api (sends) and the worker (works). */
export const JOBS = {
  diagramRender: "diagram.render",
  exportRun: "export.run",
  exportCleanup: "export.cleanup",
} as const;

export const diagramRenderPayload = z.object({ source: z.string().min(1) });
export const exportRunPayload = z.object({ exportId: z.uuid() });

type Payloads = {
  [JOBS.diagramRender]: z.infer<typeof diagramRenderPayload>;
  [JOBS.exportRun]: z.infer<typeof exportRunPayload>;
};

/** What the api needs from the queue; tests substitute a recorder. */
export interface JobQueue {
  send<Name extends keyof Payloads>(name: Name, payload: Payloads[Name]): Promise<void>;
}

/** Transient Chromium/DB failures get one more try; the export is marked failed after that. */
export const EXPORT_RETRY_LIMIT = 1;

export async function startQueue(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss", max: 4 });
  await boss.start();
  await boss.createQueue(JOBS.diagramRender, { retryLimit: 0, expireInSeconds: 60 });
  await boss.createQueue(JOBS.exportRun, {
    retryLimit: EXPORT_RETRY_LIMIT,
    retryDelay: 5,
    expireInSeconds: 300,
  });
  await boss.createQueue(JOBS.exportCleanup, { retryLimit: 0 });
  return boss;
}

export function bossQueue(boss: PgBoss): JobQueue {
  return {
    async send(name, payload) {
      await boss.send(name, payload);
    },
  };
}
