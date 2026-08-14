import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

type AiOperation = "turn" | "homepage" | "capability";

export type AiTraceInput = {
  operation: AiOperation;
  model: string;
  endpoint: string;
  request: unknown;
  metadata?: Record<string, unknown> | undefined;
  secrets?: string[] | undefined;
};

export type AiTrace = {
  readonly callId: string;
  success(details?: unknown): void;
  failure(error: unknown, details?: unknown): void;
};

export const aiLogDirectory = path.join(config.dataDir, "logs");

const redactedValue = "[REDACTED]";
const redactedSecret = "[REDACTED_SECRET]";
const sensitivePropertyPattern = /^(?:api[_-]?key|authorization|x-api-key|proxy-authorization)$/i;
const sensitiveQueryPattern = /(?:^|[_-])(?:api[_-]?key|key|token|secret|authorization|auth|password|credential|signature|sig|code)(?:$|[_-])/i;
const bearerPattern = /\bBearer\s+[^\s"'`,;()\[\]{}<>]+/gi;
const embeddedDataUrlPattern = /data:([^,\s"'<>]*),([^"'<>\r\n]*)/gi;
const warningIntervalMs = 60_000;

let writeQueue: Promise<void> = Promise.resolve();
let lastWarningAt = Number.NEGATIVE_INFINITY;

function dataUrlMarker(value: string, metadata: string) {
  const mimeMatch = /^([A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+)/.exec(metadata);
  return `[REDACTED_DATA_URL mime=${mimeMatch?.[1]?.toLowerCase() ?? "text/plain"} chars=${value.length}]`;
}

function redactDataUrls(value: string) {
  const wholeMatch = /^data:([^,]*),(.*)$/is.exec(value);
  if (wholeMatch) return dataUrlMarker(value, wholeMatch[1] ?? "");
  return value.replace(embeddedDataUrlPattern, (match, metadata: string) => dataUrlMarker(match, metadata));
}

function redactQuerySecrets(value: string) {
  const queryRedacted = value.replace(/([?&])([^=?&#\s]+)=([^&#\s]*)/g, (match, separator: string, rawKey: string) => {
    let key = rawKey;
    try { key = decodeURIComponent(rawKey); } catch { /* Keep the raw key. */ }
    return sensitiveQueryPattern.test(key) ? `${separator}${rawKey}=${redactedValue}` : match;
  });
  try {
    const parsed = new URL(queryRedacted);
    if (!parsed.username && !parsed.password) return queryRedacted;
    parsed.username = redactedValue;
    parsed.password = redactedValue;
    return parsed.toString();
  } catch {
    return queryRedacted;
  }
}

function redactString(value: string, secrets: readonly string[]) {
  let result = redactDataUrls(value);
  result = result.replace(bearerPattern, "Bearer [REDACTED]");
  result = redactQuerySecrets(result);
  for (const secret of secrets) result = result.split(secret).join(redactedSecret);
  return result;
}

function errorProperties(error: Error) {
  const result: Record<string, unknown> = Object.assign(Object.create(null) as Record<string, unknown>, {
    name: error.name,
    message: error.message
  });
  if (error.stack !== undefined) result.stack = error.stack;
  if (error.cause !== undefined) result.cause = error.cause;

  for (const key of Object.getOwnPropertyNames(error)) {
    if (key in result) continue;
    try { result[key] = (error as unknown as Record<string, unknown>)[key]; } catch { result[key] = "[Unserializable property]"; }
  }

  const possibleZodError = error as Error & { issues?: unknown; errors?: unknown };
  if (possibleZodError.issues !== undefined) result.issues = possibleZodError.issues;
  else if (possibleZodError.errors !== undefined) result.issues = possibleZodError.errors;
  return result;
}

/**
 * Produces a JSON-safe copy for disk logging. It deliberately does not truncate
 * strings or arrays: the JSONL file is the diagnostic source of truth.
 */
export function sanitizeAiLogValue(value: unknown, secrets: readonly string[] = []): unknown {
  const usableSecrets = [...new Set(secrets.filter((secret) => typeof secret === "string" && secret.length > 0))]
    .sort((left, right) => right.length - left.length);
  const ancestors = new WeakSet<object>();

  const visit = (input: unknown, propertyName?: string): unknown => {
    if (propertyName && sensitivePropertyPattern.test(propertyName)) return redactedValue;
    if (typeof input === "string") return redactString(input, usableSecrets);
    if (input === null || typeof input === "number" || typeof input === "boolean") return input;
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "undefined") return "[undefined]";
    if (typeof input === "symbol" || typeof input === "function") return redactString(String(input), usableSecrets);
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? "Invalid Date" : input.toISOString();

    if (typeof input !== "object") return String(input);
    if (ancestors.has(input)) return "[Circular]";
    ancestors.add(input);
    try {
      const source = input instanceof Error ? errorProperties(input) : input;
      if (Array.isArray(source)) return source.map((item) => visit(item));

      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(source)) {
        try {
          result[key] = visit((source as Record<string, unknown>)[key], key);
        } catch {
          result[key] = "[Unserializable property]";
        }
      }
      return result;
    } finally {
      ancestors.delete(input);
    }
  };

  return visit(value);
}

function warnAboutLoggingFailure(error: unknown, secrets: readonly string[] = []) {
  const now = Date.now();
  if (now - lastWarningAt < warningIntervalMs) return;
  lastWarningAt = now;
  try {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[AI log] write failed; AI execution is unaffected: ${redactString(message, secrets).replace(/\s+/g, " ")}`);
  } catch { /* Diagnostics must never affect the application. */ }
}

function terminalInfo(message: string) {
  try { console.info(message); } catch { /* Diagnostics must never affect the application. */ }
}

function logFileFor(timestamp: string) {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(timestamp)?.[0] ?? new Date().toISOString().slice(0, 10);
  return path.join(aiLogDirectory, `ai-${date}.jsonl`);
}

function enqueueRecord(record: unknown, timestamp: string, secrets: readonly string[]) {
  let line: string;
  try {
    line = `${JSON.stringify(sanitizeAiLogValue(record, secrets))}\n`;
  } catch (error) {
    warnAboutLoggingFailure(error, secrets);
    return;
  }

  const file = logFileFor(timestamp);
  writeQueue = writeQueue.then(async () => {
    try {
      await fs.mkdir(aiLogDirectory, { recursive: true });
      await fs.appendFile(file, line, "utf8");
    } catch (error) {
      warnAboutLoggingFailure(error, secrets);
    }
  }, (error) => {
    warnAboutLoggingFailure(error, secrets);
  });
}

function stringLength(value: unknown) {
  if (typeof value === "string") return value.length;
  if (!Array.isArray(value)) return undefined;
  let length = 0;
  for (const part of value) {
    if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      length += ((part as { text: string }).text).length;
    }
  }
  return length;
}

function detailRecord(details: unknown) {
  return details && typeof details === "object" && !Array.isArray(details)
    ? details as Record<string, unknown>
    : undefined;
}

function usageSummary(value: unknown) {
  const usage = detailRecord(value);
  if (!usage) return undefined;
  const prompt = usage.prompt_tokens ?? usage.input_tokens;
  const completion = usage.completion_tokens ?? usage.output_tokens;
  const total = usage.total_tokens;
  const parts = [
    typeof prompt === "number" ? `in=${prompt}` : undefined,
    typeof completion === "number" ? `out=${completion}` : undefined,
    typeof total === "number" ? `total=${total}` : undefined
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function successSummary(details: unknown) {
  const record = detailRecord(details);
  if (!record) return "";
  const http = detailRecord(record.http);
  const providerResponse = detailRecord(record.providerResponse);
  const firstChoice = Array.isArray(providerResponse?.choices)
    ? detailRecord(providerResponse.choices[0])
    : undefined;
  const message = detailRecord(record.message) ?? detailRecord(firstChoice?.message);
  const status = record.status ?? record.providerStatus ?? record.statusCode ?? http?.status;
  const usage = usageSummary(record.usage ?? providerResponse?.usage);
  const contentLength = stringLength(record.content ?? message?.content);
  const reasoningLength = stringLength(record.reasoning ?? record.reasoning_content ?? message?.reasoning_content);
  return [
    typeof record.phase === "string" ? `phase=${record.phase}` : undefined,
    status !== undefined ? `status=${String(status)}` : undefined,
    usage,
    contentLength !== undefined ? `content=${contentLength}c` : undefined,
    reasoningLength !== undefined ? `reasoning=${reasoningLength}c` : undefined
  ].filter((part): part is string => Boolean(part)).join(" ");
}

function errorSummary(error: unknown, secrets: readonly string[]) {
  const sanitized = sanitizeAiLogValue(error, secrets);
  const record = detailRecord(sanitized);
  if (!record) return typeof sanitized === "string" ? sanitized.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? "unknown" : "unknown";
  return [record.name, record.code, record.providerStatus]
    .filter((part) => typeof part === "string" || typeof part === "number")
    .map(String)
    .join(":") || "Error";
}

function terminalText(value: string, maxLength = 160) {
  const collapsed = value.replace(/\s+/g, " ");
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 3)}...` : collapsed;
}

function createCallId() {
  try { return randomUUID(); } catch {
    return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

export function startAiTrace(input: AiTraceInput): AiTrace {
  const callId = createCallId();
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const secrets = (input.secrets ?? []).filter((secret) => typeof secret === "string" && secret.length > 0);
  const shortId = callId.slice(0, 8);
  const safeModel = terminalText(redactString(input.model, secrets));
  let completed = false;

  try {
    enqueueRecord({
      event: "ai.request",
      timestamp: startedAtIso,
      callId,
      operation: input.operation,
      model: input.model,
      endpoint: input.endpoint,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      request: input.request
    }, startedAtIso, secrets);
    terminalInfo(`[AI ${shortId}] -> ${input.operation} model=${safeModel}`);
  } catch (error) {
    warnAboutLoggingFailure(error, secrets);
  }

  const finish = (outcome: "success" | "failure", error?: unknown, details?: unknown) => {
    if (completed) return;
    completed = true;
    const finishedAt = new Date();
    const finishedAtIso = finishedAt.toISOString();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    try {
      enqueueRecord({
        event: "ai.result",
        timestamp: finishedAtIso,
        callId,
        operation: input.operation,
        model: input.model,
        endpoint: input.endpoint,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        outcome,
        durationMs,
        ...(details === undefined ? {} : { details }),
        ...(error === undefined ? {} : { error })
      }, finishedAtIso, secrets);
      const detailSummary = successSummary(details);
      const summary = outcome === "success"
        ? detailSummary
        : `${detailSummary}${detailSummary ? " " : ""}error=${errorSummary(error, secrets)}`;
      terminalInfo(`[AI ${shortId}] <- ${outcome} ${durationMs}ms${summary ? ` ${summary}` : ""}`);
    } catch (loggingError) {
      warnAboutLoggingFailure(loggingError, secrets);
    }
  };

  return {
    callId,
    success(details?: unknown) { finish("success", undefined, details); },
    failure(error: unknown, details?: unknown) { finish("failure", error, details); }
  };
}

export async function flushAiLogs(): Promise<void> {
  while (true) {
    const pending = writeQueue;
    try { await pending; } catch (error) { warnAboutLoggingFailure(error); }
    if (pending === writeQueue) return;
  }
}
