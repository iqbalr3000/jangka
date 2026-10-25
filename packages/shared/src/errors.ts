import { z } from "zod";

export const errorCodes = [
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "db_unavailable",
  "internal",
  "setup_required",
  "setup_completed",
  "invalid_setup_token",
  "invalid_credentials",
  "rate_limited",
  "invite_invalid",
  "llm_error",
  "revision_conflict",
  "llm_not_configured",
  "generation_in_progress",
  "coverage_incomplete",
  "export_not_ready",
  "export_expired",
  "invalid_source",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Code is a plain string so older clients still parse codes added later. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
