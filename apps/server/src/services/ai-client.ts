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
import { config } from "../config.js";

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

const stateWriteContractV2: PromptMessage = {
  role: "system",
  content: [
    "# AIRP state write contract v2 (hard constraint)",
    "Permissions are exactly locked, temporary, computed, append_only.",
    "Never write locked fields or computed/derived display values. Update a temporary item only through its declared canonical source. Use dedicated append events for append_only history.",
    "A new AI profile section must be origin=ai, page=records, and may initially contain only temporary items; allow at most 8 AI sections and 12 items per section. To create AI timeline history, first create an empty kind=timeline section with profile.patch, then add each append_only item with profile.item.append. Never place append_only items directly inside the new section patch.",
    "profile.item.add may add an origin=ai temporary item to the fixed initial sidebar/status live card or to an AI-origin section. Its source must be extensions.profileTemporary.<sectionId>.<itemId>. Initial items cannot be removed; an AI-origin temporary item may later be removed with profile.item.remove. append_only items can never be removed.",
    "Every turn must set heroine.status, heroine.outfit, and heroine.mood to truthful values for the new story moment that differ from their previous values. Other temporary sources may remain unchanged when the story does not change them.",
    "When heroine.location changes, use a real-world place name consistent with the story; do not fabricate a supposedly verifiable venue. The program cannot independently map-verify it.",
    "Do not write mvu.derived, revision, computed counters, profile follower/post counts, interaction metrics, trend rank, trend heatScore, or volumeLabel.",
    "Existing posts and comments are immutable: post.upsert and comment.upsert create new ids only. Use post.remove/comment.moderate for supported later state changes.",
    "platform.impact carries qualitative kind/scale only. platform.trend.upsert/remove carries stable identity and qualitative heat only; the program computes all numbers and ranking.",
    "Use statistics.insemination.append for new count/volumeMl records, profile.item.append for milestone/history records, and fan.goal.upsert for fan goals. Only unfinished current/future goals may be updated; completed goals are immutable.",
    "The biological cycle is 7 story-days: menstruation 1, follicular 2, ovulation 1, luteal 3. AI controls storyTime. Pregnancy has one legal transition chain: none -> suspected -> confirmed -> ended -> none. A turn may keep the current state, but never skip, reverse, or transition directly from none to confirmed. Only on suspected -> confirmed, choose durationDays, conceptionAt, and confirmedAt once; never rewrite them afterward. Only on confirmed -> ended, set a new heroine.cycle.anchorDate in that same turn; only a later ended -> none transition returns to the ordinary cycle.",
    "For DM/group turns, speechSegments are character-visible messages. directorInstruction is a hidden Master directive for this turn only; never quote it, turn it into a message, or treat it as character knowledge. A director-only turn contains no player speech.",
    "Use one message.add per natural chat bubble and preserve conversational order. renderPlan may have zero panels and must include only components that actually changed; a profile panel is never mandatory."
  ].join("\n")
};

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

async function providerFetch(requestUrl: string, headers: Record<string, string>, requestBody: object) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.aiRequestTimeoutMs);
  try {
    return await fetch(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
      redirect: "error"
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AiProviderError(504, `AI 请求超过 ${Math.ceil(config.aiRequestTimeoutMs / 1000)} 秒，已自动取消`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function readProviderResponseText(response: Response, maxBytes = config.aiMaxResponseBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new AiProviderError(502, `AI 响应超过安全上限 ${Math.ceil(maxBytes / 1024 / 1024)} MiB`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function responseLogDetails(response: Response, body: ProviderResponse | undefined, rawBodyText: string | undefined, phase: string) {
  const firstChoice = body?.choices?.[0];
  const content = finalContentText(firstChoice?.message?.content);
  const reasoning = firstChoice?.message?.reasoning_content;
  return {
    phase,
    http: {
      status: response.status,
      statusText: response.statusText,
      requestId: response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined
    },
    ...(rawBodyText === undefined ? {} : { rawBodyText }),
    ...(body?.usage === undefined ? {} : { usage: body.usage }),
    ...(phase === "complete" && content !== undefined ? { contentLength: content.length } : {}),
    ...(phase === "complete" && reasoning !== undefined ? { reasoningLength: reasoning.length } : {}),
    ...(phase !== "complete" && firstChoice?.message !== undefined ? { message: firstChoice.message } : {}),
    ...(firstChoice?.finish_reason === undefined ? {} : { finishReason: firstChoice.finish_reason }),
    ...(body === undefined || phase === "complete" ? {} : { providerResponse: body })
  };
}

export async function generateAiTurn(messages: PromptMessage[], settings: RuntimeSettings, metadata?: AiTraceMetadata): Promise<AiTurnOutput> {
  const headers = requestHeaders(settings);
  const requestUrl = endpoint(settings.apiBaseUrl, "/chat/completions");
  const requestBody = {
    model: settings.model,
    ...providerRequestOptions(settings),
    messages: messagesWithJsonContract([stateWriteContractV2, ...messages], settings, "airp_turn_output", outputJsonSchema),
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
    response = await providerFetch(requestUrl, headers, requestBody);
    phase = "http";
    rawBodyText = await readProviderResponseText(response);
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
        "Use headings and grouped paragraphs to create stable profile sections and section items, but do not duplicate a dynamic value outside its canonical source.",
        "Give every section and item a unique, readable ASCII id.",
        "The only section placements are sidebar, bio, and records. There is no live/about profile tab.",
        "Place the current live-status card and fan-plan card in sidebar. account.bio contains only the main bio. Create the usage notice as a separate page=bio notice section whose temporary items use mvu sources heroine.usageNotice.<itemId>; the UI visually merges it with the bio without merging the data. Put the registry, statistics, milestones, and any other durable cards in records.",
        "Set every initial section and item origin to initial.",
        "Permissions are exactly locked, temporary, computed, append_only. IDs, handle, private state, display name, avatar, verification, banner, joined date, section titles/structure, and durable literal facts are locked against AI writes.",
        "Map current status, activity, outfit, mood, and location to temporary items with mvu sources heroine.status, heroine.activity, heroine.outfit, heroine.mood, heroine.location respectively.",
        "For the records registry, height is locked/literal. Breed, weight, measurements, body-depth facts, and other user-supplied mutable registry facts are temporary with mvu paths heroine.profileFacts.<itemId>.",
        "Map cycle fields to exact derived source paths such as cycle.phase and cycle.nextChangeAt. Map statistics to statistics.todayCount, statistics.totalCount, statistics.totalVolumeMl, statistics.lastRecord, and statistics.nextDailyResetAt. Map fan-plan display to fanPlan target/progress/reward/completed paths. Use kind=platform with profile.followerCount/profile.postCount for platform totals.",
        "Existing milestone entries are locked literal history. The milestone section is initial records structure; later milestones are appended with profile.item.append and event_log sources.",
        "This builder creates origin=initial homepage structure, not runtime AI extension cards. The runtime rule for an AI-created timeline is: create an empty records/timeline card first, then use profile.item.append; do not prefill a newly created AI timeline with append_only items.",
        "Temporary fields not covered by a standard source must use mvu.extensions.profileTemporary.<sectionId>.<itemId>. Never invent a computed formula or source.",
        "Convert abbreviated account counts such as K/M to non-negative integers.",
        "Do not output followingCount; the application no longer displays or stores it in homepage drafts.",
        "Always set profile.postCount to 0. The application derives it from stored posts and this builder creates no posts.",
        "Create fanGoals from explicit target/reward plans. targetFollowers must be an absolute positive integer, createdAt must use the initial story time, and ids must be stable ASCII. Do not invent a goal when none is supplied.",
        "Initialize insemination statistics at 0 count and 0 mL regardless of aggregate historical numbers in the prose; the program will accumulate new records from append events.",
        "Convert an explicit current date and time to ISO 8601 with an offset; if no offset is supplied, use +08:00.",
        "Derive heroineState status, activity, outfit, mood, and location only from current-status facts explicitly present. Set heroineState.pregnancy to {status:'none'} unless the input explicitly establishes suspected/confirmed/ended pregnancy; confirmed requires confirmedAt, conceptionAt, and one AI-chosen positive integer durationDays. The application anchors its 7-day cycle to this story time as ovulation.",
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
    response = await providerFetch(requestUrl, headers, requestBody);
    phase = "http";
    rawBodyText = await readProviderResponseText(response);
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
    response = await providerFetch(requestUrl, headers, requestBody);
    phase = "http";
    rawBodyText = await readProviderResponseText(response);
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
