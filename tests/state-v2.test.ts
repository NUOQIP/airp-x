import { describe, expect, it } from "vitest";
import type { AiTurnOutput, DomainEvent, StorySnapshot } from "@airp/shared";
import { createInitialStorySnapshot } from "../apps/server/src/db/defaults.js";
import { migrateStorySnapshotV2 } from "../apps/server/src/services/snapshot-migration.js";
import { applyAiOutput, validateRuleConstraints } from "../apps/server/src/services/story-engine.js";
import { deriveCorruption } from "../apps/server/src/services/state-derived-service.js";

function turn(base: StorySnapshot, options: { storyTime?: string; events?: DomainEvent[]; suffix?: string; panels?: AiTurnOutput["renderPlan"]["panels"] } = {}): AiTurnOutput {
  const suffix = options.suffix ?? "·更新";
  return {
    schemaVersion: "1.0",
    storyTime: options.storyTime ?? "2026-10-25T16:00+08:00",
    events: options.events ?? [],
    mvuOperations: [
      { op: "set", path: "heroine.status", value: `${base.mvu.heroine.status}${suffix}` },
      { op: "set", path: "heroine.outfit", value: `${base.mvu.heroine.outfit}${suffix}` },
      { op: "set", path: "heroine.mood", value: `${base.mvu.heroine.mood}${suffix}` }
    ],
    renderPlan: { panels: options.panels ?? [] }
  };
}

describe("homepage state v2", () => {
  it("derives a hidden 1-100 corruption stage from followers", () => {
    expect(deriveCorruption(0)).toMatchObject({ score: 1, range: "1-10", label: "试探期", nextStageAtFollowers: 11_000 });
    expect(deriveCorruption(5_002)).toMatchObject({ score: 5, range: "1-10", label: "试探期" });
    expect(deriveCorruption(11_000)).toMatchObject({ score: 11, range: "11-20", label: "适应期", nextStageAtFollowers: 21_000 });
    expect(deriveCorruption(100_000)).toMatchObject({ score: 100, range: "91-100", label: "彻底沉沦期" });
    expect(deriveCorruption(100_000)).not.toHaveProperty("nextStageAtFollowers");
  });

  it("migrates legacy sections precisely, removes followingCount and starts statistics at zero", () => {
    const legacy = structuredClone(createInitialStorySnapshot()) as unknown as Record<string, any>;
    legacy.profile.followingCount = 890;
    delete legacy.mvu.heroine.cycle;
    delete legacy.mvu.heroine.statistics;
    delete legacy.mvu.heroine.bio;
    delete legacy.mvu.heroine.usageNotice;
    delete legacy.mvu.heroine.profileFacts;
    delete legacy.mvu.platform.fanGoals;
    delete legacy.mvu.platform.appliedImpactIds;
    delete legacy.mvu.platform.impactLedger;
    delete legacy.mvu.derived;
    legacy.profile.sections = [
      {
        id: "breeding-registration", title: "种畜登记档", kind: "facts", page: "about", order: 1, mutablePolicy: "manual",
        items: [
          { id: "breed", label: "品种", value: "测试品种", emphasis: "normal" },
          { id: "measurements", label: "三围", value: "B90 / W60 / H90 · 164cm · 57kg", emphasis: "normal" },
          { id: "ovulation-cycle", label: "排卵周期", value: "旧缓存", emphasis: "danger" }
        ]
      },
      {
        id: "usage-instructions", title: "使用须知", kind: "notice", page: "about", order: 2, mutablePolicy: "manual",
        items: [{ id: "rule-a", label: "规则", value: "保留内容", emphasis: "normal" }]
      },
      {
        id: "breeding-records", title: "统计记录", kind: "stats", page: "records", order: 3, mutablePolicy: "computed",
        items: [{ id: "total-creampie-count", label: "累计", value: "534次", emphasis: "normal" }]
      },
      {
        id: "live-status", title: "当前实况", kind: "status", page: "live", order: 4, mutablePolicy: "temporary",
        items: [
          { id: "old-status", label: "当前状态", value: "旧状态", emphasis: "normal" },
          { id: "old-outfit", label: "当前穿搭", value: "旧穿搭", emphasis: "normal" },
          { id: "old-mood", label: "当前心情", value: "旧心情", emphasis: "normal" }
        ]
      }
    ];

    const migrated = migrateStorySnapshotV2(legacy);
    expect("followingCount" in migrated.profile).toBe(false);
    expect(migrated.mvu.derived.cycle).toMatchObject({ phase: "ovulation", cycleDay: 4 });
    expect(migrated.mvu.derived.statistics).toMatchObject({ todayCount: 0, totalCount: 0, totalVolumeMl: 0 });
    expect(migrated.mvu.derived.statistics.nextDailyResetAt).toBeTruthy();
    expect(migrated.mvu.heroine.usageNotice["rule-a"]).toBe("保留内容");
    const registration = migrated.profile.sections.find((section) => section.id === "breeding-registration")!;
    expect(registration.page).toBe("records");
    expect(registration.items.find((item) => item.id === "height")).toMatchObject({ permission: "locked", value: "164cm" });
    expect(registration.items.find((item) => item.id === "weight")).toMatchObject({ permission: "temporary", source: { path: "heroine.profileFacts.weight" } });
    expect(registration.items.some((item) => item.id === "ovulation-cycle")).toBe(false);
    const live = migrated.profile.sections.find((section) => section.id === "live-status")!;
    expect(live.items.find((item) => item.id === "current-status")?.source.path).toBe("heroine.status");
    expect(live.items.find((item) => item.id === "cycle-phase")).toMatchObject({ permission: "computed", source: { path: "cycle.phase" } });
    expect(live.items.some((item) => item.id === "cycle-next-change" || item.source.path === "cycle.nextChangeAt")).toBe(false);
    const statistics = migrated.profile.sections.find((section) => section.id === "breeding-records")!;
    expect(statistics.items.some((item) => item.id === "daily-reset" || item.source.path === "statistics.nextDailyResetAt")).toBe(false);
  });

  it("derives append-only statistics in mL and resets only the daily subtotal", () => {
    const base = createInitialStorySnapshot();
    const first = turn(base, {
      events: [{ type: "statistics.insemination.append", record: { id: "stat-1", occurredAt: base.mvu.storyTime, count: 2, volumeMl: 15, note: "记录一" } }]
    });
    const afterFirst = applyAiOutput(base, first);
    expect(afterFirst.mvu.derived.statistics).toMatchObject({ todayCount: 2, totalCount: 2, totalVolumeMl: 15 });
    expect(afterFirst.mvu.heroine.statistics.inseminationEvents[0]?.occurredAt).toBe(first.storyTime);

    const second = turn(afterFirst, {
      storyTime: "2026-10-26T16:00+08:00",
      suffix: "·次日",
      events: [{ type: "statistics.insemination.append", record: { id: "stat-2", occurredAt: afterFirst.mvu.storyTime, count: 1, volumeMl: 9 } }]
    });
    const afterSecond = applyAiOutput(afterFirst, second);
    expect(afterSecond.mvu.derived.statistics).toMatchObject({ todayCount: 1, totalCount: 3, totalVolumeMl: 24 });
  });

  it("uses a 1/2/1/3 seven-day cycle and locks P3 pregnancy anchors", () => {
    const base = createInitialStorySnapshot();
    expect(migrateStorySnapshotV2(base).mvu.derived.cycle.phase).toBe("ovulation");
    const skippedSuspected = turn(base, { storyTime: "2026-10-25T16:15+08:00", suffix: "·跳级" });
    skippedSuspected.mvuOperations.push({
      op: "set", path: "heroine.cycle.pregnancy",
      value: { status: "confirmed", conceptionAt: "2026-10-24T16:00+08:00", confirmedAt: "2026-10-25T16:15+08:00", durationDays: 21 }
    });
    expect(() => applyAiOutput(base, skippedSuspected)).toThrow(/Invalid pregnancy transition/);
    const suspectedOutput = turn(base, { storyTime: "2026-10-25T16:30+08:00", suffix: "·疑似" });
    suspectedOutput.mvuOperations.push({ op: "set", path: "heroine.cycle.pregnancy", value: { status: "suspected" } });
    const suspected = applyAiOutput(base, suspectedOutput);
    expect(suspected.mvu.heroine.cycle.pregnancy).toMatchObject({ status: "suspected", suspectedAt: suspectedOutput.storyTime });
    const suspectedFollowupOutput = turn(suspected, { storyTime: "2026-10-25T16:45+08:00", suffix: "·仍疑似" });
    suspectedFollowupOutput.mvuOperations.push({ op: "set", path: "heroine.cycle.pregnancy", value: { status: "suspected" } });
    const stillSuspected = applyAiOutput(suspected, suspectedFollowupOutput);
    expect(stillSuspected.mvu.heroine.cycle.pregnancy.suspectedAt).toBe(suspectedOutput.storyTime);
    const rewrittenSuspectedAt = turn(stillSuspected, { storyTime: "2026-10-25T16:50+08:00", suffix: "·篡改疑似锚点" });
    rewrittenSuspectedAt.mvuOperations.push({
      op: "set", path: "heroine.cycle.pregnancy", value: { status: "suspected", suspectedAt: rewrittenSuspectedAt.storyTime }
    });
    expect(() => applyAiOutput(stillSuspected, rewrittenSuspectedAt)).toThrow(/suspectedAt is locked/);
    const confirmedOutput = turn(suspected, { storyTime: "2026-10-25T17:00+08:00" });
    confirmedOutput.mvuOperations.push({
      op: "set", path: "heroine.cycle.pregnancy",
      value: { status: "confirmed", conceptionAt: "2026-10-24T17:00+08:00", confirmedAt: "2026-10-25T17:00+08:00", durationDays: 21 }
    });
    const confirmed = applyAiOutput(suspected, confirmedOutput);
    expect(confirmed.mvu.derived.cycle).toMatchObject({ phase: "pregnant", pregnancy: { durationDays: 21, stage: "early" } });

    const changedDuration = turn(confirmed, { storyTime: "2026-10-25T18:00+08:00", suffix: "·继续" });
    changedDuration.mvuOperations.push({
      op: "set", path: "heroine.cycle.pregnancy",
      value: { status: "confirmed", conceptionAt: "2026-10-24T17:00+08:00", confirmedAt: "2026-10-25T17:00+08:00", durationDays: 22 }
    });
    expect(() => applyAiOutput(confirmed, changedDuration)).toThrow(/locked/);

    const endedOutput = turn(confirmed, { storyTime: "2026-10-26T18:00+08:00", suffix: "·结束" });
    endedOutput.mvuOperations.push(
      { op: "set", path: "heroine.cycle.pregnancy", value: { status: "ended", endedAt: "2026-10-26T18:00+08:00" } },
      { op: "set", path: "heroine.cycle.anchorDate", value: "2026-10-26T18:00+08:00" }
    );
    const ended = applyAiOutput(confirmed, endedOutput);
    expect(ended.mvu.heroine.cycle.pregnancy).toMatchObject({ status: "ended", durationDays: 21 });
    expect(ended.mvu.derived.cycle.phase).toBe("menstruation");
    const endedFollowup = turn(ended, { storyTime: "2026-10-26T18:30+08:00", suffix: "·结束后续" });
    endedFollowup.mvuOperations.push({ op: "set", path: "heroine.cycle.pregnancy", value: { status: "ended", endedAt: "2026-10-26T18:00+08:00" } });
    const stillEnded = applyAiOutput(ended, endedFollowup);
    expect(stillEnded.mvu.heroine.cycle.pregnancy).toMatchObject({
      status: "ended", durationDays: 21, conceptionAt: "2026-10-24T17:00+08:00", confirmedAt: "2026-10-25T17:00+08:00"
    });
    const rewriteEndedAnchors = turn(stillEnded, { storyTime: "2026-10-26T18:45+08:00", suffix: "·篡改结束锚点" });
    rewriteEndedAnchors.mvuOperations.push({
      op: "set", path: "heroine.cycle.pregnancy",
      value: { ...stillEnded.mvu.heroine.cycle.pregnancy, durationDays: 99 }
    });
    expect(() => applyAiOutput(stillEnded, rewriteEndedAnchors)).toThrow(/locked/);
    const skippedReset = turn(ended, { storyTime: "2026-10-26T19:00+08:00", suffix: "·跳过重置" });
    skippedReset.mvuOperations.push({ op: "set", path: "heroine.cycle.pregnancy", value: { status: "suspected" } });
    expect(() => applyAiOutput(ended, skippedReset)).toThrow(/Invalid pregnancy transition/);
  });

  it("uses deterministic F2 impact, computed metrics and event-id deduplication", () => {
    const base = createInitialStorySnapshot();
    const impact: DomainEvent = { type: "platform.impact", id: "f2-post-1", target: "post", targetId: "post-live-now", kind: "viral", scale: "large" };
    const first = applyAiOutput(base, turn(base, { events: [impact] }));
    const firstMetrics = structuredClone(first.posts.find((post) => post.id === "post-live-now")!.metrics);
    expect(firstMetrics.views).toBeGreaterThan(base.posts.find((post) => post.id === "post-live-now")!.metrics.views);
    expect(first.mvu.platform.impactLedger[0]).toMatchObject({ id: "f2-post-1", target: "post" });
    const duplicate = applyAiOutput(first, turn(first, { storyTime: "2026-10-25T17:00+08:00", suffix: "·再次", events: [impact] }));
    expect(duplicate.posts.find((post) => post.id === "post-live-now")!.metrics).toEqual(firstMetrics);
  });

  it("updates trends incrementally and computes score, volume label and rank", () => {
    const base = createInitialStorySnapshot();
    const output = turn(base, {
      events: [
        { type: "platform.trend.upsert", trend: { id: "trend-new", label: "新趋势", heat: "viral", updatedAt: base.mvu.storyTime } },
        { type: "platform.trend.remove", trendId: "trend-weekend-live" }
      ]
    });
    const next = applyAiOutput(base, output);
    expect(next.trends.some((trend) => trend.id === "trend-weekend-live")).toBe(false);
    expect(next.trends.find((trend) => trend.id === "trend-new")).toMatchObject({ rank: 1, updatedAt: output.storyTime });
    expect(next.trends[0]?.volumeLabel).toMatch(/K|M|帖文/);
  });

  it("updates unfinished fan goals, auto-switches and preserves completed goals", () => {
    const base = createInitialStorySnapshot();
    const update = turn(base, {
      events: [
        { type: "fan.goal.upsert", goal: { id: "fan-goal-150k", targetFollowers: 150_000, reward: "更新奖励", createdAt: base.mvu.storyTime } },
        { type: "fan.goal.upsert", goal: { id: "fan-goal-200k", targetFollowers: 200_000, reward: "下一阶段", createdAt: base.mvu.storyTime } }
      ]
    });
    const withGoals = applyAiOutput(base, update);
    expect(withGoals.mvu.platform.fanGoals.find((goal) => goal.id === "fan-goal-150k")?.reward).toBe("更新奖励");
    withGoals.profile.followerCount = 160_000;
    const switched = applyAiOutput(withGoals, turn(withGoals, { storyTime: "2026-10-25T17:00+08:00", suffix: "·切换" }));
    expect(switched.mvu.derived.fanPlan).toMatchObject({ activeGoalId: "fan-goal-200k", currentFollowers: 160_000, completed: false });
    expect(switched.profile.sections.find((section) => section.id === "section-goal")?.items.find((item) => item.id === "next-goal")?.value).toBe("");
    const rewriteCompleted = turn(switched, {
      storyTime: "2026-10-25T18:00+08:00",
      suffix: "·锁定",
      events: [{ type: "fan.goal.upsert", goal: { id: "fan-goal-150k", targetFollowers: 170_000, reward: "篡改", createdAt: base.mvu.storyTime } }]
    });
    expect(() => applyAiOutput(switched, rewriteCompleted)).toThrow(/Completed fan goal/);
  });

  it("enforces append-only history and canonical temporary item sources", () => {
    const base = createInitialStorySnapshot();
    const coreMilestone = turn(base, {
      events: [{
        type: "profile.item.append",
        sectionId: "section-milestones",
        item: { id: "milestone-new", value: "新里程碑", emphasis: "accent", permission: "append_only", origin: "ai", source: { kind: "event_log", path: "profile.sections.section-milestones.items" } }
      }]
    });
    const withMilestone = applyAiOutput(base, coreMilestone);
    const afterAnotherTurn = applyAiOutput(withMilestone, turn(withMilestone, { storyTime: "2026-10-25T17:00+08:00", suffix: "·继续" }));
    expect(afterAnotherTurn.profile.sections.find((section) => section.id === "section-milestones")?.items.find((entry) => entry.id === "milestone-new"))
      .toMatchObject({ permission: "append_only", origin: "ai", value: "新里程碑" });

    const create = turn(base, {
      events: [{
        type: "profile.patch",
        patch: {
          upsertSections: [{ id: "ai-log", title: "AI记录", kind: "timeline", page: "records", order: 100, origin: "ai", items: [] }],
          removeSectionIds: []
        }
      }, {
        type: "profile.item.append",
        sectionId: "ai-log",
        item: { id: "entry-1", value: "不可覆盖的记录", emphasis: "normal", permission: "append_only", origin: "ai", source: { kind: "event_log", path: "profile.sections.ai-log.items" } }
      }]
    });
    const next = applyAiOutput(base, create);
    expect(next.profile.sections.find((section) => section.id === "ai-log")?.items[0]?.label).toBe(create.storyTime.slice(0, 10));
    const atTimelineLimit = structuredClone(next);
    const timeline = atTimelineLimit.profile.sections.find((section) => section.id === "ai-log")!;
    const firstTimelineEntry = timeline.items[0]!;
    while (timeline.items.length < 12) timeline.items.push({ ...firstTimelineEntry, id: `entry-${timeline.items.length + 1}` });
    const appendThirteenth = turn(atTimelineLimit, {
      storyTime: "2026-10-25T16:30+08:00", suffix: "·超限",
      events: [{
        type: "profile.item.append", sectionId: "ai-log",
        item: { ...firstTimelineEntry, id: "entry-13", value: "超过扩展卡上限" }
      }]
    });
    expect(() => applyAiOutput(atTimelineLimit, appendThirteenth)).toThrow(/12-item limit/);
    const removeHistory = turn(next, {
      storyTime: "2026-10-25T17:00+08:00", suffix: "·删除",
      events: [{ type: "profile.patch", patch: { upsertSections: [], removeSectionIds: ["ai-log"] } }]
    });
    expect(() => applyAiOutput(next, removeHistory)).toThrow(/append-only history/);

    const addCard = turn(base, {
      events: [{
        type: "profile.patch",
        patch: {
          upsertSections: [{
            id: "ai-temp", title: "临时卡", kind: "facts", page: "records", order: 101, origin: "ai",
            items: [{ id: "temp-a", label: "状态", value: "初值", emphasis: "normal", permission: "temporary", origin: "ai", source: { kind: "mvu", path: "extensions.profileTemporary.ai-temp.temp-a" } }]
          }],
          removeSectionIds: []
        }
      }]
    });
    const card = applyAiOutput(base, addCard);
    expect(card.profile.sections.find((section) => section.id === "ai-temp")?.items[0]?.value).toBe("初值");

    const addSidebarStatus = turn(base, {
      events: [{
        type: "profile.item.add", sectionId: "section-live-status",
        item: { id: "extra-status", label: "其他状态", value: "新增值", emphasis: "normal", permission: "temporary", origin: "ai", source: { kind: "mvu", path: "extensions.profileTemporary.section-live-status.extra-status" } }
      }]
    });
    const sidebar = applyAiOutput(base, addSidebarStatus);
    expect(sidebar.profile.sections.find((section) => section.id === "section-live-status")?.items.find((entry) => entry.id === "extra-status")?.value).toBe("新增值");
    const removeSidebarStatus = turn(sidebar, {
      storyTime: "2026-10-25T17:00+08:00", suffix: "·移除",
      events: [{ type: "profile.item.remove", sectionId: "section-live-status", itemId: "extra-status" }]
    });
    const removed = applyAiOutput(sidebar, removeSidebarStatus);
    expect(removed.profile.sections.find((section) => section.id === "section-live-status")?.items.some((entry) => entry.id === "extra-status")).toBe(false);
  });

  it("rejects clock rollback, computed MVU writes, legacy trend replacement and empty animations", () => {
    const base = createInitialStorySnapshot();
    expect(() => applyAiOutput(base, turn(base, { storyTime: "2026-10-25T15:00+08:00" }))).toThrow(/backwards/);
    const computed = turn(base);
    computed.mvuOperations.push({ op: "set", path: "heroine.statistics.inseminationEvents", value: [] });
    expect(() => applyAiOutput(base, computed)).toThrow(/not an AI-writable/);
    for (const path of ["heroine", "platform", "heroine.cycle", "heroine.statistics"]) {
      const parentOverwrite = turn(base);
      parentOverwrite.mvuOperations.push({ op: "set", path, value: {} });
      expect(() => applyAiOutput(base, parentOverwrite), path).toThrow(/not an AI-writable|cycle updates/);
    }
    const legacyTrend = turn(base, { events: [{ type: "platform.trends", trends: [{ label: "旧事件", volumeLabel: "1K", rank: 1 }] }] });
    expect(() => applyAiOutput(base, legacyTrend)).toThrow(/legacy-only/);

    const emptyPanel = turn(base, { panels: [{ id: "dm-empty", kind: "dm", targetId: "dm-player-heroine", revealOrder: 0, delayMs: 0 }] });
    expect(() => validateRuleConstraints(base, emptyPanel, { minProfileChanges: 0, minPanels: 0, maxPanels: 5 })).toThrow(/no matching state change/);
  });

  it("prevents AI from impersonating the player and preserves the fixed player DM", () => {
    const base = createInitialStorySnapshot();
    const playerMessage = turn(base, {
      events: [{
        type: "message.add",
        message: { id: "fake-player", threadId: "dm-player-heroine", senderId: "account-player", createdAt: base.mvu.storyTime, text: "伪造玩家消息", isPlayerInput: true, status: "sent" }
      }]
    });
    expect(() => applyAiOutput(base, playerMessage)).toThrow(/cannot add a player-authored message/);

    const playerPost = turn(base, {
      events: [{ type: "post.upsert", post: { ...base.posts[0]!, id: "fake-player-post", authorId: "account-player" } }]
    });
    expect(() => applyAiOutput(base, playerPost)).toThrow(/cannot publish a post as the player/);
    const playerComment = turn(base, {
      events: [{ type: "comment.upsert", comment: { ...base.comments[0]!, id: "fake-player-comment", authorId: "account-player" } }]
    });
    expect(() => applyAiOutput(base, playerComment)).toThrow(/cannot publish a comment as the player/);
    const crossPostComment = turn(base, {
      events: [{
        type: "comment.upsert",
        comment: { ...base.comments[0]!, id: "cross-post-comment", postId: "post-pinned", parentId: base.comments[0]!.id }
      }]
    });
    expect(() => applyAiOutput(base, crossPostComment)).toThrow(/Parent comment is not in post/);

    const outsider = turn(base, {
      events: [{
        type: "message.add",
        message: { id: "outsider", threadId: "dm-player-heroine", senderId: "account-fan-a", createdAt: base.mvu.storyTime, text: "越权消息", status: "read", isPlayerInput: false }
      }]
    });
    expect(() => applyAiOutput(base, outsider)).toThrow(/not a thread participant/);

    const crossThreadReply = turn(base, {
      events: [{
        type: "message.add",
        message: { id: "cross-reply", threadId: "dm-player-heroine", senderId: "account-heroine-cover", createdAt: base.mvu.storyTime, text: "跨线程回复", replyToMessageId: "msg-group-a", status: "read", isPlayerInput: false }
      }]
    });
    expect(() => applyAiOutput(base, crossThreadReply)).toThrow(/Reply message is not in thread/);

    const fixedThread = structuredClone(base.threads.find((thread) => thread.id === "dm-player-heroine")!);
    fixedThread.kind = "group";
    fixedThread.playerCanSend = false;
    fixedThread.participantIds = ["account-fan-a", "account-fan-b"];
    const normalized = applyAiOutput(base, turn(base, { events: [{ type: "thread.upsert", thread: fixedThread }] }));
    expect(normalized.threads.find((thread) => thread.id === "dm-player-heroine")).toMatchObject({
      kind: "dm", playerCanSend: true, participantIds: ["account-player", "account-heroine-cover"]
    });
  });

  it("uses profile.pinnedPostId as the only pin source", () => {
    const legacy = structuredClone(createInitialStorySnapshot());
    legacy.profile.pinnedPostId = undefined;
    legacy.posts[0]!.pinned = true;
    const migrated = migrateStorySnapshotV2(legacy);
    expect(migrated.profile.pinnedPostId).toBe(legacy.posts[0]!.id);
    expect(migrated.posts.every((post) => post.pinned === false)).toBe(true);

    const newPost = { ...migrated.posts[0]!, id: "post-ai-new", pinned: true };
    const badReply = turn(migrated, { events: [{ type: "post.upsert", post: { ...newPost, id: "bad-reply", replyToPostId: "missing-post" } }] });
    expect(() => applyAiOutput(migrated, badReply)).toThrow(/Unknown reply post/);
    const badQuote = turn(migrated, { events: [{ type: "post.upsert", post: { ...newPost, id: "bad-quote", quotedPostId: "missing-post" } }] });
    expect(() => applyAiOutput(migrated, badQuote)).toThrow(/Quoted post is unavailable/);
    const published = applyAiOutput(migrated, turn(migrated, { events: [{ type: "post.upsert", post: newPost }] }));
    expect(published.posts.find((post) => post.id === newPost.id)?.pinned).toBe(false);

    const hidden = applyAiOutput(published, turn(published, {
      storyTime: "2026-10-25T17:00+08:00", suffix: "·隐藏",
      events: [{ type: "post.moderate", postId: published.profile.pinnedPostId!, moderation: "hidden" }]
    }));
    expect(hidden.profile.pinnedPostId).toBeUndefined();
  });
});
