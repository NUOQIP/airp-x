import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AiTurnOutputSchema, LocalActionSchema, StorySnapshotSchema } from "@airp/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { compileSafeRegex } from "./regex-safety.js";
import { inspectImageDataUrl } from "./image-data-url.js";
import { beginBranchMaintenance } from "./branch-lock.js";
import {
  branches,
  checkpoints,
  localActions,
  promptBlocks,
  regexRules,
  roleCards,
  rulePresets,
  sessions,
  settings,
  turnCandidates,
  turns,
  userMacros,
  worldbookEntries,
  worldbooks
} from "../db/schema.js";

const id = z.string().min(1).max(160);
const timestamp = z.string().min(1).max(80);
const timestamps = { createdAt: timestamp, updatedAt: timestamp };
const jsonText = (schema: z.ZodTypeAny, label: string) => z.string().superRefine((value, context) => {
  try { schema.parse(JSON.parse(value)); }
  catch { context.addIssue({ code: z.ZodIssueCode.custom, message: `${label} 不是有效的结构化 JSON` }); }
});
const jsonArrayText = z.string().superRefine((value, context) => {
  try { if (!Array.isArray(JSON.parse(value))) throw new Error("not array"); }
  catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "字段必须是 JSON 数组" }); }
});

const SettingRow = z.object({ key: id, value: z.string(), updatedAt: timestamp }).strict();
const RoleCardRow = z.object({ id, role: z.enum(["player", "heroine"]), name: z.string(), version: z.string(), rawText: z.string(), active: z.boolean(), ...timestamps }).strict();
const PromptRow = z.object({ id, name: z.string(), role: z.enum(["system", "user", "assistant"]), content: z.string(), enabled: z.boolean(), sortOrder: z.number().int(), injectionPosition: z.enum(["relative", "in_chat"]), injectionDepth: z.number().int().min(0).max(100), protected: z.boolean(), ...timestamps }).strict();
const WorldbookRow = z.object({ id, name: z.string(), scope: z.enum(["global", "player", "heroine", "session"]), enabled: z.boolean(), tokenBudgetPercent: z.number().int().min(0).max(100), ...timestamps }).strict();
const WorldbookEntryRow = z.object({
  id, bookId: id, title: z.string(), content: z.string(), enabled: z.boolean(), constant: z.boolean(),
  primaryKeysJson: jsonText(z.array(z.string()), "世界书主关键词"), secondaryKeysJson: jsonText(z.array(z.string()), "世界书次关键词"),
  secondaryLogic: z.enum(["and_any", "and_all", "not_any", "not_all"]), scanDepth: z.number().int().min(0).max(100),
  recursive: z.boolean(), probability: z.number().int().min(0).max(100), ignoreBudget: z.boolean(), sortOrder: z.number().int(),
  caseSensitive: z.boolean(), wholeWord: z.boolean(), role: z.enum(["system", "user", "assistant"]),
  position: z.enum(["before_cards", "after_cards", "before_history", "after_history", "author_note_top", "author_note_bottom", "at_depth"]),
  injectionDepth: z.number().int().min(0).max(100), ...timestamps
}).strict();
const RuleRow = z.object({ id, name: z.string(), rawText: z.string(), minProfileChanges: z.number().int(), minPanels: z.number().int(), maxPanels: z.number().int(), representativeComments: z.number().int(), active: z.boolean(), ...timestamps }).strict();
const SessionRow = z.object({ id, name: z.string(), activeBranchId: id, ...timestamps }).strict();
const BranchRow = z.object({ id, sessionId: id, name: z.string(), parentBranchId: id.nullable(), forkedFromTurnId: id.nullable(), currentSnapshotJson: jsonText(StorySnapshotSchema, "分支快照"), rollingSummary: z.string(), pendingActionsJson: jsonArrayText, ...timestamps }).strict();
const TurnRow = z.object({ id, branchId: id, sequence: z.number().int().nonnegative(), status: z.enum(["pending", "complete", "failed"]), inputKind: z.enum(["comment", "dm", "group", "seed"]), inputTargetId: id, inputParentId: id.nullable(), inputText: z.string(), inputRecordId: id, baseSnapshotJson: jsonText(StorySnapshotSchema, "回合基础快照"), error: z.string().nullable(), ...timestamps }).strict();
const CandidateRow = z.object({ id, turnId: id, outputJson: jsonText(AiTurnOutputSchema, "候选输出"), snapshotJson: jsonText(StorySnapshotSchema, "候选快照"), summaryText: z.string(), active: z.boolean(), createdAt: timestamp }).strict();
const CheckpointRow = z.object({ id, branchId: id, turnId: id.nullable(), sequence: z.number().int().nonnegative(), snapshotJson: jsonText(StorySnapshotSchema, "检查点快照"), summaryText: z.string(), createdAt: timestamp }).strict();
const LocalActionRow = z.object({ id, branchId: id, kind: z.string(), targetId: id, valueJson: jsonText(LocalActionSchema, "本地动作"), consumedAt: timestamp.nullable(), createdAt: timestamp }).strict();
const MacroRow = z.object({ id, name: z.string(), value: z.string(), scope: z.enum(["global", "player", "heroine", "session"]), enabled: z.boolean(), ...timestamps }).strict();
const RegexRow = z.object({ id, name: z.string(), pattern: z.string(), replacement: z.string(), flags: z.string(), field: z.enum(["account_text", "post_text", "comment_text", "message_text", "profile_text", "media_text", "live_text", "notice_text"]), enabled: z.boolean(), sortOrder: z.number().int(), ...timestamps }).strict();

const BackupPayloadSchema = z.object({
  format: z.literal("airp-x-backup"),
  version: z.literal(1),
  exportedAt: timestamp,
  note: z.string().optional(),
  data: z.object({
    settings: z.array(SettingRow).min(1),
    roleCards: z.array(RoleCardRow).min(2),
    promptBlocks: z.array(PromptRow),
    worldbooks: z.array(WorldbookRow),
    worldbookEntries: z.array(WorldbookEntryRow),
    rulePresets: z.array(RuleRow).min(1),
    sessions: z.array(SessionRow).min(1),
    branches: z.array(BranchRow).min(1),
    turns: z.array(TurnRow),
    turnCandidates: z.array(CandidateRow),
    checkpoints: z.array(CheckpointRow).min(1),
    localActions: z.array(LocalActionRow),
    userMacros: z.array(MacroRow),
    regexRules: z.array(RegexRow)
  }).strict()
}).strict();

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`备份中存在重复的${label}`);
}

function validateSnapshotImages(json: string) {
  const snapshot = StorySnapshotSchema.parse(JSON.parse(json));
  const urls = [snapshot.profile.bannerUrl, ...snapshot.accounts.map((account) => account.avatarUrl)];
  for (const url of urls) if (url?.startsWith("data:")) inspectImageDataUrl(url);
}

function parseBackupPayloadUnsafe(value: unknown) {
  const backup = BackupPayloadSchema.parse(value);
  const data = backup.data;
  assertUnique(data.settings.map((row) => row.key), "设置键");
  for (const [label, rows] of Object.entries(data)) {
    if (label === "settings") continue;
    assertUnique((rows as Array<{ id: string }>).map((row) => row.id), `${label} ID`);
  }
  assertUnique(data.promptBlocks.map((row) => String(row.sortOrder)), "提示词顺序");
  assertUnique(data.turns.map((row) => `${row.branchId}:${row.sequence}`), "分支回合序号");
  assertUnique(data.checkpoints.map((row) => `${row.branchId}:${row.sequence}`), "分支检查点序号");
  assertUnique(data.userMacros.map((row) => `${row.scope}:${row.name}`), "宏名称与作用域");
  for (const row of data.settings) if ((row.key.startsWith("avatar_url:") || row.key.startsWith("profile_banner_url:")) && row.value.startsWith("data:")) inspectImageDataUrl(row.value);
  for (const row of data.branches) validateSnapshotImages(row.currentSnapshotJson);
  for (const row of data.turns) validateSnapshotImages(row.baseSnapshotJson);
  for (const row of data.turnCandidates) validateSnapshotImages(row.snapshotJson);
  for (const row of data.checkpoints) validateSnapshotImages(row.snapshotJson);

  const sessionIds = new Set(data.sessions.map((row) => row.id));
  const branchById = new Map(data.branches.map((row) => [row.id, row]));
  const turnIds = new Set(data.turns.map((row) => row.id));
  const bookIds = new Set(data.worldbooks.map((row) => row.id));
  const activeSessionSetting = data.settings.find((row) => row.key === "active_session_id");
  if (activeSessionSetting && !sessionIds.has(activeSessionSetting.value)) throw new Error("当前会话设置引用了不存在的会话");
  for (const session of data.sessions) {
    const active = branchById.get(session.activeBranchId);
    if (!active || active.sessionId !== session.id) throw new Error(`会话 ${session.id} 的活跃分支无效`);
  }
  for (const branch of data.branches) {
    if (!sessionIds.has(branch.sessionId)) throw new Error(`分支 ${branch.id} 引用了不存在的会话`);
    if (branch.parentBranchId && !branchById.has(branch.parentBranchId)) throw new Error(`分支 ${branch.id} 的父分支不存在`);
    if (branch.forkedFromTurnId && !turnIds.has(branch.forkedFromTurnId)) throw new Error(`分支 ${branch.id} 的来源回合不存在`);
    if (!data.checkpoints.some((checkpoint) => checkpoint.branchId === branch.id && checkpoint.sequence === 0)) throw new Error(`分支 ${branch.id} 缺少初始检查点`);
  }
  for (const turn of data.turns) if (!branchById.has(turn.branchId)) throw new Error(`回合 ${turn.id} 引用了不存在的分支`);
  for (const candidate of data.turnCandidates) if (!turnIds.has(candidate.turnId)) throw new Error(`候选 ${candidate.id} 引用了不存在的回合`);
  for (const checkpoint of data.checkpoints) {
    if (!branchById.has(checkpoint.branchId)) throw new Error(`检查点 ${checkpoint.id} 引用了不存在的分支`);
    if (checkpoint.turnId && !turnIds.has(checkpoint.turnId)) throw new Error(`检查点 ${checkpoint.id} 引用了不存在的回合`);
  }
  for (const action of data.localActions) if (!branchById.has(action.branchId)) throw new Error(`本地动作 ${action.id} 引用了不存在的分支`);
  for (const entry of data.worldbookEntries) if (!bookIds.has(entry.bookId)) throw new Error(`世界书条目 ${entry.id} 引用了不存在的世界书`);
  for (const rule of data.regexRules) compileSafeRegex(rule.pattern, rule.flags);
  for (const role of ["player", "heroine"] as const) {
    if (data.roleCards.filter((card) => card.role === role && card.active).length !== 1) throw new Error(`${role} 必须且只能有一张启用角色卡`);
  }
  if (data.rulePresets.filter((rule) => rule.active).length !== 1) throw new Error("必须且只能有一个启用规则预设");
  const activeCandidates = new Map<string, number>();
  for (const candidate of data.turnCandidates) if (candidate.active) activeCandidates.set(candidate.turnId, (activeCandidates.get(candidate.turnId) ?? 0) + 1);
  for (const [turnId, count] of activeCandidates) if (count > 1) throw new Error(`回合 ${turnId} 存在多个活跃候选`);
  return backup;
}

export class BackupValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupValidationError";
  }
}

export function parseBackupPayload(value: unknown) {
  try { return parseBackupPayloadUnsafe(value); }
  catch (error) {
    throw new BackupValidationError(error instanceof Error ? error.message : "备份格式无效", { cause: error });
  }
}

export async function createBackup() {
  const data = db.transaction((tx) => ({
    settings: tx.select().from(settings).all(),
    roleCards: tx.select().from(roleCards).all(),
    promptBlocks: tx.select().from(promptBlocks).all(),
    worldbooks: tx.select().from(worldbooks).all(),
    worldbookEntries: tx.select().from(worldbookEntries).all(),
    rulePresets: tx.select().from(rulePresets).all(),
    sessions: tx.select().from(sessions).all(),
    branches: tx.select().from(branches).all(),
    turns: tx.select().from(turns).all(),
    turnCandidates: tx.select().from(turnCandidates).all(),
    checkpoints: tx.select().from(checkpoints).all(),
    localActions: tx.select().from(localActions).all(),
    userMacros: tx.select().from(userMacros).all(),
    regexRules: tx.select().from(regexRules).all()
  }));
  return {
    format: "airp-x-backup" as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    note: "API Key is stored in the local .env file and is intentionally excluded.",
    data
  };
}

async function savePreRestoreBackup() {
  const backup = await createBackup();
  const directory = path.join(config.dataDir, "backups");
  await fs.mkdir(directory, { recursive: true });
  const stamp = backup.exportedAt.replace(/[:.]/g, "-");
  const finalPath = path.join(directory, `pre-restore-${stamp}.json`);
  const temporaryPath = `${finalPath}.${nanoid(6)}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(backup), { encoding: "utf8", flag: "wx" });
  await fs.rename(temporaryPath, finalPath);
  return finalPath;
}

export async function restoreBackup(value: unknown) {
  const backup = parseBackupPayload(value);
  const endMaintenance = beginBranchMaintenance();
  try {
    await savePreRestoreBackup();
    const data = backup.data;
    db.transaction((tx) => {
      tx.delete(localActions).run();
      tx.delete(checkpoints).run();
      tx.delete(turnCandidates).run();
      tx.delete(turns).run();
      tx.delete(branches).run();
      tx.delete(sessions).run();
      tx.delete(worldbookEntries).run();
      tx.delete(worldbooks).run();
      tx.delete(promptBlocks).run();
      tx.delete(roleCards).run();
      tx.delete(rulePresets).run();
      tx.delete(settings).run();
      tx.delete(userMacros).run();
      tx.delete(regexRules).run();
      if (data.settings.length) tx.insert(settings).values(data.settings).run();
      if (data.roleCards.length) tx.insert(roleCards).values(data.roleCards).run();
      if (data.promptBlocks.length) tx.insert(promptBlocks).values(data.promptBlocks).run();
      if (data.worldbooks.length) tx.insert(worldbooks).values(data.worldbooks).run();
      if (data.worldbookEntries.length) tx.insert(worldbookEntries).values(data.worldbookEntries).run();
      if (data.rulePresets.length) tx.insert(rulePresets).values(data.rulePresets).run();
      if (data.sessions.length) tx.insert(sessions).values(data.sessions).run();
      if (data.branches.length) tx.insert(branches).values(data.branches).run();
      if (data.turns.length) tx.insert(turns).values(data.turns).run();
      if (data.turnCandidates.length) tx.insert(turnCandidates).values(data.turnCandidates).run();
      if (data.checkpoints.length) tx.insert(checkpoints).values(data.checkpoints).run();
      if (data.localActions.length) tx.insert(localActions).values(data.localActions).run();
      if (data.userMacros.length) tx.insert(userMacros).values(data.userMacros).run();
      if (data.regexRules.length) tx.insert(regexRules).values(data.regexRules).run();
    });
  } finally {
    endMaintenance();
  }
}
