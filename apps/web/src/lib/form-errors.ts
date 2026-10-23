import type { z } from "zod";
import { ApiError } from "./api";

export type FieldErrors = Record<string, string>;

/** First message per top-level field from a failed Zod parse. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    errors[key] ??= issue.message;
  }
  return errors;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Check your connection and try again.";
}
