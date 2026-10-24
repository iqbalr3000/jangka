import { z } from "zod";
import { LLMError } from "./errors";
import type { ChatRequest, JsonSchema, ObjectAttempt } from "./types";

const MAX_RETRIES = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as JsonSchema;
  return rest;
}

/**
 * Validates each attempt with Zod; on failure retries up to 2 times with the validation
 * error appended, then gives up with `invalid_output` (hard rule #5).
 */
export async function generateWithRetry<T>(
  attempt: ObjectAttempt,
  req: ChatRequest,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const jsonSchema = jsonSchemaOf(schema);
  let messages = req.messages;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    const raw = await attempt({ ...req, messages }, jsonSchema, signal);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    messages = [
      ...messages,
      { role: "assistant", content: typeof raw === "string" ? raw : JSON.stringify(raw) },
      {
        role: "user",
        content: `That output does not match the required schema:\n${z.prettifyError(parsed.error)}\nReply again with corrected output only.`,
      },
    ];
  }
  throw new LLMError("invalid_output");
}

/** Parsed JSON, or the text itself when it isn't JSON (so validation fails and retries). */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** First balanced `{…}` in free text (models without native structured output). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return parseJson(text.slice(start, i + 1));
  }
  return text;
}

/**
 * OpenAI strict mode: every property required, optional ones made nullable,
 * `additionalProperties: false` on every object.
 */
export function toOpenAIStrict(schema: JsonSchema): JsonSchema {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = visit(value);
    if (out.type === "object" && isRecord(out.properties)) {
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(out.properties)) {
        properties[key] = required.has(key) ? value : { anyOf: [value, { type: "null" }] };
      }
      out.properties = properties;
      out.required = Object.keys(properties);
      out.additionalProperties = false;
    }
    return out;
  };
  return visit(schema) as JsonSchema;
}

/** Undoes `toOpenAIStrict` on the output: drops nulls the original schema had as optional. */
export function stripNullOptionals(value: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(value)) {
    return isRecord(schema.items)
      ? value.map((v) => stripNullOptionals(v, schema.items as JsonSchema))
      : value;
  }
  if (!isRecord(value) || !isRecord(schema.properties)) return value;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null && !required.has(key)) continue;
    const child = schema.properties[key];
    out[key] = isRecord(child) ? stripNullOptionals(v, child) : v;
  }
  return out;
}

const GEMINI_UNSUPPORTED = new Set(["$schema", "$id", "additionalProperties", "pattern"]);

/** Gemini's JSON-schema subset: drop keywords it rejects. */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!GEMINI_UNSUPPORTED.has(key)) out[key] = visit(value);
    }
    return out;
  };
  return visit(schema) as JsonSchema;
}

/** For providers without native structured output: the schema goes into the prompt. */
export function schemaInstruction(schema: JsonSchema): string {
  return `Respond with a single JSON object only, no prose, matching this JSON Schema:\n${JSON.stringify(schema)}`;
}
