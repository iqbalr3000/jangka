import { errorResponseSchema } from "@jangka/shared/errors";
import type { z } from "zod";
import { reportRequest } from "./connection";

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
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: "include",
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (!init.signal?.aborted) reportRequest(false);
    throw error;
  }

  const payload: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  const parsed = res.ok ? null : errorResponseSchema.safeParse(payload);
  // The API always answers in its error shape, so a 5xx without it came from a proxy: the app is down.
  const serverDown =
    parsed !== null &&
    (parsed.success ? parsed.data.error.code === "db_unavailable" : res.status >= 500);
  reportRequest(!serverDown);

  if (parsed) {
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, res.status, message, details);
    }
    throw new ApiError("internal", res.status, `Request failed with status ${res.status}`);
  }

  return schema.parse(payload);
}
