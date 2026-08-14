const OMIT_CONTEXT_VALUE = Symbol("omit-context-value");

function isDataUrl(value: string) {
  return /^\s*data:[^,\s]*,/i.test(value);
}

function sanitizeValue(value: unknown): unknown | typeof OMIT_CONTEXT_VALUE {
  if (typeof value === "string") return isDataUrl(value) ? OMIT_CONTEXT_VALUE : value;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== OMIT_CONTEXT_VALUE);
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const sanitized = sanitizeValue(child);
    return sanitized === OMIT_CONTEXT_VALUE ? [] : [[key, sanitized]];
  }));
}

/**
 * Removes inline Data URLs from structured state before it is sent to a model.
 * HTTPS/file references and ordinary text are preserved. The input is never mutated.
 */
export function sanitizeContextValue(value: unknown): unknown {
  const sanitized = sanitizeValue(value);
  return sanitized === OMIT_CONTEXT_VALUE ? undefined : sanitized;
}

export function stringifyContextValue(value: unknown): string {
  return JSON.stringify(sanitizeContextValue(value)) ?? "null";
}
