import { z } from "zod";

const id = z.string().min(1).max(96);
const plainText = z.string().max(12_000);
const shortText = z.string().max(280);
const storyTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:\d{2})?$/);

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const safeSourcePart = (value: unknown, fallback: string) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) ? value : fallback;

const invalidAvatarControls = /[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

export const AvatarTextSchema = z.string().trim().max(64).refine((value) => {
  if (!value) return false;
  if (invalidAvatarControls.test(value) || /^[\p{M}\p{Cf}]+$/u.test(value)) return false;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
  return graphemes.length <= 2 && graphemes.every((item) => /[\p{L}\p{N}\p{S}]/u.test(item.segment));
}, "Avatar text must contain 1–2 visible characters");

export const AccountSchema = z.object({
  id,
  displayName: z.string().min(1).max(80),
  handle: z.string().regex(/^[A-Za-z0-9_]{1,30}$/),
  avatarSeed: z.string().max(120).default("default"),
  avatarText: AvatarTextSchema.optional(),
  avatarUrl: z.string().max(750_000).optional(),
  verified: z.boolean().default(false),
  bio: z.string().max(1_000).default(""),
  isPrivate: z.boolean().default(false),
  relationshipLabel: z.string().max(120).optional()
}).strict();

export const MetricsSchema = z.object({
  replies: z.number().int().nonnegative().default(0),
  reposts: z.number().int().nonnegative().default(0),
  likes: z.number().int().nonnegative().default(0),
  views: z.number().int().nonnegative().default(0),
  bookmarks: z.number().int().nonnegative().default(0)
}).strict();

export const TextMediaSchema = z.object({
  id,
  kind: z.enum(["image", "video", "live_replay"]),
  title: z.string().max(160).optional(),
  description: plainText,
  altText: z.string().max(1_000).optional(),
  durationSeconds: z.number().int().positive().max(86_400).optional(),
  subtitle: z.string().max(500).optional(),
  tone: z.enum(["neutral", "warm", "dramatic", "night", "alert"]).default("neutral")
}).strict();

export const PollSchema = z.object({
  id,
  question: z.string().min(1).max(280),
  options: z.array(z.object({
    id,
    label: z.string().min(1).max(100),
    votes: z.number().int().nonnegative()
  }).strict()).min(2).max(4),
  endsAt: storyTime,
  closed: z.boolean().default(false),
  playerChoiceId: id.optional()
}).strict();

export const PostSchema = z.object({
  id,
  authorId: id,
  createdAt: storyTime,
  text: plainText,
  replyToPostId: id.optional(),
  quotedPostId: id.optional(),
  media: z.array(TextMediaSchema).max(4).default([]),
  poll: PollSchema.optional(),
  metrics: MetricsSchema,
  pinned: z.boolean().default(false),
  visibility: z.enum(["public", "followers", "private_setting"]).default("public"),
  moderation: z.enum(["visible", "limited", "hidden", "deleted"]).default("visible")
}).strict();

export const CommentSchema = z.object({
  id,
  postId: id,
  parentId: id.optional(),
  authorId: id,
  createdAt: storyTime,
  text: plainText,
  metrics: MetricsSchema,
  moderation: z.enum(["visible", "limited", "hidden", "deleted"]).default("visible")
}).strict();

export const MessageSchema = z.object({
  id,
  threadId: id,
  senderId: id,
  createdAt: storyTime,
  text: plainText,
  status: z.enum(["sent", "delivered", "read"]).default("read"),
  replyToMessageId: id.optional(),
  isPlayerInput: z.boolean().default(false),
  turnId: id.optional(),
  bubbleOrder: z.number().int().nonnegative().optional()
}).strict();

export const ThreadSchema = z.object({
  id,
  kind: z.enum(["dm", "group"]),
  title: z.string().min(1).max(120),
  participantIds: z.array(id).min(2).max(50),
  playerCanSend: z.boolean(),
  updatedAt: storyTime,
  unreadCount: z.number().int().nonnegative().default(0)
}).strict();

export const LiveQueueItemSchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("host"), offsetMs: z.number().int().nonnegative(), text: plainText }).strict(),
  z.object({ id, kind: z.literal("barrage"), offsetMs: z.number().int().nonnegative(), accountId: id, text: shortText }).strict(),
  z.object({ id, kind: z.literal("gift"), offsetMs: z.number().int().nonnegative(), accountId: id, giftName: z.string().max(80), amount: z.number().nonnegative(), currency: z.string().max(12) }).strict(),
  z.object({ id, kind: z.literal("superchat"), offsetMs: z.number().int().nonnegative(), accountId: id, text: shortText, amount: z.number().nonnegative(), currency: z.string().max(12) }).strict(),
  z.object({ id, kind: z.literal("viewer_count"), offsetMs: z.number().int().nonnegative(), viewers: z.number().int().nonnegative() }).strict(),
  z.object({ id, kind: z.literal("system"), offsetMs: z.number().int().nonnegative(), text: shortText }).strict()
]);

export const LiveSessionSchema = z.object({
  id,
  hostId: id,
  title: z.string().min(1).max(200),
  startedAt: storyTime,
  endedAt: storyTime.optional(),
  status: z.enum(["scheduled", "live", "ended"]),
  sceneDescription: plainText,
  viewerCount: z.number().int().nonnegative(),
  queue: z.array(LiveQueueItemSchema).max(500)
}).strict();

export const ProfilePermissionSchema = z.enum(["locked", "temporary", "computed", "append_only"]);
export const ProfileContentOriginSchema = z.enum(["initial", "ai"]);
export const ProfileItemSourceSchema = z.object({
  kind: z.enum(["literal", "mvu", "derived", "profile", "platform", "event_log"]),
  path: z.string().min(1).max(240).regex(/^[A-Za-z0-9_.-]+$/)
}).strict();

const legacyPermission = (value: unknown, kind: unknown) => {
  if (value === "computed") return "computed" as const;
  if (value === "temporary" || value === "ai_mutable") return kind === "timeline" ? "append_only" as const : "temporary" as const;
  return kind === "timeline" ? "append_only" as const : "locked" as const;
};

const legacyPage = (value: unknown, kind: unknown) => {
  if (value === "sidebar" || value === "bio" || value === "records") return value;
  if (value === "live") return "sidebar" as const;
  if (value === "about") return kind === "notice" ? "bio" as const : "records" as const;
  if (kind === "status" || kind === "progress") return "sidebar" as const;
  if (kind === "notice") return "bio" as const;
  return "records" as const;
};

const knownTemporarySources: Record<string, string> = {
  "status-status": "heroine.status",
  "status-current": "heroine.status",
  "current-status": "heroine.status",
  "status-location": "heroine.location",
  "status-activity": "heroine.activity",
  "current-activity": "heroine.activity",
  "status-outfit": "heroine.outfit",
  "current-outfit": "heroine.outfit",
  "status-mood": "heroine.mood",
  "current-mood": "heroine.mood"
};

function migrateLegacyProfileSection(value: unknown) {
  if (!isRecord(value)) return value;
  const sectionId = safeSourcePart(value.id, "section");
  const sectionOrigin = value.origin === "ai" ? "ai" : "initial";
  const permission = legacyPermission(value.mutablePolicy, value.kind);
  const items = Array.isArray(value.items) ? value.items.map((rawItem, index) => {
    if (!isRecord(rawItem)) return rawItem;
    const itemId = safeSourcePart(rawItem.id, `item-${index}`);
    const itemPermission = ProfilePermissionSchema.safeParse(rawItem.permission).success ? rawItem.permission : permission;
    let source = rawItem.source;
    if (!isRecord(source)) {
      if (itemPermission === "temporary") {
        const path = knownTemporarySources[itemId] ?? `extensions.profileTemporary.${sectionId}.${itemId}`;
        source = { kind: "mvu", path };
      } else if (itemPermission === "computed") {
        source = { kind: "derived", path: `profile.${sectionId}.${itemId}` };
      } else if (itemPermission === "append_only") {
        source = { kind: "event_log", path: `profile.sections.${sectionId}.items` };
      } else {
        source = { kind: "literal", path: `profile.sections.${sectionId}.items.${itemId}.value` };
      }
    }
    return {
      ...rawItem,
      permission: itemPermission,
      origin: rawItem.origin === "ai" ? "ai" : sectionOrigin,
      source
    };
  }) : value.items;
  const { mutablePolicy: _legacyMutablePolicy, ...rest } = value;
  return { ...rest, page: legacyPage(value.page, value.kind), origin: sectionOrigin, items };
}

export const ProfileSectionItemSchema = z.object({
  id,
  label: z.string().max(120).optional(),
  value: plainText,
  emphasis: z.enum(["normal", "accent", "success", "warning", "danger"]).default("normal"),
  permission: ProfilePermissionSchema,
  origin: ProfileContentOriginSchema,
  source: ProfileItemSourceSchema
}).strict();

export const ProfileSectionSchema = z.preprocess(migrateLegacyProfileSection, z.object({
  id,
  title: z.string().min(1).max(100),
  kind: z.enum(["facts", "stats", "progress", "timeline", "status", "notice"]),
  page: z.enum(["sidebar", "bio", "records"]),
  order: z.number().int(),
  origin: ProfileContentOriginSchema,
  items: z.array(ProfileSectionItemSchema).max(50)
}).strict());

function migrateLegacyProfile(value: unknown) {
  if (!isRecord(value)) return value;
  const { followingCount: _legacyFollowingCount, ...rest } = value;
  return rest;
}

export const HeroineProfileSchema = z.preprocess(migrateLegacyProfile, z.object({
  accountId: id,
  bannerTone: z.enum(["sky", "rose", "violet", "amber", "night"]).default("sky"),
  bannerUrl: z.string().max(750_000).optional(),
  location: z.string().max(120).default(""),
  joinedAt: z.string().max(40).default(""),
  followerCount: z.number().int().nonnegative(),
  postCount: z.number().int().nonnegative(),
  currentStoryTime: storyTime,
  pinnedPostId: id.optional(),
  sections: z.array(ProfileSectionSchema).max(30)
}).strict());

export const InseminationRecordSchema = z.object({
  id,
  occurredAt: storyTime,
  count: z.number().int().positive(),
  volumeMl: z.number().int().nonnegative(),
  note: z.string().max(1_000).optional()
}).strict();

export const CyclePregnancySchema = z.object({
  status: z.enum(["none", "suspected", "confirmed", "ended"]),
  suspectedAt: storyTime.optional(),
  confirmedAt: storyTime.optional(),
  conceptionAt: storyTime.optional(),
  durationDays: z.number().int().min(1).max(2_000).optional(),
  endedAt: storyTime.optional()
}).strict().superRefine((value, context) => {
  if (value.status === "confirmed" && (!value.confirmedAt || !value.conceptionAt || !value.durationDays)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "confirmed pregnancy requires confirmedAt, conceptionAt and durationDays" });
  }
  if (value.status === "ended" && !value.endedAt) context.addIssue({ code: z.ZodIssueCode.custom, message: "ended pregnancy requires endedAt" });
});

export const FanGoalSchema = z.object({
  id,
  targetFollowers: z.number().int().positive(),
  reward: z.string().max(4_000),
  createdAt: storyTime
}).strict();

export const PlatformImpactLedgerEntrySchema = z.object({
  id,
  target: z.enum(["profile", "post"]),
  targetId: id,
  kind: z.enum(["growth", "viral", "limited", "controversy", "controversy_positive", "controversy_negative", "steady", "backlash"]),
  scale: z.enum(["small", "medium", "large"]),
  exposure: z.number().int().nonnegative(),
  followerDelta: z.number().int(),
  metricsDelta: MetricsSchema,
  appliedAt: storyTime
}).strict();

export const DerivedCycleSchema = z.object({
  phase: z.enum(["menstruation", "follicular", "ovulation", "luteal", "suspected", "pregnant"]),
  cycleDay: z.number().int().min(1).max(7),
  nextChangeAt: storyTime,
  pregnancy: z.object({
    status: z.enum(["confirmed"]),
    elapsedDays: z.number().int().nonnegative(),
    durationDays: z.number().int().positive(),
    progressPercent: z.number().min(0).max(100),
    stage: z.enum(["early", "middle", "late"]),
    nextChangeAt: storyTime
  }).strict().optional()
}).strict();

export const DerivedStatisticsSchema = z.object({
  todayCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  totalVolumeMl: z.number().int().nonnegative(),
  nextDailyResetAt: storyTime,
  lastRecord: InseminationRecordSchema.optional()
}).strict();

export const DerivedFanPlanSchema = z.object({
  activeGoalId: id,
  targetFollowers: z.number().int().positive(),
  currentFollowers: z.number().int().nonnegative(),
  progressPercent: z.number().min(0).max(100),
  reward: z.string().max(4_000),
  completed: z.boolean(),
  nextTargetFollowers: z.number().int().positive().optional()
}).strict();

export const DerivedCorruptionSchema = z.object({
  score: z.number().int().min(1).max(100),
  range: z.string().regex(/^\d{1,3}-\d{1,3}$/),
  label: z.string().min(1).max(40),
  description: z.string().min(1).max(500),
  nextStageAtFollowers: z.number().int().positive().optional()
}).strict();

function migrateLegacyMvu(value: unknown) {
  if (!isRecord(value)) return value;
  const heroine = isRecord(value.heroine) ? { ...value.heroine } : {};
  const platform = isRecord(value.platform) ? { ...value.platform } : {};
  const extensions = isRecord(value.extensions) ? value.extensions : {};
  const story = typeof value.storyTime === "string" ? value.storyTime : "2026-01-01T00:00+08:00";
  heroine.status ??= "";
  heroine.bio ??= "";
  heroine.usageNotice ??= {};
  heroine.profileFacts ??= {};
  heroine.cycle ??= { anchorDate: story, pregnancy: { status: "none" } };
  heroine.statistics ??= { inseminationEvents: [] };
  platform.appliedImpactIds ??= [];
  platform.impactLedger ??= [];
  platform.fanGoals ??= [];
  const derived: Record<string, unknown> = isRecord(value.derived) ? { ...value.derived } : {
    cycle: { phase: "menstruation", cycleDay: 1, nextChangeAt: story },
    statistics: { todayCount: 0, totalCount: 0, totalVolumeMl: 0, nextDailyResetAt: story }
  };
  derived.corruption ??= {
    score: 1,
    range: "1-10",
    label: "试探期",
    description: "账号刚起步，对越界表达仍以试探、暗示和保留退路为主。",
    nextStageAtFollowers: 11_000
  };
  return { ...value, heroine, platform, extensions, derived };
}

export const MvuStateSchema = z.preprocess(migrateLegacyMvu, z.object({
  revision: z.number().int().nonnegative(),
  storyTime,
  heroine: z.object({
    status: z.string().max(500),
    bio: z.string().max(1_000),
    usageNotice: z.record(z.string(), plainText),
    profileFacts: z.record(z.string(), plainText),
    mood: z.string().max(500).default(""),
    location: z.string().max(120).default(""),
    activity: z.string().max(500).default(""),
    outfit: z.string().max(1_000).default(""),
    cycle: z.object({
      anchorDate: storyTime,
      pregnancy: CyclePregnancySchema
    }).strict(),
    statistics: z.object({
      inseminationEvents: z.array(InseminationRecordSchema).max(20_000)
    }).strict(),
    relationship: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
  }).strict(),
  player: z.object({
    relationship: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
  }).strict(),
  platform: z.object({
    activeTrends: z.array(z.string().max(100)).max(20).default([]),
    appliedImpactIds: z.array(id).max(20_000),
    impactLedger: z.array(PlatformImpactLedgerEntrySchema).max(20_000),
    fanGoals: z.array(FanGoalSchema).max(100),
    flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
  }).strict(),
  extensions: z.record(z.string(), z.unknown()).default({}),
  derived: z.object({
    cycle: DerivedCycleSchema,
    statistics: DerivedStatisticsSchema,
    fanPlan: DerivedFanPlanSchema.optional(),
    corruption: DerivedCorruptionSchema
  }).strict()
}).strict());

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const MvuOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: z.string().regex(/^[A-Za-z0-9_.-]+$/), value: z.unknown() }).strict(),
  z.object({ op: z.literal("increment"), path: z.string().regex(/^[A-Za-z0-9_.-]+$/), value: z.number() }).strict(),
  z.object({ op: z.literal("append"), path: z.string().regex(/^[A-Za-z0-9_.-]+$/), value: ScalarSchema }).strict(),
  z.object({ op: z.literal("remove"), path: z.string().regex(/^[A-Za-z0-9_.-]+$/) }).strict()
]);

const computedMetricsDefault = { replies: 0, reposts: 0, likes: 0, views: 0, bookmarks: 0 } as const;
const AiCreatedPostSchema = PostSchema.extend({ metrics: MetricsSchema.default(computedMetricsDefault) });
const AiCreatedCommentSchema = CommentSchema.extend({ metrics: MetricsSchema.default(computedMetricsDefault) });
const UpsertAccountEvent = z.object({ type: z.literal("account.upsert"), account: AccountSchema }).strict();
const UpsertPostEvent = z.object({ type: z.literal("post.upsert"), post: AiCreatedPostSchema }).strict();
const RemovePostEvent = z.object({ type: z.literal("post.remove"), postId: id, reason: z.string().max(240).optional() }).strict();
const ModeratePostEvent = z.object({ type: z.literal("post.moderate"), postId: id, moderation: z.enum(["visible", "limited", "hidden", "deleted"]) }).strict();
const UpsertCommentEvent = z.object({ type: z.literal("comment.upsert"), comment: AiCreatedCommentSchema }).strict();
const ModerateCommentEvent = z.object({ type: z.literal("comment.moderate"), commentId: id, moderation: z.enum(["visible", "limited", "hidden", "deleted"]) }).strict();
const UpsertThreadEvent = z.object({ type: z.literal("thread.upsert"), thread: ThreadSchema }).strict();
const AddMessageEvent = z.object({ type: z.literal("message.add"), message: MessageSchema }).strict();
const UpsertLiveEvent = z.object({ type: z.literal("live.upsert"), live: LiveSessionSchema }).strict();
const ProfilePatchEvent = z.object({
  type: z.literal("profile.patch"),
  patch: z.object({
    bannerTone: z.enum(["sky", "rose", "violet", "amber", "night"]).optional(),
    location: z.string().max(120).optional(),
    pinnedPostId: id.nullable().optional(),
    upsertSections: z.array(ProfileSectionSchema).max(12).default([]),
    removeSectionIds: z.array(id).max(12).default([])
  }).strict()
}).strict();
const AppendProfileItemEvent = z.object({
  type: z.literal("profile.item.append"),
  sectionId: id,
  item: ProfileSectionItemSchema
}).strict();
const RemoveProfileItemEvent = z.object({
  type: z.literal("profile.item.remove"),
  sectionId: id,
  itemId: id
}).strict();
const AddProfileItemEvent = z.object({
  type: z.literal("profile.item.add"),
  sectionId: id,
  item: ProfileSectionItemSchema
}).strict();
const AppendInseminationRecordEvent = z.object({
  type: z.literal("statistics.insemination.append"),
  record: InseminationRecordSchema
}).strict();
const AddFanGoalEvent = z.object({
  type: z.literal("fan.goal.add"),
  goal: FanGoalSchema
}).strict();
const UpsertFanGoalEvent = z.object({
  type: z.literal("fan.goal.upsert"),
  goal: FanGoalSchema
}).strict();
const PollVoteEvent = z.object({ type: z.literal("poll.resolve"), postId: id, poll: PollSchema }).strict();
const PlatformImpactEvent = z.object({
  type: z.literal("platform.impact"),
  id,
  target: z.enum(["profile", "post"]),
  targetId: id,
  kind: z.enum(["growth", "viral", "limited", "controversy", "controversy_positive", "controversy_negative", "steady", "backlash"]),
  scale: z.enum(["small", "medium", "large"])
}).strict();
const PlatformNoticeEvent = z.object({ type: z.literal("platform.notice"), id, level: z.enum(["info", "success", "warning", "danger"]), text: plainText, createdAt: storyTime }).strict();
const TrendEvent = z.object({ type: z.literal("platform.trends"), trends: z.array(z.object({ label: z.string().max(100), volumeLabel: z.string().max(60), rank: z.number().int().positive() }).strict()).max(20) }).strict();
const UpsertTrendEvent = z.object({
  type: z.literal("platform.trend.upsert"),
  trend: z.object({
    id,
    label: z.string().min(1).max(100),
    heat: z.enum(["low", "medium", "high", "viral"]),
    updatedAt: storyTime
  }).strict()
}).strict();
const RemoveTrendEvent = z.object({ type: z.literal("platform.trend.remove"), trendId: id }).strict();

export const DomainEventSchema = z.discriminatedUnion("type", [
  UpsertAccountEvent,
  UpsertPostEvent,
  RemovePostEvent,
  ModeratePostEvent,
  UpsertCommentEvent,
  ModerateCommentEvent,
  UpsertThreadEvent,
  AddMessageEvent,
  UpsertLiveEvent,
  ProfilePatchEvent,
  AppendProfileItemEvent,
  AddProfileItemEvent,
  RemoveProfileItemEvent,
  AppendInseminationRecordEvent,
  AddFanGoalEvent,
  UpsertFanGoalEvent,
  PollVoteEvent,
  PlatformImpactEvent,
  PlatformNoticeEvent,
  TrendEvent,
  UpsertTrendEvent,
  RemoveTrendEvent
]);

export const RenderPlanSchema = z.object({
  panels: z.array(z.object({
    id,
    kind: z.enum(["profile", "post", "comments", "dm", "group", "live", "poll", "notice"]),
    targetId: id.optional(),
    revealOrder: z.number().int().nonnegative(),
    delayMs: z.number().int().min(0).max(8_000)
  }).strict()).min(0).max(8),
  focus: z.object({ kind: z.enum(["home", "post", "dm", "group", "live"]), targetId: id.optional() }).strict().optional()
}).strict();

export const TrendSchema = z.preprocess((value) => {
  if (!isRecord(value)) return value;
  const label = typeof value.label === "string" ? value.label : "trend";
  const volumeMatch = typeof value.volumeLabel === "string" ? value.volumeLabel.replace(/,/g, "").match(/[\d.]+/) : undefined;
  const parsedVolume = volumeMatch ? Number(volumeMatch[0]) * (/K/i.test(value.volumeLabel as string) ? 1_000 : 1) : 0;
  return {
    ...value,
    id: value.id ?? `trend-${safeSourcePart(label.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-"), "legacy")}`,
    heatScore: value.heatScore ?? Math.max(1, Math.round(parsedVolume)),
    updatedAt: value.updatedAt ?? "2026-01-01T00:00+08:00"
  };
}, z.object({
  id,
  label: z.string().max(100),
  volumeLabel: z.string().max(60),
  rank: z.number().int().positive(),
  heatScore: z.number().int().nonnegative(),
  updatedAt: storyTime
}).strict());

export const StorySnapshotSchema = z.object({
  accounts: z.array(AccountSchema),
  profile: HeroineProfileSchema,
  posts: z.array(PostSchema),
  comments: z.array(CommentSchema),
  threads: z.array(ThreadSchema),
  messages: z.array(MessageSchema),
  lives: z.array(LiveSessionSchema),
  mvu: MvuStateSchema,
  trends: z.array(TrendSchema).max(20),
  notices: z.array(z.object({
    id,
    level: z.enum(["info", "success", "warning", "danger"]),
    text: plainText,
    createdAt: storyTime
  }).strict()),
  pendingRenderPlan: RenderPlanSchema.optional()
}).strict();

export const AiTurnOutputSchema = z.object({
  schemaVersion: z.literal("1.0"),
  storyTime,
  events: z.array(DomainEventSchema).max(100),
  mvuOperations: z.array(MvuOperationSchema).max(100),
  renderPlan: RenderPlanSchema,
  memoryNote: z.string().max(4_000).optional()
}).strict();

const SpeechTurnInputSchema = z.object({
  kind: z.enum(["dm", "group"]),
  branchId: id,
  threadId: id,
  replyToMessageId: id.optional(),
  speechSegments: z.array(z.string().trim().min(1).max(12_000)).max(20),
  directorInstruction: z.string().trim().max(12_000).optional()
}).strict().superRefine((value, context) => {
  if (value.speechSegments.length === 0 && !value.directorInstruction) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "speechSegments or directorInstruction is required" });
  }
  const totalLength = value.speechSegments.reduce((sum, segment) => sum + segment.length, 0) + (value.directorInstruction?.length ?? 0);
  if (totalLength > 12_000) context.addIssue({ code: z.ZodIssueCode.custom, message: "speechSegments and directorInstruction must total at most 12000 characters" });
});

export const PlayerTurnInputSchema = z.union([
  z.object({ kind: z.literal("comment"), branchId: id, postId: id, parentCommentId: id.optional(), text: z.string().min(1).max(12_000) }).strict(),
  SpeechTurnInputSchema
]);

export const LocalActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("like"), branchId: id, postId: id, active: z.boolean() }).strict(),
  z.object({ kind: z.literal("repost"), branchId: id, postId: id, active: z.boolean() }).strict(),
  z.object({ kind: z.literal("bookmark"), branchId: id, postId: id, active: z.boolean() }).strict(),
  z.object({ kind: z.literal("follow"), branchId: id, accountId: id, active: z.boolean() }).strict(),
  z.object({ kind: z.literal("poll_vote"), branchId: id, postId: id, optionId: id }).strict()
]);

export const WorldbookEntrySchema = z.object({
  id,
  bookId: id,
  title: z.string().min(1).max(160),
  content: plainText,
  enabled: z.boolean(),
  constant: z.boolean(),
  primaryKeys: z.array(z.string().max(100)).max(100),
  secondaryKeys: z.array(z.string().max(100)).max(100),
  secondaryLogic: z.enum(["and_any", "and_all", "not_any", "not_all"]),
  scanDepth: z.number().int().min(0).max(100),
  recursive: z.boolean(),
  probability: z.number().int().min(0).max(100),
  ignoreBudget: z.boolean(),
  order: z.number().int(),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
  role: z.enum(["system", "user", "assistant"]),
  position: z.enum(["before_cards", "after_cards", "before_history", "after_history", "author_note_top", "author_note_bottom", "at_depth"]),
  injectionDepth: z.number().int().min(0).max(100)
}).strict();

export const PromptBlockSchema = z.object({
  id,
  name: z.string().min(1).max(160),
  role: z.enum(["system", "user", "assistant"]),
  content: plainText,
  enabled: z.boolean(),
  order: z.number().int(),
  injectionPosition: z.enum(["relative", "in_chat"]),
  injectionDepth: z.number().int().min(0).max(100),
  protected: z.boolean().default(false)
}).strict();

export const PromptStackMarkerSchema = z.enum([
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
]);

export const PromptPresetItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prompt"), promptId: id, enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal("marker"), marker: PromptStackMarkerSchema, enabled: z.boolean() }).strict()
]);

export const PromptPresetSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  items: z.array(PromptPresetItemSchema).min(1).max(100)
}).strict();

export const PromptPresetStateSchema = z.object({
  activePresetId: id,
  presets: z.array(PromptPresetSchema).min(1).max(30)
}).strict();

export const RuntimeSettingsSchema = z.object({
  apiBaseUrl: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "API Base URL 仅支持 http 或 https"),
  apiKey: z.string(),
  model: z.string(),
  thinkingMode: z.enum(["enabled", "disabled"]),
  reasoningEffort: z.enum(["high", "max"]),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(256).max(65_536),
  topP: z.number().min(0).max(1),
  frequencyPenalty: z.number().min(-2).max(2),
  presencePenalty: z.number().min(-2).max(2),
  contextWindow: z.number().int().min(4_096).max(2_000_000),
  recentHistoryMessages: z.number().int().min(2).max(200),
  summaryTargetWords: z.number().int().min(50).max(4_000)
}).strict();

export const UserMacroSchema = z.object({
  id,
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
  value: z.string().max(20_000),
  scope: z.enum(["global", "player", "heroine", "session"]),
  enabled: z.boolean()
}).strict();

export const RegexRuleSchema = z.object({
  id,
  name: z.string().min(1).max(160),
  pattern: z.string().min(1).max(1_000),
  replacement: z.string().max(4_000),
  flags: z.string().regex(/^[gimsu]*$/),
  field: z.enum(["account_text", "post_text", "comment_text", "message_text", "profile_text", "media_text", "live_text", "notice_text"]),
  enabled: z.boolean(),
  order: z.number().int()
}).strict();

export const HomepageDraftSchema = z.object({
  schemaVersion: z.literal("1.0"),
  account: z.object({
    displayName: z.string().min(1).max(80),
    handle: z.string().regex(/^[A-Za-z0-9_]{1,30}$/),
    bio: z.string().max(1_000),
    verified: z.boolean(),
    isPrivate: z.boolean()
  }).strict(),
  profile: z.object({
    bannerTone: z.enum(["sky", "rose", "violet", "amber", "night"]),
    location: z.string().max(120),
    joinedAt: z.string().max(40),
    followerCount: z.number().int().nonnegative(),
    postCount: z.number().int().nonnegative(),
    currentStoryTime: storyTime,
    sections: z.array(ProfileSectionSchema).min(1).max(30)
  }).strict(),
  heroineState: z.object({
    status: z.string().max(500).default(""),
    mood: z.string().max(500),
    location: z.string().max(120),
    activity: z.string().max(500),
    outfit: z.string().max(1_000),
    pregnancy: CyclePregnancySchema.default({ status: "none" })
  }).strict(),
  fanGoals: z.array(FanGoalSchema).max(100).default([]),
  notes: z.array(z.string().max(500)).max(20)
}).strict();

export type Account = z.infer<typeof AccountSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type TextMedia = z.infer<typeof TextMediaSchema>;
export type Poll = z.infer<typeof PollSchema>;
export type Post = z.infer<typeof PostSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type LiveSession = z.infer<typeof LiveSessionSchema>;
export type LiveQueueItem = z.infer<typeof LiveQueueItemSchema>;
export type HeroineProfile = z.infer<typeof HeroineProfileSchema>;
export type ProfileSection = z.infer<typeof ProfileSectionSchema>;
export type ProfileSectionItem = z.infer<typeof ProfileSectionItemSchema>;
export type ProfilePermission = z.infer<typeof ProfilePermissionSchema>;
export type MvuState = z.infer<typeof MvuStateSchema>;
export type InseminationRecord = z.infer<typeof InseminationRecordSchema>;
export type FanGoal = z.infer<typeof FanGoalSchema>;
export type Trend = z.infer<typeof TrendSchema>;
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type AiTurnOutput = z.infer<typeof AiTurnOutputSchema>;
export type PlayerTurnInput = z.infer<typeof PlayerTurnInputSchema>;
export type LocalAction = z.infer<typeof LocalActionSchema>;
export type WorldbookEntry = z.infer<typeof WorldbookEntrySchema>;
export type PromptBlock = z.infer<typeof PromptBlockSchema>;
export type PromptStackMarker = z.infer<typeof PromptStackMarkerSchema>;
export type PromptPresetItem = z.infer<typeof PromptPresetItemSchema>;
export type PromptPreset = z.infer<typeof PromptPresetSchema>;
export type PromptPresetState = z.infer<typeof PromptPresetStateSchema>;
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;
export type UserMacro = z.infer<typeof UserMacroSchema>;
export type RegexRule = z.infer<typeof RegexRuleSchema>;
export type HomepageDraft = z.infer<typeof HomepageDraftSchema>;
