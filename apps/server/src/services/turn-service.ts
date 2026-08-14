import { and, asc, desc, eq, inArray, isNull, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  AiTurnOutput,
  AppSnapshot,
  LocalAction,
  PlayerTurnInput,
  StorySnapshot,
  TurnAccepted,
  TurnSummary
} from "@airp/shared";
import { LocalActionSchema, StorySnapshotSchema } from "@airp/shared";
import { db } from "../db/client.js";
import {
  branches,
  checkpoints,
  localActions,
  sessions,
  settings,
  turnCandidates,
  turns
} from "../db/schema.js";
import { createBlankStorySnapshot, PLAYER_ID, SESSION_ID } from "../db/defaults.js";
import { generateAiTurn } from "./ai-client.js";
import { assembleContext } from "./context-service.js";
import { applyAiOutput, normalizeAiTimeline, validateRuleConstraints } from "./story-engine.js";
import { applyOutputRegex } from "./regex-service.js";
import { synchronizeDerivedProfileStats } from "./snapshot-normalizer.js";
import { withBranchLock } from "./branch-lock.js";
import { trimRollingSummary } from "./memory-service.js";
import { applyLocalActionState } from "./local-action-state.js";
import { conflict, notFound } from "./http-error.js";

const parseStory = (json: string) => synchronizeDerivedProfileStats(
  StorySnapshotSchema.parse(JSON.parse(json)) as StorySnapshot
);
const stamp = () => new Date().toISOString();
const MANUALLY_EDITABLE_ACCOUNT_IDS = new Set(["account-heroine", "account-heroine-cover", "account-player"]);

async function applyAccountProfileOverlays(story: StorySnapshot, sessionId: string) {
  const displayNamePrefix = `account_display_name:${sessionId}:`;
  const verifiedPrefix = `account_verified:${sessionId}:`;
  const [displayNameRows, verifiedRows] = await Promise.all([
    db.select().from(settings).where(like(settings.key, `${displayNamePrefix}%`)),
    db.select().from(settings).where(like(settings.key, `${verifiedPrefix}%`))
  ]);
  const displayNameByAccount = new Map(displayNameRows.map((row) => [row.key.slice(displayNamePrefix.length), row.value]));
  const verifiedByAccount = new Map(verifiedRows.map((row) => [row.key.slice(verifiedPrefix.length), row.value === "true"]));
  story.accounts = story.accounts.map((account) => {
    const displayName = displayNameByAccount.get(account.id);
    const verified = verifiedByAccount.get(account.id);
    return displayName === undefined && verified === undefined
      ? account
      : { ...account, ...(displayName !== undefined ? { displayName } : {}), ...(verified !== undefined ? { verified } : {}) };
  });
  return story;
}

function stampGeneratedMessages(output: AiTurnOutput, turnId: string, firstBubbleOrder: number): AiTurnOutput {
  let bubbleOrder = firstBubbleOrder;
  return {
    ...output,
    events: output.events.map((event) => event.type === "message.add"
      ? { ...event, message: { ...event.message, turnId, bubbleOrder: bubbleOrder++ } }
      : event)
  };
}

function segmentsFromTurn(turn: typeof turns.$inferSelect): string[] {
  try {
    const parsed = JSON.parse(turn.inputSegmentsJson) as unknown;
    if (Array.isArray(parsed)) {
      const segments = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (segments.length > 0) return segments;
    }
  } catch {
    // Legacy or manually repaired rows fall back to input_text below.
  }
  return turn.inputText.trim().length > 0 ? [turn.inputText] : [];
}

function recordIdsFromTurn(turn: typeof turns.$inferSelect): string[] {
  try {
    const parsed = JSON.parse(turn.inputRecordIdsJson) as unknown;
    if (Array.isArray(parsed)) {
      const recordIds = parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (recordIds.length > 0) return recordIds;
    }
  } catch {
    // Legacy rows have one record ID in input_record_id.
  }
  return turn.inputRecordId ? [turn.inputRecordId] : [];
}

function inputFromTurn(turn: typeof turns.$inferSelect): PlayerTurnInput {
  if (turn.inputKind === "comment") {
    return {
      kind: "comment",
      branchId: turn.branchId,
      postId: turn.inputTargetId,
      ...(turn.inputParentId ? { parentCommentId: turn.inputParentId } : {}),
      text: turn.inputText
    };
  }
  if (turn.inputKind === "seed") throw conflict("初始化回合不能作为玩家输入生成");
  return {
    kind: turn.inputKind,
    branchId: turn.branchId,
    threadId: turn.inputTargetId,
    ...(turn.inputParentId ? { replyToMessageId: turn.inputParentId } : {}),
    speechSegments: segmentsFromTurn(turn),
    ...(turn.directorInstruction ? { directorInstruction: turn.directorInstruction } : {})
  };
}

function appendPlayerRecords(base: StorySnapshot, input: PlayerTurnInput, recordIds: string[], turnId: string): StorySnapshot {
  const next = structuredClone(base);
  const createdAt = next.mvu.storyTime;
  if (input.kind === "comment") {
    const recordId = recordIds[0];
    if (!recordId) throw conflict("Comment input record ID is missing", "INPUT_RECORD_MISSING");
    const post = next.posts.find((item) => item.id === input.postId);
    if (!post || post.moderation === "deleted") throw notFound("无法评论不存在或已删除的帖文", "POST_NOT_FOUND");
    if (input.parentCommentId && !next.comments.some((item) => item.id === input.parentCommentId && item.postId === input.postId)) throw notFound("回复目标不存在", "COMMENT_NOT_FOUND");
    next.comments.push({
      id: recordId,
      postId: input.postId,
      ...(input.parentCommentId ? { parentId: input.parentCommentId } : {}),
      authorId: PLAYER_ID,
      createdAt,
      text: input.text,
      metrics: { replies: 0, reposts: 0, likes: 0, views: 0, bookmarks: 0 },
      moderation: "visible"
    });
    post.metrics.replies += 1;
  } else {
    const thread = next.threads.find((item) => item.id === input.threadId);
    if (!thread) throw notFound("私信会话不存在", "THREAD_NOT_FOUND");
    if (!thread.playerCanSend || !thread.participantIds.includes(PLAYER_ID)) throw conflict("玩家不能在该会话中发送消息", "THREAD_READ_ONLY");
    if (input.kind !== thread.kind) throw conflict("会话类型不匹配", "THREAD_KIND_MISMATCH");
    if (input.replyToMessageId && !next.messages.some((item) => item.id === input.replyToMessageId && item.threadId === input.threadId)) throw notFound("回复消息不存在", "MESSAGE_NOT_FOUND");
    for (const [bubbleOrder, text] of input.speechSegments.entries()) {
      const recordId = recordIds[bubbleOrder];
      if (!recordId) throw conflict("Direct-message input record ID is missing", "INPUT_RECORD_MISSING");
      next.messages.push({
        id: recordId,
        threadId: input.threadId,
        senderId: PLAYER_ID,
        createdAt,
        text,
        status: "sent",
        ...(bubbleOrder === 0 && input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
        isPlayerInput: true,
        turnId,
        bubbleOrder
      });
    }
    if (input.speechSegments.length > 0) thread.updatedAt = createdAt;
  }
  return next;
}

async function nextSequence(branchId: string) {
  const latest = (await db.select({ sequence: turns.sequence }).from(turns).where(eq(turns.branchId, branchId)).orderBy(desc(turns.sequence)).limit(1))[0];
  return (latest?.sequence ?? 0) + 1;
}

export async function getAppSnapshot(branchId?: string): Promise<AppSnapshot> {
  const allSessions = await db.select().from(sessions).orderBy(desc(sessions.updatedAt));
  const requestedBranch = branchId ? (await db.select().from(branches).where(eq(branches.id, branchId)).limit(1))[0] : undefined;
  const activeSessionSetting = (await db.select().from(settings).where(eq(settings.key, "active_session_id")).limit(1))[0];
  const sessionId = requestedBranch?.sessionId ?? activeSessionSetting?.value ?? SESSION_ID;
  const session = allSessions.find((item) => item.id === sessionId) ?? allSessions[0];
  if (!session) throw notFound("主会话不存在", "SESSION_NOT_FOUND");
  const activeBranchId = branchId ?? session.activeBranchId;
  const [branchRows, activeRows, turnRows] = await Promise.all([
    db.select().from(branches).where(eq(branches.sessionId, session.id)).orderBy(desc(branches.updatedAt)),
    db.select().from(branches).where(eq(branches.id, activeBranchId)).limit(1),
    db.select().from(turns).where(eq(turns.branchId, activeBranchId)).orderBy(asc(turns.sequence))
  ]);
  const active = activeRows[0];
  if (!active) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  const candidateRows = turnRows.length
    ? await db.select().from(turnCandidates).where(inArray(turnCandidates.turnId, turnRows.map((turn) => turn.id))).orderBy(asc(turnCandidates.createdAt))
    : [];
  const candidateByTurn = new Map<string, typeof candidateRows>();
  for (const turn of turnRows) candidateByTurn.set(turn.id, []);
  for (const candidate of candidateRows) candidateByTurn.get(candidate.turnId)?.push(candidate);
  const story = parseStory(active.currentSnapshotJson);
  const avatarTextPrefix = `avatar_text:${session.id}:`;
  const avatarUrlPrefix = `avatar_url:${session.id}:`;
  const displayNamePrefix = `account_display_name:${session.id}:`;
  const verifiedPrefix = `account_verified:${session.id}:`;
  const bannerToneKey = `profile_banner_tone:${session.id}`;
  const bannerUrlKey = `profile_banner_url:${session.id}`;
  const [avatarTextRows, avatarUrlRows, displayNameRows, verifiedRows, bannerToneRows, bannerUrlRows] = await Promise.all([
    db.select().from(settings).where(like(settings.key, `${avatarTextPrefix}%`)),
    db.select().from(settings).where(like(settings.key, `${avatarUrlPrefix}%`)),
    db.select().from(settings).where(like(settings.key, `${displayNamePrefix}%`)),
    db.select().from(settings).where(like(settings.key, `${verifiedPrefix}%`)),
    db.select().from(settings).where(eq(settings.key, bannerToneKey)).limit(1),
    db.select().from(settings).where(eq(settings.key, bannerUrlKey)).limit(1)
  ]);
  const avatarTextByAccount = new Map(avatarTextRows.map((row) => [row.key.slice(avatarTextPrefix.length), row.value]));
  const avatarUrlByAccount = new Map(avatarUrlRows.map((row) => [row.key.slice(avatarUrlPrefix.length), row.value]));
  const displayNameByAccount = new Map(displayNameRows.map((row) => [row.key.slice(displayNamePrefix.length), row.value]));
  const verifiedByAccount = new Map(verifiedRows.map((row) => [row.key.slice(verifiedPrefix.length), row.value === "true"]));
  story.accounts = story.accounts.map((account) => {
    const avatarText = avatarTextByAccount.get(account.id);
    const avatarUrl = avatarUrlByAccount.get(account.id);
    const displayName = displayNameByAccount.get(account.id);
    const verified = verifiedByAccount.get(account.id);
    return avatarText || avatarUrl || displayName !== undefined || verified !== undefined
      ? { ...account, ...(avatarText ? { avatarText } : {}), ...(avatarUrl ? { avatarUrl } : {}), ...(displayName !== undefined ? { displayName } : {}), ...(verified !== undefined ? { verified } : {}) }
      : account;
  });
  const bannerTone = bannerToneRows[0]?.value as StorySnapshot["profile"]["bannerTone"] | undefined;
  const bannerUrl = bannerUrlRows[0]?.value;
  if (bannerTone) story.profile.bannerTone = bannerTone;
  if (bannerUrl) story.profile.bannerUrl = bannerUrl;
  const turnSummaries: TurnSummary[] = turnRows.map((turn) => ({
    id: turn.id,
    branchId: turn.branchId,
    sequence: turn.sequence,
    status: turn.status,
    inputKind: turn.inputKind,
    inputText: turn.inputText,
    inputSegments: turn.inputKind === "comment" || turn.inputKind === "seed" ? [] : segmentsFromTurn(turn),
    ...(turn.directorInstruction ? { directorInstruction: turn.directorInstruction } : {}),
    createdAt: turn.createdAt,
    ...(turn.error ? { error: turn.error } : {}),
    candidates: (candidateByTurn.get(turn.id) ?? []).map((candidate) => ({ id: candidate.id, active: candidate.active, createdAt: candidate.createdAt }))
  }));
  return {
    session: { id: session.id, name: session.name, activeBranchId },
    sessions: allSessions.map((item) => ({
      id: item.id,
      name: item.name,
      activeBranchId: item.activeBranchId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      active: item.id === session.id
    })),
    branches: branchRows.map((branch) => ({
      id: branch.id,
      sessionId: branch.sessionId,
      name: branch.name,
      ...(branch.parentBranchId ? { parentBranchId: branch.parentBranchId } : {}),
      ...(branch.forkedFromTurnId ? { forkedFromTurnId: branch.forkedFromTurnId } : {}),
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
      active: branch.id === activeBranchId
    })),
    turns: turnSummaries,
    ...story
  };
}

async function persistPlayerInput(input: PlayerTurnInput) {
  const branch = (await db.select().from(branches).where(eq(branches.id, input.branchId)).limit(1))[0];
  if (!branch) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  const base = parseStory(branch.currentSnapshotJson);
  const sequence = await nextSequence(input.branchId);
  const turnId = nanoid();
  const speechSegments = input.kind === "comment" ? [] : input.speechSegments;
  const recordIds = Array.from({ length: input.kind === "comment" ? 1 : speechSegments.length }, () => nanoid());
  const inputStory = appendPlayerRecords(base, input, recordIds, turnId);
  const now = stamp();
  db.transaction((tx) => {
    tx.insert(turns).values({
      id: turnId,
      branchId: input.branchId,
      sequence,
      status: "pending",
      inputKind: input.kind,
      inputTargetId: input.kind === "comment" ? input.postId : input.threadId,
      inputParentId: input.kind === "comment" ? input.parentCommentId ?? null : input.replyToMessageId ?? null,
      inputText: input.kind === "comment" ? input.text : speechSegments.join("\n\n"),
      inputRecordId: recordIds[0] ?? `director-${turnId}`,
      inputSegmentsJson: JSON.stringify(speechSegments),
      inputRecordIdsJson: JSON.stringify(recordIds),
      directorInstruction: input.kind === "comment" ? null : input.directorInstruction ?? null,
      baseSnapshotJson: JSON.stringify(base),
      error: null,
      createdAt: now,
      updatedAt: now
    }).run();
    tx.update(branches).set({ currentSnapshotJson: JSON.stringify(inputStory), updatedAt: now }).where(eq(branches.id, input.branchId)).run();
  });
  return turnId;
}

async function generateForTurn(turnId: string, regeneration: boolean): Promise<TurnAccepted> {
  const turn = (await db.select().from(turns).where(eq(turns.id, turnId)).limit(1))[0];
  if (!turn) throw notFound("回合不存在", "TURN_NOT_FOUND");
  const branch = (await db.select().from(branches).where(eq(branches.id, turn.branchId)).limit(1))[0];
  if (!branch) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  const latestSequence = (await db.select({ sequence: turns.sequence }).from(turns).where(eq(turns.branchId, turn.branchId)).orderBy(desc(turns.sequence)).limit(1))[0]?.sequence;
  if (latestSequence !== turn.sequence) throw conflict("只能在最新回合重试或重新生成；编辑旧回合请创建分支", "TURN_NOT_LATEST");
  const input = inputFromTurn(turn);
  const inputStory = regeneration
    ? appendPlayerRecords(parseStory(turn.baseSnapshotJson), input, recordIdsFromTurn(turn), turn.id)
    : parseStory(branch.currentSnapshotJson);
  await applyAccountProfileOverlays(inputStory, branch.sessionId);
  if (regeneration) {
    const pending = await db.select().from(localActions).where(and(eq(localActions.branchId, branch.id), isNull(localActions.consumedAt))).orderBy(asc(localActions.createdAt));
    for (const action of pending) applyLocalActionState(inputStory, LocalActionSchema.parse(JSON.parse(action.valueJson)));
  }
  try {
    const previousCheckpoint = regeneration
      ? (await db.select().from(checkpoints).where(and(eq(checkpoints.branchId, branch.id), eq(checkpoints.sequence, Math.max(0, turn.sequence - 1)))).limit(1))[0]
      : undefined;
    const baseSummary = previousCheckpoint?.summaryText ?? branch.rollingSummary;
    const context = await assembleContext(turn.branchId, input, inputStory, baseSummary, turn.id);
    const output = normalizeAiTimeline(inputStory, stampGeneratedMessages(
      await applyOutputRegex(await generateAiTurn(context.messages, context.settings, {
        turnId: turn.id,
        branchId: branch.id
      })),
      turn.id,
      input.kind === "comment" ? 0 : input.speechSegments.length
    ));
    validateRuleConstraints(inputStory, output, context.rule);
    const nextStory = applyAiOutput(inputStory, output);
    const candidateId = nanoid();
    const now = stamp();
    const summary = trimRollingSummary(output.memoryNote
      ? `${baseSummary}\n${output.storyTime}：${output.memoryNote}`
      : baseSummary, context.settings.summaryTargetWords);
    db.transaction((tx) => {
      tx.update(turnCandidates).set({ active: false }).where(eq(turnCandidates.turnId, turn.id)).run();
      tx.insert(turnCandidates).values({ id: candidateId, turnId: turn.id, outputJson: JSON.stringify(output), snapshotJson: JSON.stringify(nextStory), summaryText: summary, active: true, createdAt: now }).run();
      tx.update(turns).set({ status: "complete", error: null, updatedAt: now }).where(eq(turns.id, turn.id)).run();
      tx.update(branches).set({ currentSnapshotJson: JSON.stringify(nextStory), rollingSummary: summary, pendingActionsJson: "[]", updatedAt: now }).where(eq(branches.id, branch.id)).run();
      tx.update(localActions).set({ consumedAt: now }).where(and(eq(localActions.branchId, branch.id), isNull(localActions.consumedAt))).run();
      tx.insert(checkpoints).values({ id: nanoid(), branchId: branch.id, turnId: turn.id, sequence: turn.sequence, snapshotJson: JSON.stringify(nextStory), summaryText: summary, createdAt: now })
        .onConflictDoUpdate({ target: [checkpoints.branchId, checkpoints.sequence], set: { snapshotJson: JSON.stringify(nextStory), summaryText: summary, createdAt: now } }).run();
    });
    return { turnId: turn.id, snapshot: await getAppSnapshot(branch.id), renderPlan: output.renderPlan };
  } catch (error) {
    if (!regeneration) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(turns).set({ status: "failed", error: message, updatedAt: stamp() }).where(eq(turns.id, turn.id));
    }
    throw error;
  }
}

export async function submitTurn(input: PlayerTurnInput) {
  return withBranchLock(input.branchId, async () => {
    const turnId = await persistPlayerInput(input);
    try {
      return await generateForTurn(turnId, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(turns).set({ status: "failed", error: message, updatedAt: stamp() }).where(eq(turns.id, turnId));
      throw error;
    }
  });
}

export async function retryTurn(turnId: string) {
  const turn = (await db.select().from(turns).where(eq(turns.id, turnId)).limit(1))[0];
  if (!turn) throw notFound("回合不存在", "TURN_NOT_FOUND");
  if (turn.status !== "failed") throw conflict("只有失败的最新回合可以重试", "TURN_NOT_FAILED");
  return withBranchLock(turn.branchId, async () => {
    const current = (await db.select().from(turns).where(eq(turns.id, turnId)).limit(1))[0];
    if (!current || current.status !== "failed") throw conflict("只有失败的最新回合可以重试", "TURN_NOT_FAILED");
    await db.update(turns).set({ status: "pending", error: null, updatedAt: stamp() }).where(eq(turns.id, turnId));
    try {
      return await generateForTurn(turnId, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(turns).set({ status: "failed", error: message, updatedAt: stamp() }).where(eq(turns.id, turnId));
      throw error;
    }
  });
}

export async function regenerateTurn(turnId: string) {
  const turn = (await db.select().from(turns).where(eq(turns.id, turnId)).limit(1))[0];
  if (!turn) throw notFound("回合不存在", "TURN_NOT_FOUND");
  if (turn.status !== "complete") throw conflict("只有已完成的最新回合可以重新生成", "TURN_NOT_COMPLETE");
  return withBranchLock(turn.branchId, async () => {
    try {
      return await generateForTurn(turnId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(turns).set({ error: `重新生成失败：${message}`, updatedAt: stamp() }).where(eq(turns.id, turnId));
      throw error;
    }
  });
}

export async function selectCandidate(candidateId: string) {
  const candidate = (await db.select().from(turnCandidates).where(eq(turnCandidates.id, candidateId)).limit(1))[0];
  if (!candidate) throw notFound("候选结果不存在", "CANDIDATE_NOT_FOUND");
  const turn = (await db.select().from(turns).where(eq(turns.id, candidate.turnId)).limit(1))[0];
  if (!turn) throw notFound("候选结果所属回合不存在", "TURN_NOT_FOUND");
  return withBranchLock(turn.branchId, async () => {
    const latest = (await db.select({ id: turns.id }).from(turns).where(eq(turns.branchId, turn.branchId)).orderBy(desc(turns.sequence)).limit(1))[0];
    if (latest?.id !== turn.id) throw conflict("只能切换最新回合的候选结果", "TURN_NOT_LATEST");
    const now = stamp();
    const selectedStory = parseStory(candidate.snapshotJson);
    const pending = await db.select().from(localActions).where(and(eq(localActions.branchId, turn.branchId), isNull(localActions.consumedAt))).orderBy(asc(localActions.createdAt));
    for (const action of pending) applyLocalActionState(selectedStory, LocalActionSchema.parse(JSON.parse(action.valueJson)));
    const selectedSnapshotJson = JSON.stringify(selectedStory);
    db.transaction((tx) => {
      tx.update(turnCandidates).set({ active: false }).where(eq(turnCandidates.turnId, turn.id)).run();
      tx.update(turnCandidates).set({ active: true }).where(eq(turnCandidates.id, candidate.id)).run();
      tx.update(branches).set({ currentSnapshotJson: selectedSnapshotJson, rollingSummary: candidate.summaryText, updatedAt: now }).where(eq(branches.id, turn.branchId)).run();
      tx.update(checkpoints).set({ snapshotJson: selectedSnapshotJson, summaryText: candidate.summaryText, createdAt: now }).where(and(eq(checkpoints.branchId, turn.branchId), eq(checkpoints.sequence, turn.sequence))).run();
    });
    return getAppSnapshot(turn.branchId);
  });
}

export async function applyLocalAction(input: LocalAction) {
  return withBranchLock(input.branchId, () => applyLocalActionUnlocked(input));
}

async function applyLocalActionUnlocked(input: LocalAction) {
  const branch = (await db.select().from(branches).where(eq(branches.id, input.branchId)).limit(1))[0];
  if (!branch) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  const story = applyLocalActionState(parseStory(branch.currentSnapshotJson), input);
  const now = stamp();
  const targetId = "postId" in input ? input.postId : input.accountId;
  db.transaction((tx) => {
    tx.update(branches).set({ currentSnapshotJson: JSON.stringify(story), updatedAt: now }).where(eq(branches.id, branch.id)).run();
    tx.insert(localActions).values({ id: nanoid(), branchId: branch.id, kind: input.kind, targetId, valueJson: JSON.stringify(input), consumedAt: null, createdAt: now }).run();
  });
  return getAppSnapshot(branch.id);
}

export async function recoverInterruptedTurns() {
  const now = stamp();
  await db.update(turns).set({
    status: "failed",
    error: "服务在生成过程中中断；玩家输入已保留，请重试此回合。",
    updatedAt: now
  }).where(eq(turns.status, "pending"));
}

export async function activateBranch(branchId: string) {
  const branch = (await db.select().from(branches).where(eq(branches.id, branchId)).limit(1))[0];
  if (!branch) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  const now = stamp();
  db.transaction((tx) => {
    tx.update(sessions).set({ activeBranchId: branchId, updatedAt: now }).where(eq(sessions.id, branch.sessionId)).run();
    tx.insert(settings).values({ key: "active_session_id", value: branch.sessionId, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: branch.sessionId, updatedAt: now } }).run();
  });
  return getAppSnapshot(branchId);
}

export async function createSession(name: string) {
  const sessionId = nanoid();
  const branchId = nanoid();
  const now = stamp();
  const snapshotJson = JSON.stringify(createBlankStorySnapshot());
  db.transaction((tx) => {
    tx.insert(sessions).values({ id: sessionId, name, activeBranchId: branchId, createdAt: now, updatedAt: now }).run();
    tx.insert(branches).values({ id: branchId, sessionId, name: "主线", parentBranchId: null, forkedFromTurnId: null, currentSnapshotJson: snapshotJson, rollingSummary: "", pendingActionsJson: "[]", createdAt: now, updatedAt: now }).run();
    tx.insert(checkpoints).values({ id: nanoid(), branchId, turnId: null, sequence: 0, snapshotJson, summaryText: "", createdAt: now }).run();
    tx.insert(settings).values({ key: "active_session_id", value: sessionId, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: sessionId, updatedAt: now } }).run();
  });
  return getAppSnapshot(branchId);
}

export async function activateSession(sessionId: string) {
  const session = (await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1))[0];
  if (!session) throw notFound("会话不存在", "SESSION_NOT_FOUND");
  const now = stamp();
  await db.insert(settings).values({ key: "active_session_id", value: sessionId, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: sessionId, updatedAt: now } });
  return getAppSnapshot(session.activeBranchId);
}

export async function updateAvatar(branchId: string, accountId: string, avatarText: string, avatarUrl: string) {
  const branch = (await db.select().from(branches).where(eq(branches.id, branchId)).limit(1))[0];
  if (!branch) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  const story = parseStory(branch.currentSnapshotJson);
  if (!story.accounts.some((account) => account.id === accountId)) throw notFound("账号不存在", "ACCOUNT_NOT_FOUND");
  const textKey = `avatar_text:${branch.sessionId}:${accountId}`;
  const urlKey = `avatar_url:${branch.sessionId}:${accountId}`;
  const now = stamp();
  db.transaction((tx) => {
    if (avatarText) {
      tx.insert(settings).values({ key: textKey, value: avatarText, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value: avatarText, updatedAt: now } }).run();
    } else tx.delete(settings).where(eq(settings.key, textKey)).run();
    if (avatarUrl) {
      tx.insert(settings).values({ key: urlKey, value: avatarUrl, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value: avatarUrl, updatedAt: now } }).run();
    } else tx.delete(settings).where(eq(settings.key, urlKey)).run();
  });
  return getAppSnapshot(branchId);
}

export async function updateAccountProfile(branchId: string, accountId: string, displayName: string, verified: boolean) {
  const branch = (await db.select().from(branches).where(eq(branches.id, branchId)).limit(1))[0];
  if (!branch) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  if (!MANUALLY_EDITABLE_ACCOUNT_IDS.has(accountId)) throw conflict("该账号不允许在资料编辑器中修改", "ACCOUNT_PROFILE_LOCKED");
  const story = parseStory(branch.currentSnapshotJson);
  if (!story.accounts.some((account) => account.id === accountId)) throw notFound("账号不存在", "ACCOUNT_NOT_FOUND");
  const displayNameKey = `account_display_name:${branch.sessionId}:${accountId}`;
  const verifiedKey = `account_verified:${branch.sessionId}:${accountId}`;
  const now = stamp();
  db.transaction((tx) => {
    tx.insert(settings).values({ key: displayNameKey, value: displayName, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: displayName, updatedAt: now } }).run();
    tx.insert(settings).values({ key: verifiedKey, value: String(verified), updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: String(verified), updatedAt: now } }).run();
  });
  return getAppSnapshot(branchId);
}

export async function updateProfileBanner(branchId: string, bannerTone: "" | StorySnapshot["profile"]["bannerTone"], bannerUrl: string) {
  const branch = (await db.select().from(branches).where(eq(branches.id, branchId)).limit(1))[0];
  if (!branch) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  const toneKey = `profile_banner_tone:${branch.sessionId}`;
  const urlKey = `profile_banner_url:${branch.sessionId}`;
  const now = stamp();
  db.transaction((tx) => {
    if (bannerTone) {
      tx.insert(settings).values({ key: toneKey, value: bannerTone, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value: bannerTone, updatedAt: now } }).run();
    } else tx.delete(settings).where(eq(settings.key, toneKey)).run();
    if (bannerUrl) {
      tx.insert(settings).values({ key: urlKey, value: bannerUrl, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value: bannerUrl, updatedAt: now } }).run();
    } else tx.delete(settings).where(eq(settings.key, urlKey)).run();
  });
  return getAppSnapshot(branchId);
}

export async function forkFromTurn(turnId: string, text: string) {
  const original = (await db.select().from(turns).where(eq(turns.id, turnId)).limit(1))[0];
  if (!original) throw notFound("原回合不存在", "TURN_NOT_FOUND");
  const parent = (await db.select().from(branches).where(eq(branches.id, original.branchId)).limit(1))[0];
  if (!parent) throw notFound("原分支不存在", "BRANCH_NOT_FOUND");
  const branchId = nanoid();
  const now = stamp();
  const parentCheckpoint = (await db.select().from(checkpoints).where(and(eq(checkpoints.branchId, parent.id), eq(checkpoints.sequence, Math.max(0, original.sequence - 1)))).limit(1))[0];
  const inheritedSummary = parentCheckpoint?.summaryText ?? "";
  db.transaction((tx) => {
    tx.insert(branches).values({
      id: branchId,
      sessionId: parent.sessionId,
      name: `${parent.name} · 分支 ${original.sequence}`,
      parentBranchId: parent.id,
      forkedFromTurnId: original.id,
      currentSnapshotJson: original.baseSnapshotJson,
      rollingSummary: inheritedSummary,
      pendingActionsJson: "[]",
      createdAt: now,
      updatedAt: now
    }).run();
    tx.insert(checkpoints).values({ id: nanoid(), branchId, turnId: null, sequence: 0, snapshotJson: original.baseSnapshotJson, summaryText: inheritedSummary, createdAt: now }).run();
    tx.update(sessions).set({ activeBranchId: branchId, updatedAt: now }).where(eq(sessions.id, parent.sessionId)).run();
    tx.insert(settings).values({ key: "active_session_id", value: parent.sessionId, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: parent.sessionId, updatedAt: now } }).run();
  });
  const originalInput = inputFromTurn(original);
  const input: PlayerTurnInput = originalInput.kind === "comment"
    ? { ...originalInput, branchId, text }
    : { ...originalInput, branchId, speechSegments: [text] };
  return submitTurn(input);
}
