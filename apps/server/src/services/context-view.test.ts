import { describe, expect, it } from "vitest";
import type { PlayerTurnInput, StorySnapshot } from "@airp/shared";
import { createInitialStorySnapshot } from "../db/defaults.js";
import { buildMvuContextState, buildProfileContextState, buildRecentPlatformContext, buildRecentPlatformScanText, hiddenDirectorInstruction, visibleTurnText } from "./context-view.js";

describe("context view", () => {
  it("keeps the hidden director instruction out of character-visible text", () => {
    const input: PlayerTurnInput = {
      kind: "dm",
      branchId: "branch",
      threadId: "thread",
      speechSegments: ["第一段", "第二段"],
      directorInstruction: "推进到第二天"
    };
    expect(visibleTurnText(input)).toBe("第一段\n第二段");
    expect(hiddenDirectorInstruction(input)).toBe("推进到第二天");
    expect(visibleTurnText(input)).not.toContain("推进到第二天");
  });

  it("supports a director-only turn without inventing visible speech", () => {
    const input: PlayerTurnInput = { kind: "dm", branchId: "branch", threadId: "thread", speechSegments: [], directorInstruction: "继续剧情" };
    expect(visibleTurnText(input)).toBe("");
    expect(hiddenDirectorInstruction(input)).toBe("继续剧情");
  });

  it("omits dynamic render-cache values while retaining literal and append-only history", () => {
    const snapshot = {
      accounts: [{ id: "account-heroine", displayName: "Heroine", handle: "heroine", avatarSeed: "seed", avatarUrl: "data:image/png;base64,secret", verified: false, bio: "canonical-in-mvu", isPrivate: true }],
      profile: {
        accountId: "account-heroine",
        bannerTone: "rose",
        bannerUrl: "data:image/png;base64,secret",
        location: "cache-location",
        joinedAt: "2026",
        followerCount: 10,
        postCount: 2,
        currentStoryTime: "2026-01-01T00:00+08:00",
        sections: [{
          id: "section",
          title: "记录",
          kind: "timeline",
          page: "records",
          order: 1,
          origin: "initial",
          items: [
            { id: "dynamic", value: "duplicate cache", emphasis: "normal", permission: "temporary", origin: "initial", source: { kind: "mvu", path: "heroine.status" } },
            { id: "computed", value: "duplicate computed", emphasis: "normal", permission: "computed", origin: "initial", source: { kind: "derived", path: "cycle.phase" } },
            { id: "cycle-next-change", value: "internal cycle time", emphasis: "normal", permission: "computed", origin: "initial", source: { kind: "derived", path: "cycle.nextChangeAt" } },
            { id: "daily-reset", value: "internal time", emphasis: "normal", permission: "computed", origin: "initial", source: { kind: "derived", path: "statistics.nextDailyResetAt" } },
            { id: "literal", value: "fixed fact", emphasis: "normal", permission: "locked", origin: "initial", source: { kind: "literal", path: "profile.sections.section.items.literal.value" } },
            { id: "history", value: "old event", emphasis: "normal", permission: "append_only", origin: "initial", source: { kind: "event_log", path: "profile.sections.section.items" } }
          ]
        }]
      },
      trends: []
    } as unknown as StorySnapshot;
    const context = buildProfileContextState(snapshot);
    const items = context.structure.sections[0]!.items;
    expect(items.find((item) => item.id === "dynamic")).not.toHaveProperty("value");
    expect(items.find((item) => item.id === "computed")).not.toHaveProperty("value");
    expect(items.find((item) => item.id === "cycle-next-change")).toBeUndefined();
    expect(items.find((item) => item.id === "daily-reset")).toBeUndefined();
    expect(items.find((item) => item.id === "literal")).toHaveProperty("value", "fixed fact");
    expect(items.find((item) => item.id === "history")).toHaveProperty("value", "old event");
    expect(context.account).not.toHaveProperty("avatarUrl");
    expect(context.account).not.toHaveProperty("bio");
    expect(context.structure).not.toHaveProperty("bannerUrl");
    expect(context.structure).not.toHaveProperty("location");
    expect(context.structure).not.toHaveProperty("currentStoryTime");
  });

  it("keeps the daily reset timestamp in program state but out of AI-visible MVU", () => {
    const snapshot = createInitialStorySnapshot();
    const resetAt = snapshot.mvu.derived.statistics.nextDailyResetAt;
    const cycleChangeAt = snapshot.mvu.derived.cycle.nextChangeAt;
    const context = buildMvuContextState(snapshot);
    expect(resetAt).toBeTruthy();
    expect(cycleChangeAt).toBeTruthy();
    expect(context.derived.cycle).not.toHaveProperty("nextChangeAt");
    expect(context.derived.statistics).not.toHaveProperty("nextDailyResetAt");
    expect(context.platform).not.toHaveProperty("audiencePool");
    expect(snapshot.mvu.derived.cycle.nextChangeAt).toBe(cycleChangeAt);
    expect(snapshot.mvu.derived.statistics.nextDailyResetAt).toBe(resetAt);
  });

  it("excludes the current input and marks older failed inputs as unanswered", () => {
    const metrics = { replies: 0, reposts: 0, likes: 0, views: 0, bookmarks: 0 };
    const snapshot = {
      posts: [], notices: [],
      comments: [
        { id: "current-comment", postId: "post", authorId: "account-player", createdAt: "2026-01-01T00:00+08:00", text: "当前评论", metrics, moderation: "visible" },
        { id: "failed-comment", postId: "post", authorId: "account-player", createdAt: "2026-01-01T00:00+08:00", text: "失败评论", metrics, moderation: "visible" },
        { id: "normal-comment", postId: "post", authorId: "npc", createdAt: "2026-01-01T00:00+08:00", text: "普通评论", metrics, moderation: "visible" }
      ],
      messages: [
        { id: "current-message", threadId: "dm", senderId: "account-player", createdAt: "2026-01-01T00:00+08:00", text: "当前私信", status: "sent", isPlayerInput: true, turnId: "turn-current" },
        { id: "failed-message", threadId: "dm", senderId: "account-player", createdAt: "2026-01-01T00:00+08:00", text: "失败私信", status: "sent", isPlayerInput: true, turnId: "turn-failed" },
        { id: "normal-message", threadId: "dm", senderId: "npc", createdAt: "2026-01-01T00:00+08:00", text: "普通私信", status: "read", isPlayerInput: false, turnId: "turn-old" }
      ]
    } as unknown as StorySnapshot;
    const options = {
      currentTurnId: "turn-current",
      currentRecordIds: new Set(["current-comment"]),
      failedTurnIds: new Set(["turn-failed"]),
      failedRecordIds: new Set(["failed-comment"])
    };

    const context = buildRecentPlatformContext(snapshot, options);
    expect(context.messages.map((message) => message.id)).not.toContain("current-message");
    expect(context.comments.map((comment) => comment.id)).not.toContain("current-comment");
    expect(context.messages.find((message) => message.id === "failed-message")).toMatchObject({ responseState: "unanswered_failed_turn" });
    expect(context.comments.find((comment) => comment.id === "failed-comment")).toMatchObject({ responseState: "unanswered_failed_turn" });

    const scan = buildRecentPlatformScanText(snapshot, options);
    expect(scan.messages).toEqual(["普通私信"]);
    expect(scan.comments).toEqual(["普通评论"]);
  });
});
