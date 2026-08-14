import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { StorySnapshot } from "@airp/shared";
import { db, sqlite } from "./client.js";
import {
  branches,
  checkpoints,
  promptBlocks,
  roleCards,
  rulePresets,
  sessions,
  settings,
  turnCandidates,
  turns,
  worldbooks
} from "./schema.js";
import {
  BRANCH_ID,
  createBlankStorySnapshot,
  ensureHeroineCoverIdentity,
  materialPaths,
  readMaterial,
  SESSION_ID
} from "./defaults.js";
import { buildDefaultRuleConfig, normalizeRuleConfig } from "../services/rule-config.js";
import { migrateStorySnapshotV2 } from "../services/snapshot-migration.js";

const now = () => new Date().toISOString();
const PROMPT_V2_MARKER = "【主页状态协议 v2】";
const PROMPT_V21_MARKER = "【主页扩展事件补充 v2.1】";
const PROMPT_V22_MARKER = "【妊娠状态确认链 v2.2】";
const runtimeContractV2 = `${PROMPT_V2_MARKER}
只输出当前严格 JSON Schema 的实例。AI 只能更新 temporary 的唯一状态源、提交 append_only 专用追加事件，以及提交 platform.impact / platform.trend 的定性信号；locked 与 computed 禁止直接写入。已有贴文和评论正文不可覆盖。页面缓存值、派生数值、趋势排名和互动数由程序生成。粉丝目标使用 fan.goal.upsert，已完成目标禁止覆盖。`;
const storyDirectorV2 = `${PROMPT_V2_MARKER}
每轮按剧情真实更新 heroine.status、heroine.outfit、heroine.mood；其他 temporary 没有变化时保持原值。主简介 heroine.bio 与使用须知 heroine.usageNotice 是独立状态。故事时间由你决定。生理周期为 7 个故事日（经期1、卵泡期2、排卵期1、黄体期3）；妊娠 confirmed 时由你一次性决定 durationDays，之后程序锁定并计算，ended 时同时给出新的 cycle.anchorDate。speechSegments 是諾奇可见发言；directorInstruction 是仅当轮生效的 Master 隐藏导演指令，不得写成角色消息或记忆。`;
const profileExtensionV21 = `${PROMPT_V21_MARKER}
新AI扩展卡创建时只能包含temporary项。timeline历史卡先创建空卡，再用profile.item.append追加append_only项。profile.item.add可向固定母狗实况sidebar/status卡或AI卡追加origin=ai的temporary临时状态；初始项不可删，新增temporary项可用profile.item.remove删除。`;
const pregnancyStateV22 = `${PROMPT_V22_MARKER}
妊娠主状态唯一合法顺序是 none→suspected→confirmed→ended→none；允许同状态保持，禁止跳级、倒退或 none→confirmed。仅 suspected→confirmed 时一次性决定 durationDays、conceptionAt、confirmedAt，之后锁定。仅 confirmed→ended 时结束，并在进入 ended 的同一轮给出新的 cycle.anchorDate；之后才可 ended→none。`;

function appendPromptV2(content: string, addition: string) {
  let result = content;
  if (!result.includes(PROMPT_V2_MARKER)) {
    const separator = result.endsWith("\n\n") ? "" : result.endsWith("\n") ? "\n" : "\n\n";
    result = `${result}${separator}${addition}`;
  }
  if (!result.includes(PROMPT_V21_MARKER)) {
    const separator = result.endsWith("\n\n") ? "" : result.endsWith("\n") ? "\n" : "\n\n";
    result = `${result}${separator}${profileExtensionV21}`;
  }
  if (!result.includes(PROMPT_V22_MARKER)) {
    const separator = result.endsWith("\n\n") ? "" : result.endsWith("\n") ? "\n" : "\n\n";
    result = `${result}${separator}${pregnancyStateV22}`;
  }
  return result;
}

function migrateCoverIdentityJson(value: string) {
  try {
    const withCoverIdentity = ensureHeroineCoverIdentity(JSON.parse(value) as StorySnapshot);
    const migrated = JSON.stringify(migrateStorySnapshotV2(withCoverIdentity));
    return migrated === value ? undefined : migrated;
  } catch {
    return undefined;
  }
}

async function ensureCoverIdentityInSavedStories(stamp: string) {
  const [branchRows, checkpointRows, turnRows, candidateRows] = await Promise.all([
    db.select({ id: branches.id, snapshotJson: branches.currentSnapshotJson }).from(branches),
    db.select({ id: checkpoints.id, snapshotJson: checkpoints.snapshotJson }).from(checkpoints),
    db.select({ id: turns.id, snapshotJson: turns.baseSnapshotJson }).from(turns),
    db.select({ id: turnCandidates.id, snapshotJson: turnCandidates.snapshotJson }).from(turnCandidates)
  ]);
  db.transaction((tx) => {
    for (const row of branchRows) {
      const snapshotJson = migrateCoverIdentityJson(row.snapshotJson);
      if (snapshotJson) tx.update(branches).set({ currentSnapshotJson: snapshotJson, updatedAt: stamp }).where(eq(branches.id, row.id)).run();
    }
    for (const row of checkpointRows) {
      const snapshotJson = migrateCoverIdentityJson(row.snapshotJson);
      if (snapshotJson) tx.update(checkpoints).set({ snapshotJson }).where(eq(checkpoints.id, row.id)).run();
    }
    for (const row of turnRows) {
      const snapshotJson = migrateCoverIdentityJson(row.snapshotJson);
      if (snapshotJson) tx.update(turns).set({ baseSnapshotJson: snapshotJson }).where(eq(turns.id, row.id)).run();
    }
    for (const row of candidateRows) {
      const snapshotJson = migrateCoverIdentityJson(row.snapshotJson);
      if (snapshotJson) tx.update(turnCandidates).set({ snapshotJson }).where(eq(turnCandidates.id, row.id)).run();
    }
  });
}

export async function ensureSeedData() {
  const stamp = now();
  const hasSettings = await db.select().from(settings).where(eq(settings.key, "runtime")).limit(1);
  if (hasSettings.length === 0) {
    await db.insert(settings).values({
      key: "runtime",
      value: JSON.stringify({
        apiBaseUrl: "https://api.openai.com/v1",
        model: "",
        thinkingMode: "enabled",
        reasoningEffort: "high",
        temperature: 0.9,
        maxOutputTokens: 8_192,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        contextWindow: 128_000,
        recentHistoryMessages: 30,
        summaryTargetWords: 500
      }),
      updatedAt: stamp
    });
  }

  const existingCards = await db.select({ id: roleCards.id }).from(roleCards).limit(1);
  if (existingCards.length === 0) {
    await db.insert(roleCards).values([
      {
        id: "card-player-default",
        role: "player",
        name: "諾奇",
        version: "2",
        rawText: readMaterial(materialPaths.playerCard, "# 玩家角色卡\n\n请在配置中心导入或粘贴完整角色卡。"),
        active: true,
        createdAt: stamp,
        updatedAt: stamp
      },
      {
        id: "card-heroine-default",
        role: "heroine",
        name: "喜多川海梦",
        version: "2",
        rawText: readMaterial(materialPaths.heroineCard, "# 女主角色卡\n\n请在配置中心导入或粘贴完整角色卡。"),
        active: true,
        createdAt: stamp,
        updatedAt: stamp
      }
    ]);
  }

  const existingPrompts = await db.select({ id: promptBlocks.id }).from(promptBlocks).limit(1);
  if (existingPrompts.length === 0) {
    await db.insert(promptBlocks).values([
      {
        id: "prompt-runtime-contract",
        name: "运行时输出协议",
        role: "system",
        content: `你是一个以 X 平台界面呈现故事的状态引擎。只返回所要求的严格 JSON Schema。不得替玩家补写、改写或解释输入；不得输出 JSON 之外的内容。\n\n${runtimeContractV2}`,
        enabled: true,
        sortOrder: 10,
        injectionPosition: "relative",
        injectionDepth: 0,
        protected: false,
        createdAt: stamp,
        updatedAt: stamp
      },
      {
        id: "prompt-story-director",
        name: "剧情导演",
        role: "system",
        content: `依据角色卡、规则、世界书、MVU 状态和最近事件，推进连贯剧情。生成 X 原生组件事件，并让主页状态与剧情一致。故事时间由你决定。\n\n${storyDirectorV2}`,
        enabled: true,
        sortOrder: 20,
        injectionPosition: "relative",
        injectionDepth: 0,
        protected: false,
        createdAt: stamp,
        updatedAt: stamp
      }
    ]);
  }

  const existingRules = await db.select({ id: rulePresets.id }).from(rulePresets).limit(1);
  if (existingRules.length === 0) {
    await db.insert(rulePresets).values({
      id: "rules-x-platform",
      name: "X 平台拟真输出规则",
      rawText: buildDefaultRuleConfig(readMaterial(materialPaths.globalRule, "<X>\n每轮通过 X 平台组件推进故事，并保持主页、动态、评论和私信状态一致。\n</X>")),
      minProfileChanges: 0,
      minPanels: 0,
      maxPanels: 5,
      representativeComments: 15,
      active: true,
      createdAt: stamp,
      updatedAt: stamp
    });
  }

  const promptRows = await db.select().from(promptBlocks);
  for (const prompt of promptRows) {
    const addition = prompt.id === "prompt-runtime-contract" ? runtimeContractV2 : prompt.id === "prompt-story-director" ? storyDirectorV2 : undefined;
    if (!addition) continue;
    const content = appendPromptV2(prompt.content, addition);
    if (content !== prompt.content) await db.update(promptBlocks).set({ content, updatedAt: stamp }).where(eq(promptBlocks.id, prompt.id));
  }

  const activeRules = await db.select().from(rulePresets).where(eq(rulePresets.active, true));
  for (const rule of activeRules) {
    try {
      const normalized = normalizeRuleConfig(rule.rawText);
      const constraint = normalized.config.hard_constraints;
      const requiresUpdate = normalized.upgraded
        || rule.minProfileChanges !== 0
        || rule.minPanels !== constraint.render_plan.min_panels
        || rule.maxPanels !== constraint.render_plan.max_panels
        || rule.representativeComments !== constraint.posts.representative_comments;
      if (!requiresUpdate) continue;
      await db.update(rulePresets).set({
        rawText: normalized.rawText,
        minProfileChanges: 0,
        minPanels: constraint.render_plan.min_panels,
        maxPanels: constraint.render_plan.max_panels,
        representativeComments: constraint.posts.representative_comments,
        updatedAt: stamp
      }).where(eq(rulePresets.id, rule.id));
    } catch (error) {
      console.warn(`[seed] 未自动升级规则 ${rule.id}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const existingBooks = await db.select({ id: worldbooks.id }).from(worldbooks).limit(1);
  if (existingBooks.length === 0) {
    await db.insert(worldbooks).values({
      id: "worldbook-main",
      name: "主世界书",
      scope: "global",
      enabled: true,
      tokenBudgetPercent: 25,
      createdAt: stamp,
      updatedAt: stamp
    });
  }

  const existingSession = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, SESSION_ID)).limit(1);
  if (existingSession.length === 0) {
    const snapshotJson = JSON.stringify(createBlankStorySnapshot());
    await db.transaction((tx) => {
      tx.insert(sessions).values({ id: SESSION_ID, name: "主线会话", activeBranchId: BRANCH_ID, createdAt: stamp, updatedAt: stamp }).run();
      tx.insert(branches).values({
        id: BRANCH_ID,
        sessionId: SESSION_ID,
        name: "主线",
        parentBranchId: null,
        forkedFromTurnId: null,
        currentSnapshotJson: snapshotJson,
        rollingSummary: "",
        pendingActionsJson: "[]",
        createdAt: stamp,
        updatedAt: stamp
      }).run();
      tx.insert(checkpoints).values({
        id: nanoid(),
        branchId: BRANCH_ID,
        turnId: null,
        sequence: 0,
        snapshotJson,
        summaryText: "",
        createdAt: stamp
      }).run();
    });
  }

  const activeSessionSetting = await db.select().from(settings).where(eq(settings.key, "active_session_id")).limit(1);
  if (activeSessionSetting.length === 0) {
    await db.insert(settings).values({ key: "active_session_id", value: SESSION_ID, updatedAt: stamp });
  }

  await ensureCoverIdentityInSavedStories(stamp);

  sqlite.exec("PRAGMA optimize");
}
