import { errorResponseSchema } from "@jangka/shared/errors";
import type { z } from "zod";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type ApiFetchInit<Schema extends z.ZodType> = Omit<RequestInit, "body"> & {
  schema: Schema;
  /** Serialized as JSON. */
  body?: unknown;
};

/** Calls `/api/v1{path}`; parses success with `schema` and failures into `ApiError`. */
export async function apiFetch<Schema extends z.ZodType>(
  path: string,
  { schema, body, headers, ...init }: ApiFetchInit<Schema>,
): Promise<z.output<Schema>> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined);

  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, res.status, message, details);
    }
    throw new ApiError("internal", res.status, `Request failed with status ${res.status}`);
  }

  return schema.parse(payload);
}
