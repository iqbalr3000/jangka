export const llmErrorCodes = [
  "auth",
  "rate_limit",
  "context_length",
  "invalid_output",
  "invalid_request",
  "provider_down",
  "aborted",
] as const;
export type LLMErrorCode = (typeof llmErrorCodes)[number];

function normalizedMessage(code: LLMErrorCode, retryAfterSeconds?: number): string {
  switch (code) {
    case "auth":
      return "Key rejected by provider";
    case "rate_limit":
      return retryAfterSeconds
        ? `Rate limited, try again in ${retryAfterSeconds}s`
        : "Rate limited, try again shortly";
    case "context_length":
      return "The request is too long for this model";
    case "invalid_output":
      return "The model returned output in an unexpected format";
    case "invalid_request":
      return "The provider rejected the request";
    case "provider_down":
      return "The provider is unreachable or returned an error";
    case "aborted":
      return "Request cancelled";
  }
}

/**
 * The message is always our normalized copy: provider messages can echo key fragments,
 * so they are only used for classification and never kept.
 */
export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: LLMErrorCode, retryAfterSeconds?: number) {
    super(normalizedMessage(code, retryAfterSeconds));
    this.name = "LLMError";
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const CONTEXT_HINT = /context|too long|maximum.*tokens|token limit|too many tokens/i;

function retryAfter(headers: Headers | undefined): number | undefined {
  const value = headers?.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/** Maps an HTTP outcome to an `LLMError`; `status` undefined = no response (network/timeout). */
export function fromHttp(
  status: number | undefined,
  providerMessage: string,
  headers?: Headers,
): LLMError {
  if (status === undefined || status >= 500) return new LLMError("provider_down");
  if (status === 401 || status === 403) return new LLMError("auth");
  if (status === 429) return new LLMError("rate_limit", retryAfter(headers));
  if (status === 400 && CONTEXT_HINT.test(providerMessage)) return new LLMError("context_length");
  return new LLMError("invalid_request");
}

/** Aborts win over whatever error the SDK raised while cancelling. */
export function toLLMError(
  error: unknown,
  signal: AbortSignal | undefined,
  classify: (error: unknown) => LLMError | undefined,
): LLMError {
  if (signal?.aborted) return new LLMError("aborted");
  if (error instanceof LLMError) return error;
  return classify(error) ?? new LLMError("provider_down");
}
