import { requireTestDatabaseUrl } from "@jangka/db/testing";

/**
 * Its own database next to TEST_DATABASE_URL: vitest runs projects in parallel, and the api
 * project truncates the shared one between tests.
 */
export function workerTestDatabaseUrl(): string {
  const url = new URL(requireTestDatabaseUrl());
  url.pathname = "/jangka_worker_test";
  return url.toString();
}
