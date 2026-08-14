import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { ConfigSnapshot, PromptPresetState, PromptStackMarker, RuntimeSettings, WorldbookEntry } from "@airp/shared";
import { PromptPresetStateSchema, RuntimeSettingsSchema } from "@airp/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  promptBlocks,
  regexRules,
  roleCards,
  rulePresets,
  settings,
  worldbookEntries,
  worldbooks,
  userMacros
} from "../db/schema.js";

const parseJson = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const maskKey = (key: string) => key.length < 8 ? (key ? "••••" : "") : `${key.slice(0, 3)}••••${key.slice(-4)}`;

const promptPresetSettingsKey = "prompt_presets";
export const promptStackMarkers: PromptStackMarker[] = [
  "worldbook_before_cards",
  "rules",
  "player_card",
  "heroine_card",
  "worldbook_after_cards",
  "mvu_state",
  "profile_state",
  "worldbook_before_history",
  "rolling_memory",
  "recent_history",
  "worldbook_author_note_top",
  "worldbook_author_note_bottom",
  "worldbook_at_depth",
  "recent_platform",
  "worldbook_after_history",
  "current_input"
];

type PromptRow = typeof promptBlocks.$inferSelect;

function defaultPromptPresetState(promptRows: PromptRow[]): PromptPresetState {
  const promptItems = [...promptRows].sort((left, right) => left.sortOrder - right.sortOrder).map((prompt) => ({
    kind: "prompt" as const,
    promptId: prompt.id,
    enabled: prompt.enabled
  }));
  const relativePrompts = promptItems.filter((item) => promptRows.find((prompt) => prompt.id === item.promptId)?.injectionPosition === "relative");
  const inChatPrompts = promptItems.filter((item) => promptRows.find((prompt) => prompt.id === item.promptId)?.injectionPosition === "in_chat");
  const marker = (value: PromptStackMarker) => ({ kind: "marker" as const, marker: value, enabled: true });
  return {
    activePresetId: "prompt-preset-default",
    presets: [{
      id: "prompt-preset-default",
      name: "默认预设",
      items: [
        marker("worldbook_before_cards"),
        ...relativePrompts,
        marker("rules"),
        marker("player_card"),
        marker("heroine_card"),
        marker("worldbook_after_cards"),
        marker("mvu_state"),
        marker("profile_state"),
        marker("worldbook_before_history"),
        marker("rolling_memory"),
        marker("recent_history"),
        marker("worldbook_author_note_top"),
        marker("worldbook_author_note_bottom"),
        ...inChatPrompts,
        marker("worldbook_at_depth"),
        marker("recent_platform"),
        marker("worldbook_after_history"),
        marker("current_input")
      ]
    }]
  };
}

function normalizePromptPresetState(input: PromptPresetState, promptRows: PromptRow[]): PromptPresetState {
  const validPromptIds = new Set(promptRows.map((prompt) => prompt.id));
  const validMarkers = new Set<PromptStackMarker>(promptStackMarkers);
  const promptEnabled = new Map(promptRows.map((prompt) => [prompt.id, prompt.enabled]));
  const presets = input.presets.map((preset) => {
    const seenPrompts = new Set<string>();
    const seenMarkers = new Set<PromptStackMarker>();
    const items = preset.items.filter((item) => {
      if (item.kind === "prompt") {
        if (!validPromptIds.has(item.promptId) || seenPrompts.has(item.promptId)) return false;
        seenPrompts.add(item.promptId);
        return true;
      }
      if (!validMarkers.has(item.marker) || seenMarkers.has(item.marker)) return false;
      seenMarkers.add(item.marker);
      return true;
    }).map((item) => item.kind === "marker" && item.marker === "current_input" ? { ...item, enabled: true } : item);
    const missingPrompts = promptRows.filter((prompt) => !seenPrompts.has(prompt.id)).map((prompt) => ({ kind: "prompt" as const, promptId: prompt.id, enabled: promptEnabled.get(prompt.id) ?? true }));
    const currentInputIndex = items.findIndex((item) => item.kind === "marker" && item.marker === "current_input");
    items.splice(currentInputIndex < 0 ? items.length : currentInputIndex, 0, ...missingPrompts);
    for (const marker of promptStackMarkers) {
      if (seenMarkers.has(marker)) continue;
      const markerOrder = promptStackMarkers.indexOf(marker);
      const nextMarkerIndex = items.findIndex((item) => item.kind === "marker" && promptStackMarkers.indexOf(item.marker) > markerOrder);
      items.splice(nextMarkerIndex < 0 ? items.length : nextMarkerIndex, 0, { kind: "marker", marker, enabled: true });
      seenMarkers.add(marker);
    }
    return { ...preset, items };
  });
  const activePresetId = presets.some((preset) => preset.id === input.activePresetId) ? input.activePresetId : presets[0]!.id;
  return { activePresetId, presets };
}

export async function getPromptPresetState(promptRows: PromptRow[]): Promise<PromptPresetState> {
  const row = (await db.select().from(settings).where(eq(settings.key, promptPresetSettingsKey)).limit(1))[0];
  const parsed = PromptPresetStateSchema.safeParse(parseJson<unknown>(row?.value ?? "", null));
  return normalizePromptPresetState(parsed.success ? parsed.data : defaultPromptPresetState(promptRows), promptRows);
}

export async function savePromptPresetState(input: PromptPresetState): Promise<PromptPresetState> {
  const promptRows = await db.select().from(promptBlocks).orderBy(asc(promptBlocks.sortOrder));
  const normalized = normalizePromptPresetState(PromptPresetStateSchema.parse(input), promptRows);
  const updatedAt = new Date().toISOString();
  await db.insert(settings).values({ key: promptPresetSettingsKey, value: JSON.stringify(normalized), updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(normalized), updatedAt } });
  return normalized;
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const row = (await db.select().from(settings).where(eq(settings.key, "runtime")).limit(1))[0];
  const stored = parseJson<Record<string, unknown>>(row?.value ?? "{}", {});
  return RuntimeSettingsSchema.parse({
    apiBaseUrl: config.envApiBaseUrl ?? stored.apiBaseUrl ?? "https://api.openai.com/v1",
    apiKey: process.env.AIRP_API_KEY ?? config.envApiKey ?? "",
    model: config.envModel ?? stored.model ?? "",
    thinkingMode: stored.thinkingMode ?? "enabled",
    reasoningEffort: stored.reasoningEffort ?? "high",
    temperature: stored.temperature ?? 0.9,
    maxOutputTokens: stored.maxOutputTokens ?? 8_192,
    topP: stored.topP ?? 1,
    frequencyPenalty: stored.frequencyPenalty ?? 0,
    presencePenalty: stored.presencePenalty ?? 0,
    contextWindow: stored.contextWindow ?? 128_000,
    recentHistoryMessages: stored.recentHistoryMessages ?? 30,
    summaryTargetWords: stored.summaryTargetWords ?? 500
  });
}

function writeEnvValue(source: string, key: string, value: string) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
}

export async function saveRuntimeSettings(input: RuntimeSettings) {
  const parsed = RuntimeSettingsSchema.parse(input);
  const { apiKey, ...stored } = parsed;
  const stamp = new Date().toISOString();
  await db.insert(settings).values({ key: "runtime", value: JSON.stringify(stored), updatedAt: stamp })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(stored), updatedAt: stamp } });

  const envPath = path.join(config.workspaceDir, ".env");
  let envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  envText = writeEnvValue(envText, "AIRP_API_BASE_URL", parsed.apiBaseUrl);
  envText = writeEnvValue(envText, "AIRP_API_KEY", apiKey);
  envText = writeEnvValue(envText, "AIRP_MODEL", parsed.model);
  fs.writeFileSync(envPath, envText, "utf8");
  process.env.AIRP_API_KEY = apiKey;
  process.env.AIRP_API_BASE_URL = parsed.apiBaseUrl;
  process.env.AIRP_MODEL = parsed.model;
  return { ...stored, hasApiKey: Boolean(apiKey), apiKeyPreview: maskKey(apiKey) };
}

export async function getConfigSnapshot(): Promise<ConfigSnapshot> {
  const [cards, prompts, books, entries, rules, runtime, macros, regex] = await Promise.all([
    db.select().from(roleCards).orderBy(asc(roleCards.role), asc(roleCards.name)),
    db.select().from(promptBlocks).orderBy(asc(promptBlocks.sortOrder)),
    db.select().from(worldbooks).orderBy(asc(worldbooks.name)),
    db.select().from(worldbookEntries).orderBy(asc(worldbookEntries.sortOrder)),
    db.select().from(rulePresets).where(eq(rulePresets.active, true)).limit(1),
    getRuntimeSettings(),
    db.select().from(userMacros).orderBy(asc(userMacros.name)),
    db.select().from(regexRules).orderBy(asc(regexRules.sortOrder))
  ]);
  const mappedEntries: WorldbookEntry[] = entries.map((entry) => ({
    id: entry.id,
    bookId: entry.bookId,
    title: entry.title,
    content: entry.content,
    enabled: entry.enabled,
    constant: entry.constant,
    primaryKeys: parseJson<string[]>(entry.primaryKeysJson, []),
    secondaryKeys: parseJson<string[]>(entry.secondaryKeysJson, []),
    secondaryLogic: entry.secondaryLogic,
    scanDepth: entry.scanDepth,
    recursive: entry.recursive,
    probability: entry.probability,
    ignoreBudget: entry.ignoreBudget,
    order: entry.sortOrder,
    caseSensitive: entry.caseSensitive,
    wholeWord: entry.wholeWord,
    role: entry.role,
    position: entry.position,
    injectionDepth: entry.injectionDepth
  }));
  const rule = rules[0];
  if (!rule) throw new Error("No active rule preset");
  const promptPresetState = await getPromptPresetState(prompts);
  return {
    roleCards: cards.map((card) => ({
      id: card.id,
      role: card.role,
      name: card.name,
      version: card.version,
      rawText: card.rawText,
      active: card.active,
      updatedAt: card.updatedAt
    })),
    promptBlocks: prompts.map((prompt) => ({
      id: prompt.id,
      name: prompt.name,
      role: prompt.role,
      content: prompt.content,
      enabled: prompt.enabled,
      order: prompt.sortOrder,
      injectionPosition: prompt.injectionPosition,
      injectionDepth: prompt.injectionDepth,
      protected: prompt.protected
    })),
    promptPresetState,
    worldbooks: books.map((book) => ({
      id: book.id,
      name: book.name,
      scope: book.scope,
      enabled: book.enabled,
      tokenBudgetPercent: book.tokenBudgetPercent,
      entries: mappedEntries.filter((entry) => entry.bookId === book.id)
    })),
    rulePreset: {
      id: rule.id,
      name: rule.name,
      rawText: rule.rawText,
      minProfileChanges: rule.minProfileChanges,
      minPanels: rule.minPanels,
      maxPanels: rule.maxPanels,
      representativeComments: rule.representativeComments
    },
    settings: {
      apiBaseUrl: runtime.apiBaseUrl,
      model: runtime.model,
      thinkingMode: runtime.thinkingMode,
      reasoningEffort: runtime.reasoningEffort,
      temperature: runtime.temperature,
      maxOutputTokens: runtime.maxOutputTokens,
      topP: runtime.topP,
      frequencyPenalty: runtime.frequencyPenalty,
      presencePenalty: runtime.presencePenalty,
      contextWindow: runtime.contextWindow,
      recentHistoryMessages: runtime.recentHistoryMessages,
      summaryTargetWords: runtime.summaryTargetWords,
      hasApiKey: Boolean(runtime.apiKey),
      apiKeyPreview: maskKey(runtime.apiKey)
    },
    userMacros: macros.map((macro) => ({ id: macro.id, name: macro.name, value: macro.value, scope: macro.scope, enabled: macro.enabled })),
    regexRules: regex.map((rule) => ({ id: rule.id, name: rule.name, pattern: rule.pattern, replacement: rule.replacement, flags: rule.flags, field: rule.field, enabled: rule.enabled, order: rule.sortOrder }))
  };
}
