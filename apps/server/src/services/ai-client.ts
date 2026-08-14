import {
  AiTurnOutputSchema,
  AvatarTextSchema,
  HomepageDraftSchema,
  type AiTurnOutput,
  type HomepageDraft,
  type RuntimeSettings
} from "@airp/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PromptMessage } from "./context-service.js";
import { startAiTrace } from "./ai-log.js";
import { parseModelJsonObject } from "./model-output.js";

const outputJsonSchema = zodToJsonSchema(AiTurnOutputSchema, {
  name: "airp_turn_output",
  target: "openAi",
  $refStrategy: "root"
});

const homepageJsonSchema = zodToJsonSchema(HomepageDraftSchema, {
  name: "airp_homepage_draft",
  target: "openAi",
  $refStrategy: "root"
});

export class AiConfigurationError extends Error {
  readonly code = "AI_CONFIGURATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export class AiProviderError extends Error {
  readonly code = "AI_PROVIDER_ERROR";

  constructor(public readonly providerStatus: number, message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

function requestHeaders(settings: RuntimeSettings) {
  const apiKey = settings.apiKey;
  if (!apiKey) throw new AiConfigurationError("尚未配置 API Key");
  if (!settings.model.trim()) throw new AiConfigurationError("尚未配置模型名称");
  if (/^Bearer\s/i.test(apiKey)) throw new AiConfigurationError("API Key 不要包含“Bearer ”前缀，只粘贴 Key 本身");
  if (!/^[\x21-\x7E]+$/.test(apiKey)) {
    throw new AiConfigurationError("API Key 含有中文、空格或其他不可用于请求头的字符；请只粘贴服务商提供的英文/数字 Key");
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`
  };
}

type StructuredOutputMode = "json_schema" | "json_object";
type ModelContentPart = { type?: string; text?: string };
type ProviderMessage = {
  content?: string | ModelContentPart[];
  reasoning_content?: string;
  refusal?: string;
};
type ProviderResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    finish_reason?: string;
    message?: ProviderMessage;
  }>;
  usage?: Record<string, unknown>;
};

export type AiTraceMetadata = {
  turnId?: string;
  branchId?: string;
};

export function finalContentText(content: string | ModelContentPart[] | undefined) {
  if (typeof content === "string") return content;
  return content
    ?.filter((item) => item.type === undefined || item.type === "text" || item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("") ?? "";
}

function structuredOutputMode(settings: RuntimeSettings): StructuredOutputMode {
  try {
    const hostname = new URL(settings.apiBaseUrl).hostname.toLocaleLowerCase();
    if (hostname === "api.deepseek.com" || hostname.endsWith(".deepseek.com")) return "json_object";
  } catch { /* RuntimeSettingsSchema already validates URLs. */ }
  return "json_schema";
}

export function providerRequestOptions(settings: RuntimeSettings) {
  if (structuredOutputMode(settings) !== "json_object") return {};
  if (settings.thinkingMode === "disabled") return { thinking: { type: "disabled" as const } };
  return {
    thinking: { type: "enabled" as const },
    reasoning_effort: settings.reasoningEffort
  };
}

function responseFormat(settings: RuntimeSettings, name: string, schema: object) {
  if (structuredOutputMode(settings) === "json_object") return { type: "json_object" as const };
  return {
    type: "json_schema" as const,
    json_schema: { name, strict: true, schema }
  };
}

function messagesWithJsonContract(messages: PromptMessage[], settings: RuntimeSettings, name: string, schema: object): PromptMessage[] {
  if (structuredOutputMode(settings) !== "json_object") return messages;
  return [
    {
      role: "system",
      content: [
        `# ${name} json output contract`,
        settings.thinkingMode === "enabled"
          ? "Think thoroughly as instructed before finalizing the answer."
          : "Do not emit a reasoning preamble; proceed directly to the final answer.",
        "Provider-native reasoning_content will be discarded. If reasoning appears in message content, put it only in leading <think></think> blocks.",
        "After any reasoning, return exactly one valid json object and no other text.",
        "For account.upsert, omit avatarText unless needed; when present it must contain only 1–2 visible letters, numbers, symbols, or emoji graphemes.",
        "The object must be an instance of the JSON Schema below, not a copy of the schema.",
        "Resolve $ref definitions when constructing the result. Every required property must be present.",
        JSON.stringify(schema)
      ].join("\n")
    },
    ...messages
  ];
}

function stripSchemaNulls(value: unknown, parent?: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => stripSchemaNulls(item));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    const meaningfulNull = child === null && ((key === "value" && source.op === "set") || key === "pinnedPostId");
    if (child === null && !meaningfulNull) continue;
    result[key] = stripSchemaNulls(child, source);
  }
  return result;
}

export function normalizeModelOutput(value: unknown): unknown {
  const normalized = stripSchemaNulls(value);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;
  const root = normalized as Record<string, unknown>;
  if (!Array.isArray(root.events)) return normalized;
  for (const item of root.events) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const event = item as Record<string, unknown>;
    if (event.type !== "account.upsert" || !event.account || typeof event.account !== "object" || Array.isArray(event.account)) continue;
    const account = event.account as Record<string, unknown>;
    if (typeof account.avatarText === "string") {
      const avatarText = account.avatarText.trim().normalize("NFKC");
      const parsedAvatarText = AvatarTextSchema.safeParse(avatarText);
      if (parsedAvatarText.success) account.avatarText = parsedAvatarText.data;
      else delete account.avatarText;
    }
  }
  return normalized;
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function parseFailureText(text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message ?? parsed.message ?? text;
  } catch { return text; }
}

function parseProviderResponse(text: string): ProviderResponse {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AI provider returned a non-object response");
  return parsed as ProviderResponse;
}

function responseLogDetails(response: Response, body: ProviderResponse | undefined, rawBodyText: string | undefined, phase: string) {
  return {
    phase,
    http: {
      status: response.status,
      statusText: response.statusText,
      requestId: response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined
    },
    ...(rawBodyText === undefined ? {} : { rawBodyText }),
    ...(body === undefined ? {} : { providerResponse: body })
  };
}

export async function generateAiTurn(messages: PromptMessage[], settings: RuntimeSettings, metadata?: AiTraceMetadata): Promise<AiTurnOutput> {
  const headers = requestHeaders(settings);
  const requestUrl = endpoint(settings.apiBaseUrl, "/chat/completions");
  const requestBody = {
    model: settings.model,
    ...providerRequestOptions(settings),
    messages: messagesWithJsonContract(messages, settings, "airp_turn_output", outputJsonSchema),
    temperature: settings.temperature,
    max_tokens: settings.maxOutputTokens,
    top_p: settings.topP,
    frequency_penalty: settings.frequencyPenalty,
    presence_penalty: settings.presencePenalty,
    response_format: responseFormat(settings, "airp_turn_output", outputJsonSchema),
    stream: false
  };
  const trace = startAiTrace({
    operation: "turn",
    model: settings.model,
    endpoint: requestUrl,
    request: requestBody,
    ...(metadata ? { metadata } : {}),
    secrets: [settings.apiKey]
  });
  let response: Response | undefined;
  let rawBodyText: string | undefined;
  let body: ProviderResponse | undefined;
  let phase = "transport";
  try {
    response = await fetch(requestUrl, { method: "POST", headers, body: JSON.stringify(requestBody) });
    phase = "http";
    rawBodyText = await response.text();
    if (!response.ok) throw new AiProviderError(response.status, `AI 请求失败 (${response.status})：${parseFailureText(rawBodyText)}`);
    phase = "response_json";
    body = parseProviderResponse(rawBodyText);
    const message = body.choices?.[0]?.message;
    if (message?.refusal) throw new Error(`模型拒绝生成：${message.refusal}`);
    const raw = finalContentText(message?.content);
    if (!raw) throw new Error("模型返回了空内容");
    phase = "content_json";
    let parsed: unknown;
    try { parsed = parseModelJsonObject(raw); } catch { throw new Error("模型返回内容在过滤思考后不是合法 JSON"); }
    phase = "schema_validation";
    const output = AiTurnOutputSchema.parse(normalizeModelOutput(parsed));
    trace.success(responseLogDetails(response, body, rawBodyText, "complete"));
    return output;
  } catch (error) {
    trace.failure(error, response ? responseLogDetails(response, body, rawBodyText, phase) : { phase });
    throw error;
  }
}

export async function generateHomepageDraft(sourceText: string, settings: RuntimeSettings): Promise<HomepageDraft> {
  const headers = requestHeaders(settings);
  const messages: PromptMessage[] = [
    {
      role: "system",
      content: [
        "You are a homepage structuring engine for a fictional X-style roleplay application.",
        "Transform the user's natural-language homepage into the supplied fixed JSON schema.",
        "Preserve every supplied fact and the original wording as closely as the schema permits.",
        "Use headings and grouped paragraphs to create stable profile sections and section items.",
        "Give every section and item a unique, readable ASCII id.",
        "Assign every profile section to page live, about, or records. Current status and goals belong to live; facts and notices to about; statistics and timelines to records.",
        "Convert abbreviated account counts such as K/M to non-negative integers.",
        "Always set profile.postCount to 0. The application derives it from stored posts and this builder creates no posts.",
        "Convert an explicit current date and time to ISO 8601 with an offset; if no offset is supplied, use +08:00.",
        "Derive heroineState only from current-status facts that are explicitly present.",
        "Do not create posts, comments, messages, live events, or new story facts.",
        "Put ambiguities or missing important fields in notes. Return only the JSON schema instance."
      ].join("\n")
    },
    { role: "user", content: sourceText }
  ];
  const requestUrl = endpoint(settings.apiBaseUrl, "/chat/completions");
  const requestBody = {
    model: settings.model,
    ...providerRequestOptions(settings),
    messages: messagesWithJsonContract(messages, settings, "airp_homepage_draft", homepageJsonSchema),
    temperature: 0.2,
    max_tokens: Math.min(settings.maxOutputTokens, 16_384),
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    response_format: responseFormat(settings, "airp_homepage_draft", homepageJsonSchema),
    stream: false
  };
  const trace = startAiTrace({
    operation: "homepage",
    model: settings.model,
    endpoint: requestUrl,
    request: requestBody,
    secrets: [settings.apiKey]
  });
  let response: Response | undefined;
  let rawBodyText: string | undefined;
  let body: ProviderResponse | undefined;
  let phase = "transport";
  try {
    response = await fetch(requestUrl, { method: "POST", headers, body: JSON.stringify(requestBody) });
    phase = "http";
    rawBodyText = await response.text();
    if (!response.ok) throw new AiProviderError(response.status, `AI 主页解析失败 (${response.status})：${parseFailureText(rawBodyText)}`);
    phase = "response_json";
    body = parseProviderResponse(rawBodyText);
    const message = body.choices?.[0]?.message;
    if (message?.refusal) throw new Error(`模型拒绝解析主页：${message.refusal}`);
    const raw = finalContentText(message?.content);
    if (!raw) throw new Error("模型返回了空主页草稿");
    phase = "content_json";
    let parsed: unknown;
    try { parsed = parseModelJsonObject(raw); } catch { throw new Error("模型返回的主页草稿在过滤思考后不是合法 JSON"); }
    phase = "schema_validation";
    const output = HomepageDraftSchema.parse(stripSchemaNulls(parsed));
    trace.success(responseLogDetails(response, body, rawBodyText, "complete"));
    return output;
  } catch (error) {
    trace.failure(error, response ? responseLogDetails(response, body, rawBodyText, phase) : { phase });
    throw error;
  }
}

export async function testStrictSchemaCapability(settings: RuntimeSettings) {
  const headers = requestHeaders(settings);
  const mode = structuredOutputMode(settings);
  const capabilitySchema = {
    type: "object",
    additionalProperties: false,
    properties: { ok: { type: "boolean" } },
    required: ["ok"]
  };
  const messages: PromptMessage[] = [{ role: "user", content: "Return the valid json object {\"ok\":true} for this structured-output capability check." }];
  const requestUrl = endpoint(settings.apiBaseUrl, "/chat/completions");
  const requestBody = {
    model: settings.model,
    ...providerRequestOptions(settings),
    messages: messagesWithJsonContract(messages, settings, "capability_check", capabilitySchema),
    max_tokens: 1024,
    response_format: responseFormat(settings, "capability_check", capabilitySchema),
    stream: false
  };
  const trace = startAiTrace({
    operation: "capability",
    model: settings.model,
    endpoint: requestUrl,
    request: requestBody,
    secrets: [settings.apiKey]
  });
  let response: Response | undefined;
  let rawBodyText: string | undefined;
  let body: ProviderResponse | undefined;
  let phase = "transport";
  try {
    response = await fetch(requestUrl, { method: "POST", headers, body: JSON.stringify(requestBody) });
    phase = "http";
    rawBodyText = await response.text();
    if (!response.ok) throw new AiProviderError(response.status, `严格 Schema 测试失败 (${response.status})：${parseFailureText(rawBodyText)}`);
    phase = "response_json";
    body = parseProviderResponse(rawBodyText);
    phase = "content_json";
    const parsed = parseModelJsonObject(finalContentText(body.choices?.[0]?.message?.content) || "{}");
    phase = "schema_validation";
    if (typeof parsed.ok !== "boolean") throw new Error("模型未按严格 Schema 返回结果");
    trace.success(responseLogDetails(response, body, rawBodyText, "complete"));
    return { ok: true, model: settings.model, mode };
  } catch (error) {
    trace.failure(error, response ? responseLogDetails(response, body, rawBodyText, phase) : { phase });
    throw error;
  }
}
