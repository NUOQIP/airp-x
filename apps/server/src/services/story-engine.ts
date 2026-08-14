import type { AiTurnOutput, DomainEvent, StorySnapshot } from "@airp/shared";
import { MvuStateSchema } from "@airp/shared";
import { synchronizeDerivedProfileStats } from "./snapshot-normalizer.js";

const clone = <T>(value: T): T => structuredClone(value);
const blockedPathParts = new Set(["__proto__", "prototype", "constructor"]);
const privateHeroineAccountId = "account-heroine";
const coverHeroineAccountId = "account-heroine-cover";
const playerAccountId = "account-player";
const playerHeroineThreadId = "dm-player-heroine";

function getAccount(snapshot: StorySnapshot, id: string) {
  return snapshot.accounts.some((item) => item.id === id);
}

function upsert<T extends { id: string }>(items: T[], value: T) {
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) items.push(value); else items[index] = value;
}

function hashNumber(input: string) {
  let hash = 2166136261;
  for (const char of input) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Math.abs(hash >>> 0);
}

function applyImpact(snapshot: StorySnapshot, event: Extract<DomainEvent, { type: "platform.impact" }>) {
  const bases = { small: 17, medium: 137, large: 1_103 } as const;
  const multipliers = { growth: 1, viral: 5, limited: -0.3, controversy: 2.1, steady: 0.4 } as const;
  const jitter = 0.85 + (hashNumber(event.id) % 31) / 100;
  const amount = Math.round(bases[event.scale] * multipliers[event.kind] * jitter);
  if (event.target === "profile") {
    if (event.targetId !== snapshot.profile.accountId) throw new Error(`Unknown profile target: ${event.targetId}`);
    snapshot.profile.followerCount = Math.max(0, snapshot.profile.followerCount + amount);
    return;
  }
  const post = snapshot.posts.find((item) => item.id === event.targetId);
  if (!post) throw new Error(`Unknown post impact target: ${event.targetId}`);
  const positive = Math.max(0, amount);
  post.metrics.views += positive * 19;
  post.metrics.likes += positive * 3;
  post.metrics.reposts += positive;
  post.metrics.replies += Math.floor(positive / 4);
}

function setAtPath(root: Record<string, unknown>, path: string, operation: "set" | "increment" | "append" | "remove", value?: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => blockedPathParts.has(part))) throw new Error(`Unsafe MVU path: ${path}`);
  if (!(["heroine", "player", "platform", "extensions"] as string[]).includes(parts[0]!)) throw new Error(`MVU path is outside mutable state: ${path}`);
  let current: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const key = parts.at(-1)!;
  if (operation === "set") current[key] = value;
  if (operation === "increment") {
    if (typeof current[key] !== "number" || typeof value !== "number") throw new Error(`MVU increment requires a number: ${path}`);
    current[key] = current[key] + value;
  }
  if (operation === "append") {
    if (!Array.isArray(current[key])) current[key] = [];
    (current[key] as unknown[]).push(value);
  }
  if (operation === "remove") delete current[key];
}

function applyEvent(snapshot: StorySnapshot, event: DomainEvent) {
  switch (event.type) {
    case "account.upsert":
      upsert(snapshot.accounts, event.account.id === privateHeroineAccountId
        ? { ...event.account, isPrivate: true, relationshipLabel: "女主的私密账号" }
        : event.account.id === coverHeroineAccountId
          ? { ...event.account, isPrivate: false, relationshipLabel: "女主的表账号" }
          : event.account);
      return;
    case "post.upsert":
      if (!getAccount(snapshot, event.post.authorId)) throw new Error(`Unknown post author: ${event.post.authorId}`);
      upsert(snapshot.posts, event.post);
      return;
    case "post.remove": {
      const post = snapshot.posts.find((item) => item.id === event.postId);
      if (!post) throw new Error(`Unknown post: ${event.postId}`);
      post.moderation = "deleted";
      return;
    }
    case "comment.upsert":
      if (!snapshot.posts.some((item) => item.id === event.comment.postId)) throw new Error(`Unknown comment post: ${event.comment.postId}`);
      if (!getAccount(snapshot, event.comment.authorId)) throw new Error(`Unknown comment author: ${event.comment.authorId}`);
      if (event.comment.parentId && !snapshot.comments.some((item) => item.id === event.comment.parentId)) throw new Error(`Unknown parent comment: ${event.comment.parentId}`);
      upsert(snapshot.comments, event.comment);
      return;
    case "comment.moderate": {
      const comment = snapshot.comments.find((item) => item.id === event.commentId);
      if (!comment) throw new Error(`Unknown comment: ${event.commentId}`);
      comment.moderation = event.moderation;
      return;
    }
    case "thread.upsert":
      {
        const coverAccount = snapshot.accounts.find((account) => account.id === coverHeroineAccountId);
        const thread = event.thread.id === playerHeroineThreadId && coverAccount
          ? { ...event.thread, title: `${coverAccount.displayName} · @${coverAccount.handle}`, participantIds: [playerAccountId, coverHeroineAccountId] }
          : event.thread;
        for (const participantId of thread.participantIds) if (!getAccount(snapshot, participantId)) throw new Error(`Unknown thread participant: ${participantId}`);
        upsert(snapshot.threads, thread);
      }
      return;
    case "message.add":
      {
        const message = event.message.threadId === playerHeroineThreadId && event.message.senderId === privateHeroineAccountId
          ? { ...event.message, senderId: coverHeroineAccountId }
          : event.message;
        if (!snapshot.threads.some((item) => item.id === message.threadId)) throw new Error(`Unknown message thread: ${message.threadId}`);
        if (!getAccount(snapshot, message.senderId)) throw new Error(`Unknown message sender: ${message.senderId}`);
        upsert(snapshot.messages, message);
      }
      return;
    case "live.upsert":
      if (!getAccount(snapshot, event.live.hostId)) throw new Error(`Unknown live host: ${event.live.hostId}`);
      upsert(snapshot.lives, event.live);
      return;
    case "profile.patch": {
      const patch = event.patch;
      if (patch.bannerTone) snapshot.profile.bannerTone = patch.bannerTone;
      if (patch.location !== undefined) snapshot.profile.location = patch.location;
      if (patch.pinnedPostId !== undefined) snapshot.profile.pinnedPostId = patch.pinnedPostId ?? undefined;
      for (const id of patch.removeSectionIds) snapshot.profile.sections = snapshot.profile.sections.filter((section) => section.id !== id);
      for (const section of patch.upsertSections) upsert(snapshot.profile.sections, section);
      snapshot.profile.sections.sort((a, b) => a.order - b.order);
      return;
    }
    case "poll.resolve": {
      const post = snapshot.posts.find((item) => item.id === event.postId);
      if (!post) throw new Error(`Unknown poll post: ${event.postId}`);
      post.poll = event.poll;
      return;
    }
    case "platform.impact":
      applyImpact(snapshot, event);
      return;
    case "platform.notice":
      upsert(snapshot.notices, event);
      return;
    case "platform.trends":
      snapshot.trends = [...event.trends].sort((a, b) => a.rank - b.rank);
      return;
  }
}

export function applyAiOutput(base: StorySnapshot, output: AiTurnOutput): StorySnapshot {
  const next = clone(base);
  for (const event of output.events) applyEvent(next, event);
  const mutable = next.mvu as unknown as Record<string, unknown>;
  for (const operation of output.mvuOperations) setAtPath(mutable, operation.path, operation.op, "value" in operation ? operation.value : undefined);
  next.mvu.storyTime = output.storyTime;
  next.mvu.revision += 1;
  next.profile.currentStoryTime = output.storyTime;
  next.pendingRenderPlan = output.renderPlan;
  next.mvu = MvuStateSchema.parse(next.mvu);
  return synchronizeDerivedProfileStats(next);
}

export interface RuntimeRuleConstraints {
  minProfileChanges: number;
  minPanels: number;
  maxPanels: number;
  representativeComments?: number;
  requireProfilePanel?: boolean;
  requireStrictRevealOrder?: boolean;
  requireValidPanelTargets?: boolean;
  minLiveQueueItems?: number;
  maxLiveQueueItems?: number;
  requireLiveBarrage?: boolean;
  enforceFixedAccounts?: boolean;
}

export function validateRuleConstraints(base: StorySnapshot, output: AiTurnOutput, rule: RuntimeRuleConstraints) {
  const issues: string[] = [];
  if (output.renderPlan.panels.length < rule.minPanels || output.renderPlan.panels.length > rule.maxPanels) {
    issues.push(`renderPlan.panels must contain ${rule.minPanels}-${rule.maxPanels} panels`);
  }
  if (rule.requireProfilePanel !== false && !output.renderPlan.panels.some((panel) => panel.kind === "profile")) issues.push("renderPlan requires a profile panel");
  if (rule.requireStrictRevealOrder !== false) {
    const revealOrders = output.renderPlan.panels.map((panel) => panel.revealOrder);
    if (new Set(revealOrders).size !== revealOrders.length || revealOrders.some((order, index) => index > 0 && order <= revealOrders[index - 1]!)) issues.push("renderPlan revealOrder must be unique and strictly increasing");
  }
  const profileEvents = output.events.filter((event): event is Extract<DomainEvent, { type: "profile.patch" }> => event.type === "profile.patch");
  const profileCopy = clone(base.profile);
  for (const event of profileEvents) {
    const temporarySnapshot = { ...clone(base), profile: profileCopy };
    applyEvent(temporarySnapshot, event);
  }
  let changes = Number(profileCopy.location !== base.profile.location)
    + Number(profileCopy.bannerTone !== base.profile.bannerTone)
    + Number((profileCopy.pinnedPostId ?? null) !== (base.profile.pinnedPostId ?? null));
  const baseSections = new Map(base.profile.sections.map((section) => [section.id, section]));
  const nextSections = new Map(profileCopy.sections.map((section) => [section.id, section]));
  for (const [id, section] of nextSections) {
    const existing = baseSections.get(id);
    if (!existing) { changes += Math.max(1, section.items.length); continue; }
    changes += Number(existing.title !== section.title || existing.kind !== section.kind || existing.page !== section.page || existing.order !== section.order || existing.mutablePolicy !== section.mutablePolicy);
    const existingItems = new Map(existing.items.map((item) => [item.id, item]));
    const nextItems = new Map(section.items.map((item) => [item.id, item]));
    for (const [itemId, item] of nextItems) {
      const existingItem = existingItems.get(itemId);
      if (!existingItem || existingItem.label !== item.label || existingItem.value !== item.value || existingItem.emphasis !== item.emphasis) changes += 1;
    }
    changes += existing.items.filter((item) => !nextItems.has(item.id)).length;
  }
  changes += base.profile.sections.filter((section) => !nextSections.has(section.id)).length;
  if (changes < rule.minProfileChanges) issues.push(`profile requires at least ${rule.minProfileChanges} field changes; received ${changes}`);
  const newPostEvents = output.events.filter((event): event is Extract<DomainEvent, { type: "post.upsert" }> => event.type === "post.upsert")
    .filter((event) => !base.posts.some((post) => post.id === event.post.id && post.moderation !== "deleted"));
  const newPostIds = new Set(newPostEvents.map((event) => event.post.id));
  for (const postId of newPostIds) {
    const comments = output.events.filter((event) => event.type === "comment.upsert" && event.comment.postId === postId).length;
    const minimum = rule.representativeComments ?? 1;
    if (comments < minimum) issues.push(`post ${postId} requires at least ${minimum} accompanying comments; received ${comments}`);
  }
  for (const event of output.events) {
    if (event.type !== "live.upsert") continue;
    const minimum = rule.minLiveQueueItems ?? 10;
    const maximum = rule.maxLiveQueueItems ?? 25;
    if (event.live.queue.length < minimum || event.live.queue.length > maximum) issues.push(`live ${event.live.id} queue must contain ${minimum}-${maximum} items; received ${event.live.queue.length}`);
    if (rule.requireLiveBarrage !== false && !event.live.queue.some((item) => item.kind === "barrage")) issues.push(`live ${event.live.id} has no barrage item`);
    if (event.live.queue.some((item, index) => index > 0 && item.offsetMs <= event.live.queue[index - 1]!.offsetMs)) issues.push(`live ${event.live.id} offsetMs must be strictly increasing`);
  }
  if (rule.enforceFixedAccounts !== false) {
    const fixed = new Map([
      ["account-heroine", { handle: "BBC_Married_MeatToilet", isPrivate: true }],
      ["account-heroine-cover", { handle: "Marin", isPrivate: false }],
      ["account-player", { handle: "Master", isPrivate: undefined }]
    ]);
    for (const event of output.events) {
      if (event.type !== "account.upsert") continue;
      const expected = fixed.get(event.account.id);
      if (expected && (event.account.handle !== expected.handle || (expected.isPrivate !== undefined && event.account.isPrivate !== expected.isPrivate))) issues.push(`fixed account ${event.account.id} identity does not match its configured handle/privacy`);
      if (!expected && [...fixed.values()].some((identity) => identity.handle.toLocaleLowerCase() === event.account.handle.toLocaleLowerCase())) issues.push(`fixed handle @${event.account.handle} must use its configured account id`);
    }
  }
  if (rule.requireValidPanelTargets !== false) {
    const simulated = clone(base);
    for (const event of output.events) applyEvent(simulated, event);
    for (const panel of output.renderPlan.panels) {
      if (!panel.targetId) {
        if (panel.kind !== "profile") issues.push(`render panel ${panel.id} requires targetId`);
        continue;
      }
      const valid = panel.kind === "profile" ? panel.targetId === simulated.profile.accountId
        : panel.kind === "post" || panel.kind === "comments" || panel.kind === "poll" ? simulated.posts.some((post) => post.id === panel.targetId && post.moderation !== "deleted")
          : panel.kind === "dm" || panel.kind === "group" ? simulated.threads.some((thread) => thread.id === panel.targetId && thread.kind === panel.kind)
            : panel.kind === "live" ? simulated.lives.some((live) => live.id === panel.targetId)
              : simulated.notices.some((notice) => notice.id === panel.targetId);
      if (!valid) issues.push(`render panel ${panel.id} references an invalid target ${panel.targetId}`);
    }
  }
  if (issues.length) throw new Error(issues.join("; "));
}
