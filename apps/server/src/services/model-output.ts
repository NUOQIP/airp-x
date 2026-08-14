function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tryParseObject(source: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(source);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function unwrapCodeFence(source: string) {
  const match = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? source;
}

function removeLeadingReasoningBlocks(source: string) {
  let remainder = source.trimStart();
  while (/^<think\b[^>]*>/i.test(remainder)) {
    const closing = /<\/think\s*>/i.exec(remainder);
    if (!closing) throw new SyntaxError("Unclosed <think> block in the model response");
    remainder = remainder.slice(closing.index + closing[0].length).trimStart();
  }
  return remainder;
}

/**
 * Accepts a strict JSON response as well as providers that prepend visible
 * <think>...</think> reasoning. Only a complete, unique root JSON object is
 * returned. Markdown fences are accepted, but malformed tags, trailing prose,
 * arrays, scalar values, and multiple root objects are rejected.
 */
export function parseModelJsonObject(raw: string): Record<string, unknown> {
  const source = raw.replace(/^\uFEFF/, "").trim();
  const unfenced = unwrapCodeFence(source);

  const direct = tryParseObject(source) ?? tryParseObject(unfenced);
  if (direct) return direct;

  const withoutReasoning = removeLeadingReasoningBlocks(source);
  const extracted = tryParseObject(withoutReasoning)
    ?? tryParseObject(unwrapCodeFence(withoutReasoning));
  if (extracted) return extracted;

  throw new SyntaxError("No complete JSON object was found in the model response");
}
