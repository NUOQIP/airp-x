import type { AiTurnOutput, DomainEvent, Metrics, StorySnapshot } from "@airp/shared";
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

function fraction(id: string, salt: string) {
  return (hashNumber(`${id}:${salt}`) % 10_001) / 10_000;
}

function between(id: string, salt: string, minimum: number, maximum: number) {
  return minimum + (maximum - minimum) * fraction(id, salt);
}

function zeroMetrics(): Metrics {
  return { replies: 0, reposts: 0, likes: 0, views: 0, bookmarks: 0 };
}

const positiveKind = (kind: Extract<DomainEvent, { type: "platform.impact" }>["kind"]) => kind === "controversy" ? "controversy_positive" : kind;

function applyImpact(snapshot: StorySnapshot, event: Extract<DomainEvent, { type: "platform.impact" }>, appliedAt: string) {
  if (snapshot.mvu.platform.appliedImpactIds.includes(event.id)) return;
  const kind = positiveKind(event.kind);
  const scaleFollowerRanges = { small: [0.001, 0.005], medium: [0.005, 0.02], large: [0.02, 0.08] } as const;
  const scaleReachRanges = { small: [0.08, 0.25], medium: [0.35, 1.2], large: [1.5, 6] } as const;
  const followerMultipliers = {
    growth: 1,
    viral: 1.25,
    limited: 0,
    controversy_positive: 0.9,
    controversy_negative: -0.55,
    steady: 0.45,
    backlash: -1.2
  } as const;
  const reachMultipliers = {
    growth: 1,
    viral: 2,
    limited: 0.15,
    controversy_positive: 1.8,
    controversy_negative: 1.8,
    steady: 0.7,
    backlash: 1.35
  } as const;
  const currentFollowers = snapshot.profile.followerCount;
  let exposure = 0;
  let followerDelta = 0;
  const metricsDelta = zeroMetrics();

  if (event.target === "profile") {
    if (event.targetId !== snapshot.profile.accountId) throw new Error(`Unknown profile target: ${event.targetId}`);
    const [minimum, maximum] = scaleFollowerRanges[event.scale];
    const rate = between(event.id, "followers", minimum, maximum) * followerMultipliers[kind];
    const minimumMagnitude = { small: 3, medium: 15, large: 75 }[event.scale];
    followerDelta = rate === 0 ? 0 : Math.sign(rate) * Math.max(minimumMagnitude, Math.round(Math.max(100, currentFollowers) * Math.abs(rate)));
    exposure = Math.round(Math.max(100, currentFollowers) * between(event.id, "profile-reach", 0.25, 1.5) * reachMultipliers[kind]);
  } else {
    const post = snapshot.posts.find((item) => item.id === event.targetId);
    if (!post) throw new Error(`Unknown post impact target: ${event.targetId}`);
    const [minimum, maximum] = scaleReachRanges[event.scale];
    const minimumReach = { small: 100, medium: 600, large: 3_000 }[event.scale];
    exposure = Math.max(minimumReach, Math.round(Math.max(100, currentFollowers) * between(event.id, "reach", minimum, maximum) * reachMultipliers[kind]));
    const engagementMultiplier = kind === "viral" ? 1.45 : kind === "limited" ? 0.55 : kind.startsWith("controversy") || kind === "backlash" ? 1.25 : kind === "steady" ? 0.8 : 1;
    metricsDelta.views = exposure;
    metricsDelta.likes = Math.round(exposure * between(event.id, "likes", 0.03, 0.12) * engagementMultiplier);
    metricsDelta.reposts = Math.round(exposure * between(event.id, "reposts", 0.004, 0.03) * engagementMultiplier);
    metricsDelta.replies = Math.round(exposure * between(event.id, "replies", 0.002, 0.025) * engagementMultiplier);
    metricsDelta.bookmarks = Math.round(exposure * between(event.id, "bookmarks", 0.001, 0.015) * (kind === "backlash" ? 0.45 : engagementMultiplier));
    for (const key of Object.keys(metricsDelta) as Array<keyof Metrics>) post.metrics[key] += metricsDelta[key];
    if (post.authorId === snapshot.profile.accountId) {
      const conversion = {
        growth: 0.004,
        viral: 0.009,
        limited: 0.0002,
        controversy_positive: 0.004,
        controversy_negative: -0.002,
        steady: 0.002,
        backlash: -0.006
      }[kind];
      followerDelta = Math.round(exposure * conversion * between(event.id, "conversion", 0.75, 1.25));
    }
  }
  const maximumFollowerMagnitude = Math.max({ small: 3, medium: 15, large: 75 }[event.scale], Math.round(Math.max(100, currentFollowers) * scaleFollowerRanges[event.scale][1]));
  followerDelta = Math.max(-maximumFollowerMagnitude, Math.min(maximumFollowerMagnitude, followerDelta));
  snapshot.profile.followerCount = Math.max(0, snapshot.profile.followerCount + followerDelta);
  snapshot.mvu.platform.appliedImpactIds.push(event.id);
  snapshot.mvu.platform.impactLedger.push({
    id: event.id,
    target: event.target,
    targetId: event.targetId,
    kind: event.kind,
    scale: event.scale,
    exposure,
    followerDelta,
    metricsDelta,
    appliedAt
  });
  if (snapshot.mvu.platform.appliedImpactIds.length > 20_000) snapshot.mvu.platform.appliedImpactIds.splice(0, snapshot.mvu.platform.appliedImpactIds.length - 20_000);
  if (snapshot.mvu.platform.impactLedger.length > 20_000) snapshot.mvu.platform.impactLedger.splice(0, snapshot.mvu.platform.impactLedger.length - 20_000);
}

function setAtPath(root: Record<string, unknown>, path: string, operation: "set" | "increment" | "append" | "remove", value?: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => blockedPathParts.has(part))) throw new Error(`Unsafe MVU path: ${path}`);
  if (!(["heroine", "player", "platform", "extensions"] as string[]).includes(parts[0]!)) throw new Error(`MVU path is outside mutable state: ${path}`);
  const exactTemporaryPaths = new Set(["heroine.status", "heroine.outfit", "heroine.mood", "heroine.activity", "heroine.location", "heroine.bio"]);
  const temporaryPrefixes = ["heroine.usageNotice", "heroine.profileFacts", "heroine.relationship", "player.relationship", "platform.flags"];
  const blockedExtensions = ["extensions.homepageConfigured", "extensions.homepageSource", "extensions.identityLinks"];
  const allowedTemporary = exactTemporaryPaths.has(path)
    || temporaryPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`))
    || (path.startsWith("extensions.") && !blockedExtensions.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)))
    || path === "heroine.cycle.anchorDate" || path === "heroine.cycle.pregnancy";
  if (!allowedTemporary) throw new Error(`MVU path is not an AI-writable temporary source: ${path}`);
  if (path === "heroine.cycle" || (path.startsWith("heroine.cycle.") && !["heroine.cycle.anchorDate", "heroine.cycle.pregnancy"].includes(path))) {
    throw new Error(`MVU cycle updates must set the whole pregnancy object or anchorDate: ${path}`);
  }
  if ((path === "heroine.cycle.anchorDate" || path === "heroine.cycle.pregnancy") && operation !== "set") throw new Error(`MVU cycle path only supports set: ${path}`);
  let current: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const key = parts.at(-1)!;
  if (operation === "set") current[key] = value;
  if (operation === "increment") {
    if (typeof value !== "number") throw new Error(`MVU increment requires a numeric value: ${path}`);
    const existing = current[key];
    if (existing !== undefined && typeof existing !== "number") throw new Error(`MVU increment requires a number: ${path}`);
    current[key] = (existing ?? 0) + value;
  }
  if (operation === "append") {
    if (!Array.isArray(current[key])) current[key] = [];
    (current[key] as unknown[]).push(value);
  }
  if (operation === "remove") delete current[key];
}

function formatTrendVolume(score: number) {
  if (score >= 1_000_000) return `${Number((score / 1_000_000).toFixed(1))}M 帖文`;
  if (score >= 1_000) return `${Number((score / 1_000).toFixed(1))}K 帖文`;
  return `${score} 帖文`;
}

function rerankTrends(snapshot: StorySnapshot) {
  snapshot.trends.sort((a, b) => b.heatScore - a.heatScore || a.label.localeCompare(b.label));
  snapshot.trends = snapshot.trends.slice(0, 20).map((trend, index) => ({ ...trend, rank: index + 1, volumeLabel: formatTrendVolume(trend.heatScore) }));
}

function upsertTrend(snapshot: StorySnapshot, event: Extract<DomainEvent, { type: "platform.trend.upsert" }>) {
  const bases = { low: 800, medium: 5_000, high: 20_000, viral: 80_000 } as const;
  const existing = snapshot.trends.find((trend) => trend.id === event.trend.id);
  const incoming = Math.round(bases[event.trend.heat] * between(event.trend.id, event.trend.updatedAt, 0.85, 1.15));
  const heatScore = existing ? Math.round(existing.heatScore * 0.65 + incoming) : incoming;
  const value = { id: event.trend.id, label: event.trend.label, heatScore, rank: 1, volumeLabel: "", updatedAt: event.trend.updatedAt };
  upsert(snapshot.trends, value);
  rerankTrends(snapshot);
}

function validateNewProfileSection(snapshot: StorySnapshot, section: StorySnapshot["profile"]["sections"][number]) {
  if (section.origin !== "ai") throw new Error(`New profile section ${section.id} must have origin ai`);
  if (section.page !== "records") throw new Error(`AI profile section ${section.id} must be placed on records`);
  if (snapshot.profile.sections.length >= 30) throw new Error("Profile sections have reached the 30-section limit");
  if (snapshot.profile.sections.filter((current) => current.origin === "ai").length >= 8) throw new Error("AI profile sections are limited to 8");
  if (section.items.length > 12) throw new Error(`AI profile section ${section.id} is limited to 12 items`);
  for (const current of section.items) {
    if (current.origin !== "ai") throw new Error(`New profile item ${current.id} must have origin ai`);
    if (current.permission !== "temporary") throw new Error(`A newly created AI section may initially contain temporary items only: ${current.id}`);
    if (current.permission === "temporary" && (current.source.kind !== "mvu" || current.source.path !== `extensions.profileTemporary.${section.id}.${current.id}`)) {
      throw new Error(`Temporary profile item ${current.id} must use its MVU extension source`);
    }
  }
}

function applyEvent(snapshot: StorySnapshot, event: DomainEvent, eventTime = snapshot.mvu.storyTime) {
  switch (event.type) {
    case "account.upsert":
      if ([privateHeroineAccountId, coverHeroineAccountId, playerAccountId].includes(event.account.id)
        && snapshot.accounts.some((account) => account.id === event.account.id)) {
        throw new Error(`AI cannot modify locked account ${event.account.id}`);
      }
      upsert(snapshot.accounts, event.account.id === privateHeroineAccountId
        ? { ...event.account, isPrivate: true, relationshipLabel: "女主的私密账号" }
        : event.account.id === coverHeroineAccountId
          ? { ...event.account, isPrivate: false, relationshipLabel: "女主的表账号" }
          : event.account);
      return;
    case "post.upsert":
      if (!getAccount(snapshot, event.post.authorId)) throw new Error(`Unknown post author: ${event.post.authorId}`);
      if (event.post.authorId === playerAccountId) throw new Error("AI cannot publish a post as the player");
      if (snapshot.posts.some((post) => post.id === event.post.id)) throw new Error(`Published post cannot be overwritten: ${event.post.id}`);
      if (event.post.replyToPostId && !snapshot.posts.some((post) => post.id === event.post.replyToPostId)) {
        throw new Error(`Unknown reply post: ${event.post.replyToPostId}`);
      }
      if (event.post.quotedPostId && !snapshot.posts.some((post) => post.id === event.post.quotedPostId && post.moderation !== "hidden" && post.moderation !== "deleted")) {
        throw new Error(`Quoted post is unavailable: ${event.post.quotedPostId}`);
      }
      snapshot.posts.push({ ...event.post, pinned: false, createdAt: eventTime, metrics: zeroMetrics() });
      return;
    case "post.remove": {
      const post = snapshot.posts.find((item) => item.id === event.postId);
      if (!post) throw new Error(`Unknown post: ${event.postId}`);
      post.moderation = "deleted";
      if (snapshot.profile.pinnedPostId === event.postId) snapshot.profile.pinnedPostId = undefined;
      return;
    }
    case "post.moderate": {
      const post = snapshot.posts.find((item) => item.id === event.postId);
      if (!post) throw new Error(`Unknown post: ${event.postId}`);
      post.moderation = event.moderation;
      if ((event.moderation === "hidden" || event.moderation === "deleted") && snapshot.profile.pinnedPostId === event.postId) {
        snapshot.profile.pinnedPostId = undefined;
      }
      return;
    }
    case "comment.upsert":
      if (!snapshot.posts.some((item) => item.id === event.comment.postId)) throw new Error(`Unknown comment post: ${event.comment.postId}`);
      if (!getAccount(snapshot, event.comment.authorId)) throw new Error(`Unknown comment author: ${event.comment.authorId}`);
      if (event.comment.authorId === playerAccountId) throw new Error("AI cannot publish a comment as the player");
      if (event.comment.parentId && !snapshot.comments.some((item) => item.id === event.comment.parentId && item.postId === event.comment.postId)) {
        throw new Error(`Parent comment is not in post ${event.comment.postId}: ${event.comment.parentId}`);
      }
      if (snapshot.comments.some((comment) => comment.id === event.comment.id)) throw new Error(`Published comment cannot be overwritten: ${event.comment.id}`);
      snapshot.comments.push({ ...event.comment, createdAt: eventTime, metrics: zeroMetrics() });
      snapshot.posts.find((post) => post.id === event.comment.postId)!.metrics.replies += 1;
      if (event.comment.parentId) snapshot.comments.find((comment) => comment.id === event.comment.parentId)!.metrics.replies += 1;
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
          ? { ...event.thread, kind: "dm" as const, title: `${coverAccount.displayName} · @${coverAccount.handle}`, participantIds: [playerAccountId, coverHeroineAccountId], playerCanSend: true }
          : event.thread;
        for (const participantId of thread.participantIds) if (!getAccount(snapshot, participantId)) throw new Error(`Unknown thread participant: ${participantId}`);
        upsert(snapshot.threads, thread);
      }
      return;
    case "message.add":
      {
        if (event.message.senderId === playerAccountId || event.message.isPlayerInput) throw new Error("AI cannot add a player-authored message");
        const message = event.message.threadId === playerHeroineThreadId && event.message.senderId === privateHeroineAccountId
          ? { ...event.message, senderId: coverHeroineAccountId, createdAt: eventTime }
          : { ...event.message, createdAt: eventTime };
        const thread = snapshot.threads.find((item) => item.id === message.threadId);
        if (!thread) throw new Error(`Unknown message thread: ${message.threadId}`);
        if (!getAccount(snapshot, message.senderId)) throw new Error(`Unknown message sender: ${message.senderId}`);
        if (!thread.participantIds.includes(message.senderId)) throw new Error(`Message sender is not a thread participant: ${message.senderId}`);
        if (message.replyToMessageId && !snapshot.messages.some((current) => current.id === message.replyToMessageId && current.threadId === message.threadId)) {
          throw new Error(`Reply message is not in thread ${message.threadId}: ${message.replyToMessageId}`);
        }
        if (snapshot.messages.some((current) => current.id === message.id)) throw new Error(`Message cannot be overwritten: ${message.id}`);
        snapshot.messages.push(message);
        thread.updatedAt = message.createdAt;
      }
      return;
    case "live.upsert":
      if (!getAccount(snapshot, event.live.hostId)) throw new Error(`Unknown live host: ${event.live.hostId}`);
      upsert(snapshot.lives, event.live);
      return;
    case "profile.patch": {
      const patch = event.patch;
      if (patch.bannerTone !== undefined || patch.location !== undefined) throw new Error("AI cannot modify locked banner tone or projected profile location");
      if (patch.pinnedPostId !== undefined) {
        if (patch.pinnedPostId && !snapshot.posts.some((post) => post.id === patch.pinnedPostId && post.moderation !== "deleted" && post.moderation !== "hidden")) throw new Error(`Pinned post does not exist: ${patch.pinnedPostId}`);
        snapshot.profile.pinnedPostId = patch.pinnedPostId ?? undefined;
      }
      for (const id of patch.removeSectionIds) {
        const section = snapshot.profile.sections.find((current) => current.id === id);
        if (!section) continue;
        if (section.origin !== "ai") throw new Error(`Initial profile section cannot be removed: ${id}`);
        if (section.items.some((current) => current.permission === "append_only")) throw new Error(`Profile section with append-only history cannot be removed: ${id}`);
        for (const current of section.items) if (current.permission === "temporary" && current.source.kind === "mvu") {
          setAtPath(snapshot.mvu as unknown as Record<string, unknown>, current.source.path, "remove");
        }
        snapshot.profile.sections = snapshot.profile.sections.filter((current) => current.id !== id);
      }
      for (const section of patch.upsertSections) {
        if (snapshot.profile.sections.some((current) => current.id === section.id)) throw new Error(`Existing profile section cannot be overwritten: ${section.id}`);
        validateNewProfileSection(snapshot, section);
        for (const current of section.items) setAtPath(snapshot.mvu as unknown as Record<string, unknown>, current.source.path, "set", current.value);
        snapshot.profile.sections.push(section);
      }
      snapshot.profile.sections.sort((a, b) => a.order - b.order);
      return;
    }
    case "profile.item.append": {
      const section = snapshot.profile.sections.find((current) => current.id === event.sectionId);
      if (!section) throw new Error(`Unknown profile section: ${event.sectionId}`);
      if (section.kind !== "timeline") throw new Error(`Append-only profile items require a timeline section: ${event.sectionId}`);
      const itemLimit = section.origin === "ai" ? 12 : 50;
      if (section.items.length >= itemLimit) throw new Error(`Profile section ${section.id} has reached its ${itemLimit}-item limit`);
      if (section.items.some((current) => current.id === event.item.id)) throw new Error(`Append-only profile item already exists: ${event.item.id}`);
      if (!event.item.value.trim()) throw new Error(`Append-only profile item cannot be empty: ${event.item.id}`);
      if (event.item.permission !== "append_only" || event.item.origin !== "ai" || event.item.source.kind !== "event_log"
        || event.item.source.path !== `profile.sections.${section.id}.items`) {
        throw new Error(`Profile item ${event.item.id} is not a valid append-only item`);
      }
      section.items.push({ ...event.item, label: eventTime.slice(0, 10) });
      if (section.kind === "timeline") section.items.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
      return;
    }
    case "profile.item.add": {
      const section = snapshot.profile.sections.find((current) => current.id === event.sectionId);
      const allowsTemporaryExtension = section?.origin === "ai" || (section?.origin === "initial" && section.page === "sidebar" && section.kind === "status");
      if (!section || !allowsTemporaryExtension) throw new Error(`Profile item cannot be added to section: ${event.sectionId}`);
      if (section.items.filter((current) => current.origin === "ai").length >= 12 || section.items.length >= 50) throw new Error(`Profile section ${section.id} has reached its AI-item limit`);
      if (section.items.some((current) => current.id === event.item.id)) throw new Error(`Profile item already exists: ${event.item.id}`);
      const expectedPath = `extensions.profileTemporary.${section.id}.${event.item.id}`;
      if (event.item.origin !== "ai" || event.item.permission !== "temporary" || event.item.source.kind !== "mvu" || event.item.source.path !== expectedPath) {
        throw new Error(`Added profile item ${event.item.id} must be an AI temporary item with its MVU extension source`);
      }
      setAtPath(snapshot.mvu as unknown as Record<string, unknown>, event.item.source.path, "set", event.item.value);
      section.items.push(event.item);
      return;
    }
    case "profile.item.remove": {
      const section = snapshot.profile.sections.find((current) => current.id === event.sectionId);
      if (!section) throw new Error(`Unknown profile section: ${event.sectionId}`);
      const current = section.items.find((candidate) => candidate.id === event.itemId);
      if (!current) return;
      if (current.origin !== "ai" || current.permission !== "temporary") throw new Error(`Only AI-created temporary items can be removed: ${event.itemId}`);
      section.items = section.items.filter((candidate) => candidate.id !== event.itemId);
      setAtPath(snapshot.mvu as unknown as Record<string, unknown>, current.source.path, "remove");
      return;
    }
    case "statistics.insemination.append":
      if (snapshot.mvu.heroine.statistics.inseminationEvents.some((current) => current.id === event.record.id)) throw new Error(`Statistics record already exists: ${event.record.id}`);
      snapshot.mvu.heroine.statistics.inseminationEvents.push({ ...event.record, occurredAt: eventTime });
      return;
    case "fan.goal.add":
    case "fan.goal.upsert": {
      const existing = snapshot.mvu.platform.fanGoals.find((goal) => goal.id === event.goal.id);
      if (existing && snapshot.profile.followerCount >= existing.targetFollowers) throw new Error(`Completed fan goal cannot be modified: ${event.goal.id}`);
      const goal = { ...event.goal, createdAt: existing?.createdAt ?? eventTime };
      upsert(snapshot.mvu.platform.fanGoals, goal);
      return;
    }
    case "poll.resolve": {
      const post = snapshot.posts.find((item) => item.id === event.postId);
      if (!post) throw new Error(`Unknown poll post: ${event.postId}`);
      post.poll = event.poll;
      return;
    }
    case "platform.impact":
      applyImpact(snapshot, event, eventTime);
      return;
    case "platform.notice":
      upsert(snapshot.notices, event);
      return;
    case "platform.trends":
      throw new Error("platform.trends is legacy-only; use incremental platform.trend.upsert/remove events");
    case "platform.trend.upsert":
      upsertTrend(snapshot, { ...event, trend: { ...event.trend, updatedAt: eventTime } });
      return;
    case "platform.trend.remove":
      snapshot.trends = snapshot.trends.filter((trend) => trend.id !== event.trendId);
      rerankTrends(snapshot);
      return;
  }
}

export function applyAiOutput(base: StorySnapshot, output: AiTurnOutput): StorySnapshot {
  const oldTime = Date.parse(base.mvu.storyTime);
  const newTime = Date.parse(output.storyTime);
  if (!Number.isFinite(newTime)) throw new Error(`Invalid story time: ${output.storyTime}`);
  if (Number.isFinite(oldTime) && newTime < oldTime) throw new Error("Story time cannot move backwards");
  const next = clone(base);
  const previousPregnancy = clone(base.mvu.heroine.cycle.pregnancy);
  const previousAnchorDate = base.mvu.heroine.cycle.anchorDate;
  for (const event of output.events) applyEvent(next, event, output.storyTime);
  const mutable = next.mvu as unknown as Record<string, unknown>;
  for (const operation of output.mvuOperations) setAtPath(mutable, operation.path, operation.op, "value" in operation ? operation.value : undefined);
  next.mvu.storyTime = output.storyTime;
  next.mvu.revision += 1;
  next.profile.currentStoryTime = output.storyTime;
  next.pendingRenderPlan = output.renderPlan;
  const rawPregnancy = next.mvu.heroine.cycle.pregnancy as typeof next.mvu.heroine.cycle.pregnancy;
  if (rawPregnancy.status === "suspected") rawPregnancy.suspectedAt ??= previousPregnancy.suspectedAt ?? output.storyTime;
  if (previousPregnancy.status !== "none" && rawPregnancy.status !== "none" && previousPregnancy.suspectedAt) {
    rawPregnancy.suspectedAt ??= previousPregnancy.suspectedAt;
  }
  if ((previousPregnancy.status === "confirmed" || previousPregnancy.status === "ended") && rawPregnancy.status === "ended") {
    rawPregnancy.durationDays ??= previousPregnancy.durationDays;
    rawPregnancy.conceptionAt ??= previousPregnancy.conceptionAt;
    rawPregnancy.confirmedAt ??= previousPregnancy.confirmedAt;
  }
  next.mvu = MvuStateSchema.parse(next.mvu);
  const pregnancy = next.mvu.heroine.cycle.pregnancy;
  const allowedTransitions = {
    none: new Set(["none", "suspected"]),
    suspected: new Set(["suspected", "none", "confirmed"]),
    confirmed: new Set(["confirmed", "ended"]),
    ended: new Set(["ended", "none"])
  } as const;
  if (!allowedTransitions[previousPregnancy.status].has(pregnancy.status as never)) throw new Error(`Invalid pregnancy transition: ${previousPregnancy.status} -> ${pregnancy.status}`);
  if (previousPregnancy.status !== "none" && pregnancy.status !== "none" && previousPregnancy.suspectedAt
    && pregnancy.suspectedAt !== previousPregnancy.suspectedAt) {
    throw new Error("Pregnancy suspectedAt is locked until the pregnancy state resets to none");
  }
  if (pregnancy.status === "confirmed") {
    if (Date.parse(pregnancy.conceptionAt!) > newTime || Date.parse(pregnancy.confirmedAt!) > newTime) throw new Error("Pregnancy anchors cannot be later than storyTime");
  }
  if (previousPregnancy.status === "confirmed") {
    if (!(["confirmed", "ended"] as const).includes(pregnancy.status as "confirmed" | "ended")) throw new Error("Confirmed pregnancy can only remain confirmed or end");
    if (pregnancy.durationDays !== previousPregnancy.durationDays || pregnancy.conceptionAt !== previousPregnancy.conceptionAt || pregnancy.confirmedAt !== previousPregnancy.confirmedAt) {
      throw new Error("Confirmed pregnancy duration and anchors are locked");
    }
    if (pregnancy.status === "confirmed" && next.mvu.heroine.cycle.anchorDate !== previousAnchorDate) throw new Error("Cycle anchor is locked during confirmed pregnancy");
    if (pregnancy.status === "ended" && next.mvu.heroine.cycle.anchorDate === previousAnchorDate) throw new Error("Ending pregnancy requires a new cycle anchor");
  }
  if (previousPregnancy.status === "ended" && pregnancy.status === "ended"
    && (pregnancy.durationDays !== previousPregnancy.durationDays
      || pregnancy.conceptionAt !== previousPregnancy.conceptionAt
      || pregnancy.confirmedAt !== previousPregnancy.confirmedAt)) {
    throw new Error("Ended pregnancy duration and confirmation anchors are locked until the cycle resets");
  }
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

function readAtPath(root: unknown, path: string) {
  let current = root;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function profileEventChangesVisibleState(base: StorySnapshot, event: DomainEvent) {
  if (event.type === "profile.patch") {
    return event.patch.pinnedPostId !== undefined && (event.patch.pinnedPostId ?? undefined) !== base.profile.pinnedPostId
      || event.patch.upsertSections.some((section) => !base.profile.sections.some((current) => current.id === section.id))
      || event.patch.removeSectionIds.some((id) => base.profile.sections.some((section) => section.id === id));
  }
  if (event.type === "profile.item.add" || event.type === "profile.item.append") {
    return !base.profile.sections.find((section) => section.id === event.sectionId)?.items.some((item) => item.id === event.item.id);
  }
  if (event.type === "profile.item.remove") return Boolean(base.profile.sections.find((section) => section.id === event.sectionId)?.items.some((item) => item.id === event.itemId));
  if (event.type === "statistics.insemination.append") return !base.mvu.heroine.statistics.inseminationEvents.some((record) => record.id === event.record.id);
  if (event.type === "fan.goal.add" || event.type === "fan.goal.upsert") {
    const existing = base.mvu.platform.fanGoals.find((goal) => goal.id === event.goal.id);
    return !existing || existing.targetFollowers !== event.goal.targetFollowers || existing.reward !== event.goal.reward;
  }
  if (event.type === "platform.trend.upsert") return true;
  if (event.type === "platform.trend.remove") return base.trends.some((trend) => trend.id === event.trendId);
  return event.type === "platform.impact" && event.target === "profile" && !base.mvu.platform.appliedImpactIds.includes(event.id);
}

function panelHasMatchingChange(base: StorySnapshot, output: AiTurnOutput, panel: AiTurnOutput["renderPlan"]["panels"][number]) {
  if (panel.kind === "profile") {
    const visibleMvuPrefixes = [
      "heroine.status", "heroine.outfit", "heroine.mood", "heroine.activity", "heroine.location", "heroine.bio",
      "heroine.usageNotice", "heroine.profileFacts", "heroine.cycle", "extensions.profileTemporary"
    ];
    return output.mvuOperations.some((operation) => visibleMvuPrefixes.some((prefix) => operation.path === prefix || operation.path.startsWith(`${prefix}.`))
      && (operation.op !== "set" || !("value" in operation) || JSON.stringify(operation.value) !== JSON.stringify(readAtPath(base.mvu, operation.path))))
      || output.events.some((event) => profileEventChangesVisibleState(base, event));
  }
  if (!panel.targetId) return false;
  if (panel.kind === "post" || panel.kind === "poll") {
    return output.events.some((event) => event.type === "post.upsert" && event.post.id === panel.targetId
      || (event.type === "post.remove" || event.type === "post.moderate") && event.postId === panel.targetId
      || event.type === "poll.resolve" && event.postId === panel.targetId
      || event.type === "platform.impact" && event.target === "post" && event.targetId === panel.targetId);
  }
  if (panel.kind === "comments") {
    return output.events.some((event) => event.type === "comment.upsert" && event.comment.postId === panel.targetId
      || event.type === "comment.moderate" && base.comments.some((comment) => comment.id === event.commentId && comment.postId === panel.targetId));
  }
  if (panel.kind === "dm" || panel.kind === "group") {
    return output.events.some((event) => event.type === "message.add" && event.message.threadId === panel.targetId
      || event.type === "thread.upsert" && event.thread.id === panel.targetId);
  }
  if (panel.kind === "live") return output.events.some((event) => event.type === "live.upsert" && event.live.id === panel.targetId);
  return output.events.some((event) => event.type === "platform.notice" && event.id === panel.targetId);
}

export function validateRuleConstraints(base: StorySnapshot, output: AiTurnOutput, rule: RuntimeRuleConstraints) {
  const issues: string[] = [];
  const oldTime = Date.parse(base.mvu.storyTime);
  const newTime = Date.parse(output.storyTime);
  if (!Number.isFinite(newTime) || (Number.isFinite(oldTime) && newTime < oldTime)) issues.push("storyTime must be a valid time that does not move backwards");
  if (output.renderPlan.panels.length < rule.minPanels || output.renderPlan.panels.length > rule.maxPanels) {
    issues.push(`renderPlan.panels must contain ${rule.minPanels}-${rule.maxPanels} panels`);
  }
  if (rule.requireProfilePanel === true && !output.renderPlan.panels.some((panel) => panel.kind === "profile")) issues.push("renderPlan requires a profile panel");
  if (rule.requireStrictRevealOrder !== false) {
    const revealOrders = output.renderPlan.panels.map((panel) => panel.revealOrder);
    if (new Set(revealOrders).size !== revealOrders.length || revealOrders.some((order, index) => index > 0 && order <= revealOrders[index - 1]!)) issues.push("renderPlan revealOrder must be unique and strictly increasing");
  }
  for (const panel of output.renderPlan.panels) if (!panelHasMatchingChange(base, output, panel)) issues.push(`render panel ${panel.id} has no matching state change`);
  const profileSimulation = clone(base);
  for (const event of output.events) {
    if (event.type === "post.upsert") {
      if (!profileSimulation.posts.some((post) => post.id === event.post.id)) profileSimulation.posts.push({ ...clone(event.post), metrics: zeroMetrics() });
      continue;
    }
    if (event.type === "post.remove" || event.type === "post.moderate") {
      const post = profileSimulation.posts.find((current) => current.id === event.postId);
      if (post) post.moderation = event.type === "post.remove" ? "deleted" : event.moderation;
      continue;
    }
    if (event.type === "profile.patch") applyEvent(profileSimulation, event);
  }
  const profileCopy = profileSimulation.profile;
  let changes = Number(profileCopy.location !== base.profile.location)
    + Number(profileCopy.bannerTone !== base.profile.bannerTone)
    + Number((profileCopy.pinnedPostId ?? null) !== (base.profile.pinnedPostId ?? null));
  const baseSections = new Map(base.profile.sections.map((section) => [section.id, section]));
  const nextSections = new Map(profileCopy.sections.map((section) => [section.id, section]));
  for (const [id, section] of nextSections) {
    const existing = baseSections.get(id);
    if (!existing) { changes += Math.max(1, section.items.length); continue; }
    changes += Number(existing.title !== section.title || existing.kind !== section.kind || existing.page !== section.page || existing.order !== section.order || existing.origin !== section.origin);
    const existingItems = new Map(existing.items.map((item) => [item.id, item]));
    const nextItems = new Map(section.items.map((item) => [item.id, item]));
    for (const [itemId, item] of nextItems) {
      const existingItem = existingItems.get(itemId);
      if (!existingItem || existingItem.label !== item.label || existingItem.value !== item.value || existingItem.emphasis !== item.emphasis
        || existingItem.permission !== item.permission || existingItem.origin !== item.origin || existingItem.source.kind !== item.source.kind || existingItem.source.path !== item.source.path) changes += 1;
    }
    changes += existing.items.filter((item) => !nextItems.has(item.id)).length;
  }
  changes += base.profile.sections.filter((section) => !nextSections.has(section.id)).length;
  if (changes < rule.minProfileChanges) issues.push(`profile requires at least ${rule.minProfileChanges} field changes; received ${changes}`);
  for (const path of ["heroine.status", "heroine.outfit", "heroine.mood"]) {
    const operation = [...output.mvuOperations].reverse().find((candidate) => candidate.op === "set" && candidate.path === path);
    const key = path.split(".").at(-1) as "status" | "outfit" | "mood";
    if (!operation || operation.op !== "set" || !("value" in operation) || typeof operation.value !== "string" || !operation.value.trim()) issues.push(`${path} must be set to a non-empty value every turn`);
    else if (operation.value === base.mvu.heroine[key]) issues.push(`${path} must change every turn`);
  }
  const newPostEvents = output.events.filter((event): event is Extract<DomainEvent, { type: "post.upsert" }> => event.type === "post.upsert")
    .filter((event) => !base.posts.some((post) => post.id === event.post.id && post.moderation !== "deleted"));
  const newPostIds = new Set(newPostEvents.map((event) => event.post.id));
  for (const postId of newPostIds) {
    const comments = output.events.filter((event) => event.type === "comment.upsert" && event.comment.postId === postId).length;
    const target = rule.representativeComments ?? 1;
    if (target > 0 && comments === 0) issues.push(`post ${postId} requires at least 1 accompanying comment when representative comments are enabled`);
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
