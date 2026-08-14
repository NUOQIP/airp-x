import { eq } from "drizzle-orm";
import { HomepageDraftSchema, StorySnapshotSchema, type HomepageDraft } from "@airp/shared";
import { db } from "../db/client.js";
import { branches, checkpoints, turns } from "../db/schema.js";
import { HEROINE_ID, PLAYER_ID, createBlankStorySnapshot, ensureHeroineCoverIdentity } from "../db/defaults.js";
import { generateHomepageDraft } from "./ai-client.js";
import { getRuntimeSettings } from "./config-service.js";
import { ContextBudgetError, type ContextBreakdown } from "./context-service.js";
import { getAppSnapshot } from "./turn-service.js";
import { withBranchLock } from "./branch-lock.js";
import { conflict, notFound } from "./http-error.js";
import { migrateStorySnapshotV2 } from "./snapshot-migration.js";
import { storyTimeMinusDays } from "./state-derived-service.js";

const estimateTokens = (text: string) => Math.ceil(text.length / 3.2);

export async function previewHomepage(sourceText: string): Promise<HomepageDraft> {
  const text = sourceText.trim();
  const settings = await getRuntimeSettings();
  const inputTokens = estimateTokens(text);
  const instructionTokens = 220;
  const availableTokens = settings.contextWindow - Math.min(settings.maxOutputTokens, 16_384);
  if (inputTokens + instructionTokens > availableTokens) {
    const breakdown: ContextBreakdown[] = [
      { label: "主页自然语言", estimatedTokens: inputTokens, mandatory: true },
      { label: "主页结构化指令", estimatedTokens: instructionTokens, mandatory: true }
    ];
    throw new ContextBudgetError(breakdown, availableTokens);
  }
  const draft = await generateHomepageDraft(text, settings);
  draft.profile.postCount = 0;
  return draft;
}

export async function applyHomepageDraft(branchId: string, sourceText: string, inputDraft: HomepageDraft) {
  return withBranchLock(branchId, () => applyHomepageDraftUnlocked(branchId, sourceText, inputDraft));
}

async function applyHomepageDraftUnlocked(branchId: string, sourceText: string, inputDraft: HomepageDraft) {
  const draft = HomepageDraftSchema.parse(inputDraft);
  const [branch, firstTurn] = await Promise.all([
    db.select().from(branches).where(eq(branches.id, branchId)).limit(1).then((rows) => rows[0]),
    db.select({ id: turns.id }).from(turns).where(eq(turns.branchId, branchId)).limit(1).then((rows) => rows[0])
  ]);
  if (!branch) throw notFound("分支不存在", "BRANCH_NOT_FOUND");
  if (firstTurn) throw conflict("当前分支已有剧情回合，请先新建空白会话再建设主页", "HOMEPAGE_ALREADY_STARTED");

  const current = StorySnapshotSchema.parse(JSON.parse(branch.currentSnapshotJson));
  const fallback = createBlankStorySnapshot();
  const player = current.accounts.find((account) => account.id === PLAYER_ID)
    ?? fallback.accounts.find((account) => account.id === PLAYER_ID)!;
  const storyTime = draft.profile.currentStoryTime;
  const next = migrateStorySnapshotV2({
    accounts: [
      {
        id: HEROINE_ID,
        displayName: draft.account.displayName,
        handle: draft.account.handle,
        avatarSeed: `profile-${draft.account.handle}`,
        verified: draft.account.verified,
        bio: draft.account.bio,
        isPrivate: draft.account.isPrivate,
        relationshipLabel: "故事主角"
      },
      player
    ],
    profile: {
      accountId: HEROINE_ID,
      bannerTone: draft.profile.bannerTone,
      location: draft.profile.location,
      joinedAt: draft.profile.joinedAt,
      followerCount: draft.profile.followerCount,
      postCount: 0,
      currentStoryTime: storyTime,
      sections: [...draft.profile.sections].sort((a, b) => a.order - b.order)
    },
    posts: [],
    comments: [],
    threads: [{
      id: "dm-player-heroine",
      kind: "dm",
      title: draft.account.displayName,
      participantIds: [PLAYER_ID, HEROINE_ID],
      playerCanSend: true,
      updatedAt: storyTime,
      unreadCount: 0
    }],
    messages: [],
    lives: [],
    mvu: {
      revision: current.mvu.revision + 1,
      storyTime,
      heroine: {
        status: draft.heroineState.status,
        bio: draft.account.bio,
        usageNotice: {},
        profileFacts: {},
        mood: draft.heroineState.mood,
        location: draft.heroineState.location,
        activity: draft.heroineState.activity,
        outfit: draft.heroineState.outfit,
        cycle: {
          anchorDate: storyTimeMinusDays(storyTime, 3),
          pregnancy: draft.heroineState.pregnancy
        },
        statistics: { inseminationEvents: [] },
        relationship: current.mvu.heroine.relationship
      },
      player: current.mvu.player,
      platform: {
        activeTrends: [],
        appliedImpactIds: [],
        impactLedger: [],
        fanGoals: draft.fanGoals,
        flags: {}
      },
      extensions: {
        ...current.mvu.extensions,
        homepageConfigured: true,
        homepageSource: sourceText
      },
      derived: current.mvu.derived
    },
    trends: [],
    notices: []
  });

  const now = new Date().toISOString();
  const snapshotJson = JSON.stringify(ensureHeroineCoverIdentity(next));
  db.transaction((tx) => {
    tx.update(branches).set({
      currentSnapshotJson: snapshotJson,
      rollingSummary: "",
      pendingActionsJson: "[]",
      updatedAt: now
    }).where(eq(branches.id, branchId)).run();
    tx.update(checkpoints).set({
      snapshotJson,
      summaryText: "",
      createdAt: now
    }).where(eq(checkpoints.branchId, branchId)).run();
  });
  return getAppSnapshot(branchId);
}
