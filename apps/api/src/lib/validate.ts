import { AppError } from "@jangka/shared/errors";
import type { ValidationTargets } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";

/** Validates a request part with Zod; failures become `400 validation_failed`. */
export function zValidate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return validator(target, (value): z.output<Schema> => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new AppError(
        "validation_failed",
        400,
        "Invalid request",
        result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      );
    }
    return result.data;
  });
}
