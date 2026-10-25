import type { Database } from "@jangka/db";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { cleanup } from "./cleanup";
import { renderDiagram } from "./diagrams";
import { markFailed, runExport } from "./export-job";
import { diagramRenderPayload, EXPORT_RETRY_LIMIT, exportRunPayload, JOBS } from "./jobs";
import { Renderer } from "./renderer";

export { Renderer } from "./renderer";

export type WorkerDeps = { db: Database; boss: PgBoss; logger: Logger };

/** Registers the job handlers on a started queue; returns a stop that closes Chromium. */
export async function startWorker({ db, boss, logger }: WorkerDeps): Promise<() => Promise<void>> {
  const renderer = new Renderer();
  const log = logger.child({ role: "worker" });

  await boss.work(JOBS.diagramRender, { localConcurrency: 4 }, async ([job]) => {
    if (!job) return;
    const { source } = diagramRenderPayload.parse(job.data);
    await renderDiagram(db, renderer, source);
  });

  await boss.work(JOBS.exportRun, { localConcurrency: 2 }, async ([job]) => {
    if (!job) return;
    const { exportId } = exportRunPayload.parse(job.data);
    try {
      await runExport(db, renderer, exportId);
      log.info({ exportId }, "export done");
    } catch (err) {
      log.error({ err, exportId, attempt: job.retryCount }, "export failed");
      if (job.retryCount >= EXPORT_RETRY_LIMIT) await markFailed(db, exportId);
      throw err;
    }
  });

  await boss.work(JOBS.exportCleanup, async () => {
    const removed = await cleanup(db);
    if (removed.exports || removed.renders) log.info(removed, "cleanup");
  });
  await boss.schedule(JOBS.exportCleanup, "0 * * * *");

  log.info("worker started");
  return async () => {
    await renderer.close();
  };
}
