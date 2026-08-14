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

const now = () => new Date().toISOString();

function migrateCoverIdentityJson(value: string) {
  try {
    const migrated = JSON.stringify(ensureHeroineCoverIdentity(JSON.parse(value) as StorySnapshot));
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
        content: "你是一个以 X 平台界面呈现故事的状态引擎。只返回所要求的严格 JSON Schema。不得替玩家补写、改写或解释输入；不得输出 JSON 之外的内容。",
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
        content: "依据角色卡、规则、世界书、MVU 状态和最近事件，推进连贯剧情。生成 X 原生组件事件，并让主页状态与剧情一致。故事时间由你决定。",
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
      rawText: readMaterial(materialPaths.globalRule, "每轮通过 X 平台组件推进故事，并保持主页、动态、评论和私信状态一致。"),
      minProfileChanges: 3,
      minPanels: 3,
      maxPanels: 5,
      representativeComments: 15,
      active: true,
      createdAt: stamp,
      updatedAt: stamp
    });
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
