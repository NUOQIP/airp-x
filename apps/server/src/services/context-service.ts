import { and, asc, desc, eq } from "drizzle-orm";
import type { PlayerTurnInput, PromptPresetItem, PromptStackMarker, StorySnapshot, WorldbookEntry } from "@airp/shared";
import { db } from "../db/client.js";
import { branches, promptBlocks, roleCards, rulePresets, turns, userMacros, worldbookEntries, worldbooks } from "../db/schema.js";
import { getPromptPresetState, getRuntimeSettings } from "./config-service.js";
import { stringifyContextValue } from "./context-sanitizer.js";
import { parseRuleConfig } from "./rule-config.js";

export interface PromptMessage { role: "system" | "user" | "assistant"; content: string }
export interface ContextBreakdown { label: string; estimatedTokens: number; mandatory: boolean }

export class ContextBudgetError extends Error {
  constructor(public breakdown: ContextBreakdown[], public availableTokens: number) {
    super(`Mandatory context exceeds available input budget (${availableTokens} tokens)`);
  }
}

const estimateTokens = (text: string) => Math.ceil(text.length / 3.2);
const normalize = (text: string, caseSensitive: boolean) => caseSensitive ? text : text.toLocaleLowerCase();

function matchesKey(haystack: string, key: string, caseSensitive: boolean, wholeWord: boolean) {
  const source = normalize(haystack, caseSensitive);
  const needle = normalize(key, caseSensitive).trim();
  if (!needle) return false;
  if (!wholeWord) return source.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, caseSensitive ? "u" : "iu").test(haystack);
}

function entryMatches(entry: WorldbookEntry, text: string) {
  if (entry.constant) return true;
  const primary = entry.primaryKeys.some((key) => matchesKey(text, key, entry.caseSensitive, entry.wholeWord));
  if (!primary) return false;
  const secondaryMatches = entry.secondaryKeys.map((key) => matchesKey(text, key, entry.caseSensitive, entry.wholeWord));
  if (secondaryMatches.length === 0) return true;
  if (entry.secondaryLogic === "and_any") return secondaryMatches.some(Boolean);
  if (entry.secondaryLogic === "and_all") return secondaryMatches.every(Boolean);
  if (entry.secondaryLogic === "not_any") return secondaryMatches.every((value) => !value);
  return secondaryMatches.some((value) => !value);
}

function deterministicChance(entry: WorldbookEntry, revision: number) {
  let hash = revision;
  for (const char of entry.id) hash = Math.imul(hash ^ char.charCodeAt(0), 31);
  return Math.abs(hash % 100) < entry.probability;
}

function renderMacros(content: string, values: Record<string, string>) {
  return content.replace(/\{\{([A-Za-z0-9_.-]+)}}/g, (match, name: string) => values[name] ?? match);
}

export async function assembleContext(branchId: string, input: PlayerTurnInput, snapshot: StorySnapshot, rollingSummaryOverride?: string) {
  const runtime = await getRuntimeSettings();
  const [branchRows, cards, prompts, rules, books, entries, recentTurns, macroRows] = await Promise.all([
    db.select().from(branches).where(eq(branches.id, branchId)).limit(1),
    db.select().from(roleCards).where(eq(roleCards.active, true)),
    db.select().from(promptBlocks).orderBy(asc(promptBlocks.sortOrder)),
    db.select().from(rulePresets).where(eq(rulePresets.active, true)).limit(1),
    db.select().from(worldbooks).where(eq(worldbooks.enabled, true)),
    db.select().from(worldbookEntries).where(eq(worldbookEntries.enabled, true)).orderBy(asc(worldbookEntries.sortOrder)),
    db.select().from(turns).where(and(eq(turns.branchId, branchId), eq(turns.status, "complete"))).orderBy(desc(turns.sequence)).limit(runtime.recentHistoryMessages),
    db.select().from(userMacros).where(eq(userMacros.enabled, true))
  ]);
  const branch = branchRows[0];
  const rule = rules[0];
  const playerCard = cards.find((card) => card.role === "player");
  const heroineCard = cards.find((card) => card.role === "heroine");
  if (!branch || !rule || !playerCard || !heroineCard) throw new Error("Required context configuration is missing");
  const promptPresetState = await getPromptPresetState(prompts);
  const activePromptPreset = promptPresetState.presets.find((preset) => preset.id === promptPresetState.activePresetId) ?? promptPresetState.presets[0]!;
  const parsedRule = parseRuleConfig(rule.rawText);
  const markerEnabled = (marker: PromptStackMarker) => activePromptPreset.items.some((item) => item.kind === "marker" && item.marker === marker && item.enabled);
  const activePromptItems = activePromptPreset.items.filter((item): item is Extract<PromptPresetItem, { kind: "prompt" }> => item.kind === "prompt" && item.enabled);

  const customMacros = (scopes: Array<"global" | "player" | "heroine" | "session">) => Object.fromEntries(macroRows.filter((macro) => scopes.includes(macro.scope)).map((macro) => [macro.name, macro.value]));
  const builtins: Record<string, string> = {
    player: playerCard.name,
    char: heroineCard.name,
    story_time: snapshot.mvu.storyTime,
    input: input.text,
    mvu_revision: String(snapshot.mvu.revision)
  };
  const macros = { ...customMacros(["global", "session"]), ...builtins };
  const playerMacros = { ...customMacros(["global", "session", "player"]), ...builtins };
  const heroineMacros = { ...customMacros(["global", "session", "heroine"]), ...builtins };
  const mandatory: Array<{ label: string; message: PromptMessage }> = [];
  const inChatPromptMessages: Array<{ depth: number; stackOrder: number; label: string; message: PromptMessage }> = [];
  for (const [stackOrder, promptItem] of activePromptItems.entries()) {
    const prompt = prompts.find((candidate) => candidate.id === promptItem.promptId);
    if (!prompt) continue;
    if (prompt.injectionPosition === "in_chat") {
      inChatPromptMessages.push({ depth: prompt.injectionDepth, stackOrder, label: `提示词：${prompt.name}`, message: { role: prompt.role, content: renderMacros(prompt.content, macros) } });
      continue;
    }
    mandatory.push({ label: `提示词：${prompt.name}`, message: { role: prompt.role, content: renderMacros(prompt.content, macros) } });
  }
  if (markerEnabled("rules")) mandatory.push({ label: "规则预设", message: { role: "system", content: `# 全局玩法规则\n${rule.rawText}` } });
  if (markerEnabled("player_card")) mandatory.push({ label: "玩家角色卡", message: { role: "system", content: `# 玩家角色卡（只读）\n${renderMacros(playerCard.rawText, playerMacros)}` } });
  if (markerEnabled("heroine_card")) mandatory.push({ label: "女主角色卡", message: { role: "system", content: `# 女主角色卡（只读）\n${renderMacros(heroineCard.rawText, heroineMacros)}` } });
  const contextMvu = structuredClone(snapshot.mvu);
  delete contextMvu.extensions.homepageSource;
  if (markerEnabled("mvu_state")) mandatory.push({ label: "MVU 状态", message: { role: "system", content: `# 当前 MVU 状态\n${stringifyContextValue(contextMvu)}` } });
  if (markerEnabled("profile_state")) mandatory.push({ label: "主页状态", message: { role: "system", content: `# 当前主页结构化状态\n${stringifyContextValue(snapshot.profile)}` } });

  const breakdown: ContextBreakdown[] = [...mandatory, ...inChatPromptMessages].map((item) => ({ label: item.label, estimatedTokens: estimateTokens(item.message.content), mandatory: true }));
  breakdown.push({ label: "当前玩家输入", estimatedTokens: estimateTokens(input.text), mandatory: true });
  const availableTokens = runtime.contextWindow - runtime.maxOutputTokens;
  const mandatoryTotal = breakdown.reduce((sum, item) => sum + item.estimatedTokens, 0);
  if (mandatoryTotal > availableTokens) throw new ContextBudgetError(breakdown, availableTokens);

  const historyText = [...recentTurns].reverse().map((turn) => `[${turn.inputKind}] ${turn.inputText}`).join("\n");
  const platformText = [
    ...snapshot.posts.slice(-20).map((post) => post.text),
    ...snapshot.comments.slice(-40).map((comment) => comment.text),
    ...snapshot.messages.slice(-40).map((message) => message.text),
    historyText,
    input.text
  ].join("\n");

  const bookIds = new Set(books.map((book) => book.id));
  const mappedEntries: WorldbookEntry[] = entries.filter((entry) => bookIds.has(entry.bookId)).map((entry) => ({
    id: entry.id,
    bookId: entry.bookId,
    title: entry.title,
    content: entry.content,
    enabled: entry.enabled,
    constant: entry.constant,
    primaryKeys: JSON.parse(entry.primaryKeysJson) as string[],
    secondaryKeys: JSON.parse(entry.secondaryKeysJson) as string[],
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
  const activated: WorldbookEntry[] = [];
  let recursiveText = platformText;
  for (let pass = 0; pass < 3; pass += 1) {
    let added = false;
    for (const entry of mappedEntries) {
      if (activated.some((active) => active.id === entry.id)) continue;
      if (!entryMatches(entry, recursiveText) || !deterministicChance(entry, snapshot.mvu.revision)) continue;
      activated.push(entry);
      if (entry.recursive) recursiveText += `\n${entry.content}`;
      added = true;
    }
    if (!added) break;
  }

  let usedTokens = mandatoryTotal;
  const worldbookMessages: Array<{ entry: WorldbookEntry; message: PromptMessage }> = [];
  const worldbookPositionEnabled = (position: WorldbookEntry["position"]) => markerEnabled(position === "before_cards" ? "worldbook_before_cards"
    : position === "after_cards" ? "worldbook_after_cards"
      : position === "before_history" ? "worldbook_before_history"
        : position === "after_history" ? "worldbook_after_history"
          : position === "author_note_top" ? "worldbook_author_note_top"
            : position === "author_note_bottom" ? "worldbook_author_note_bottom"
              : "worldbook_at_depth");
  for (const entry of activated.sort((a, b) => a.order - b.order)) {
    if (!worldbookPositionEnabled(entry.position)) continue;
    const tokenCost = estimateTokens(entry.content);
    const book = books.find((item) => item.id === entry.bookId);
    const budget = Math.floor(availableTokens * ((book?.tokenBudgetPercent ?? 25) / 100));
    const currentWorldbookTokens = worldbookMessages.reduce((sum, item) => sum + estimateTokens(item.message.content), 0);
    if (!entry.ignoreBudget && currentWorldbookTokens + tokenCost > budget) continue;
    worldbookMessages.push({ entry, message: { role: entry.role, content: `# 世界书：${entry.title}\n${entry.content}` } });
    breakdown.push({ label: `世界书：${entry.title}`, estimatedTokens: tokenCost, mandatory: entry.ignoreBudget });
    usedTokens += tokenCost;
  }

  const optional: PromptMessage[] = [];
  const rollingSummary = rollingSummaryOverride ?? branch.rollingSummary;
  if (rollingSummary && markerEnabled("rolling_memory")) optional.push({ role: "system", content: `# 滚动记忆\n${rollingSummary}` });
  if (historyText && markerEnabled("recent_history")) optional.push({ role: "system", content: `# 最近玩家回合（由旧到新）\n${historyText}` });
  if (markerEnabled("recent_platform")) optional.push({ role: "system", content: `# 最近平台事件\n${stringifyContextValue({ posts: snapshot.posts.slice(-10), comments: snapshot.comments.slice(-20), messages: snapshot.messages.slice(-20), localState: snapshot.notices.slice(-10) })}` });
  const optionalMessages: PromptMessage[] = [];
  for (const message of optional) {
    const cost = estimateTokens(message.content);
    if (usedTokens + cost > availableTokens) continue;
    optionalMessages.push(message);
    breakdown.push({ label: message.content.startsWith("# 滚动") ? "滚动记忆" : "最近上下文", estimatedTokens: cost, mandatory: false });
    usedTokens += cost;
  }

  const currentInput: PromptMessage = {
    role: "user",
    content: `# 当前玩家操作\n类型：${input.kind}\n目标：${"postId" in input ? input.postId : input.threadId}\n玩家原文：\n${input.text}`
  };
  const byLabel = (label: string) => mandatory.find((item) => item.label === label)?.message;
  const worldbookAt = (position: WorldbookEntry["position"]) => worldbookMessages.filter((item) => item.entry.position === position).map((item) => item.message);
  const optionalByPrefix = (prefix: string) => optionalMessages.filter((message) => message.content.startsWith(prefix));
  const relativePromptById = new Map(activePromptItems.flatMap((item) => {
    const prompt = prompts.find((candidate) => candidate.id === item.promptId);
    return prompt && prompt.injectionPosition === "relative" ? [[prompt.id, { role: prompt.role, content: renderMacros(prompt.content, macros) } satisfies PromptMessage] as const] : [];
  }));
  const stackMessages: PromptMessage[] = [];
  for (const item of activePromptPreset.items) {
    if (!item.enabled) continue;
    if (item.kind === "prompt") {
      const message = relativePromptById.get(item.promptId);
      if (message) stackMessages.push(message);
      continue;
    }
    const messages = item.marker === "worldbook_before_cards" ? worldbookAt("before_cards")
      : item.marker === "rules" ? [byLabel("规则预设")].filter((message): message is PromptMessage => Boolean(message))
        : item.marker === "player_card" ? [byLabel("玩家角色卡")].filter((message): message is PromptMessage => Boolean(message))
          : item.marker === "heroine_card" ? [byLabel("女主角色卡")].filter((message): message is PromptMessage => Boolean(message))
            : item.marker === "worldbook_after_cards" ? worldbookAt("after_cards")
              : item.marker === "mvu_state" ? [byLabel("MVU 状态")].filter((message): message is PromptMessage => Boolean(message))
                : item.marker === "profile_state" ? [byLabel("主页状态")].filter((message): message is PromptMessage => Boolean(message))
                  : item.marker === "worldbook_before_history" ? worldbookAt("before_history")
                    : item.marker === "rolling_memory" ? optionalByPrefix("# 滚动记忆")
                      : item.marker === "recent_history" ? optionalByPrefix("# 最近玩家回合")
                        : item.marker === "worldbook_author_note_top" ? worldbookAt("author_note_top")
                          : item.marker === "worldbook_author_note_bottom" ? worldbookAt("author_note_bottom")
                            : item.marker === "recent_platform" ? optionalByPrefix("# 最近平台事件")
                              : item.marker === "worldbook_after_history" ? worldbookAt("after_history")
                                : item.marker === "current_input" ? [currentInput]
                                  : [];
    stackMessages.push(...messages);
  }
  if (!stackMessages.includes(currentInput)) stackMessages.push(currentInput);
  const atDepthMarkerOrder = activePromptPreset.items.findIndex((item) => item.kind === "marker" && item.marker === "worldbook_at_depth");
  const depthInsertions = [
    ...inChatPromptMessages.map((item) => ({ depth: item.depth, stackOrder: item.stackOrder, message: item.message })),
    ...worldbookMessages.filter((item) => item.entry.position === "at_depth").map((item) => ({ depth: item.entry.injectionDepth, stackOrder: atDepthMarkerOrder + item.entry.order / 10_000, message: item.message }))
  ].sort((a, b) => b.depth - a.depth || b.stackOrder - a.stackOrder);
  for (const insertion of depthInsertions) {
    const currentInputIndex = stackMessages.indexOf(currentInput);
    const anchor = currentInputIndex < 0 ? stackMessages.length : currentInputIndex;
    const index = Math.max(0, anchor - insertion.depth);
    stackMessages.splice(index, 0, insertion.message);
  }
  return {
    messages: stackMessages,
    breakdown,
    activeWorldbookEntryIds: worldbookMessages.map((item) => item.entry.id),
    settings: runtime,
    rule: {
      minProfileChanges: parsedRule?.hard_constraints.profile.min_real_changes ?? rule.minProfileChanges,
      minPanels: parsedRule?.hard_constraints.render_plan.min_panels ?? rule.minPanels,
      maxPanels: parsedRule?.hard_constraints.render_plan.max_panels ?? rule.maxPanels,
      representativeComments: parsedRule?.hard_constraints.posts.representative_comments ?? rule.representativeComments,
      requireProfilePanel: parsedRule?.hard_constraints.profile.require_profile_panel ?? true,
      requireStrictRevealOrder: parsedRule?.hard_constraints.render_plan.require_strict_reveal_order ?? true,
      requireValidPanelTargets: parsedRule?.hard_constraints.render_plan.require_valid_targets ?? true,
      minLiveQueueItems: parsedRule?.hard_constraints.live.min_queue_items ?? 10,
      maxLiveQueueItems: parsedRule?.hard_constraints.live.max_queue_items ?? 25,
      requireLiveBarrage: parsedRule?.hard_constraints.live.require_barrage ?? true,
      enforceFixedAccounts: parsedRule?.hard_constraints.identity.enforce_fixed_accounts ?? true
    }
  };
}
