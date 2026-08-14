import { describe, expect, it } from "vitest";
import type { AiTurnOutput } from "@airp/shared";
import { createInitialStorySnapshot } from "../apps/server/src/db/defaults";
import { applyAiOutput, validateRuleConstraints } from "../apps/server/src/services/story-engine";

function validOutput(): AiTurnOutput {
  return {
    schemaVersion: "1.0",
    storyTime: "2026-10-25T15:12+08:00",
    events: [
      {
        type: "profile.patch",
        patch: {
          location: "成都 · 中庭",
          bannerTone: "violet",
          pinnedPostId: "post-live-now",
          upsertSections: [],
          removeSectionIds: []
        }
      },
      { type: "platform.impact", id: "impact-1", target: "profile", targetId: "account-heroine", kind: "growth", scale: "small" }
    ],
    mvuOperations: [{ op: "set", path: "heroine.mood", value: "专注" }],
    renderPlan: {
      panels: [
        { id: "panel-profile", kind: "profile", revealOrder: 0, delayMs: 0 },
        { id: "panel-dm", kind: "dm", targetId: "dm-player-heroine", revealOrder: 1, delayMs: 120 },
        { id: "panel-live", kind: "live", targetId: "live-main", revealOrder: 2, delayMs: 240 }
      ]
    },
    memoryNote: "主播进入中庭，主页状态同步变化。"
  };
}

describe("story engine", () => {
  it("applies typed events and MVU operations without mutating the base snapshot", () => {
    const base = createInitialStorySnapshot();
    const originalFollowers = base.profile.followerCount;
    const next = applyAiOutput(base, validOutput());
    expect(base.profile.location).toBe("成都");
    expect(next.profile.location).toBe("成都 · 中庭");
    expect(next.profile.followerCount).toBeGreaterThan(originalFollowers);
    expect(next.mvu.heroine.mood).toBe("专注");
    expect(next.mvu.revision).toBe(1);
  });

  it("rejects prototype paths in MVU patches", () => {
    const output = validOutput();
    output.mvuOperations = [{ op: "set", path: "extensions.__proto__.polluted", value: true }];
    expect(() => applyAiOutput(createInitialStorySnapshot(), output)).toThrow(/Unsafe MVU path/);
  });

  it("keeps the player DM on the heroine cover account", () => {
    const output = validOutput();
    output.events.push({
      type: "message.add",
      message: {
        id: "message-cover-check",
        threadId: "dm-player-heroine",
        senderId: "account-heroine",
        createdAt: output.storyTime,
        text: "表账号私信",
        status: "read",
        isPlayerInput: false
      }
    });

    const next = applyAiOutput(createInitialStorySnapshot(), output);

    expect(next.messages.find((message) => message.id === "message-cover-check")?.senderId).toBe("account-heroine-cover");
    expect(next.threads.find((thread) => thread.id === "dm-player-heroine")?.participantIds).toEqual(["account-player", "account-heroine-cover"]);
  });

  it("maintains the profile post count from post lifecycle events", () => {
    const base = createInitialStorySnapshot();
    const baseline = base.profile.postCount;
    const existingPost = structuredClone(base.posts[0]!);
    existingPost.text = "编辑已有帖文";
    const newPrivatePost = { ...structuredClone(existingPost), id: "post-count-private", createdAt: "2026-10-25T15:13+08:00", pinned: false };
    const newCoverPost = { ...structuredClone(existingPost), id: "post-count-cover", authorId: "account-heroine-cover", createdAt: "2026-10-25T15:14+08:00", pinned: false };
    const output = validOutput();
    output.events = [
      { type: "post.upsert", post: existingPost },
      { type: "post.upsert", post: newPrivatePost },
      { type: "post.upsert", post: newCoverPost }
    ];

    const afterPosts = applyAiOutput(base, output);
    expect(afterPosts.profile.postCount).toBe(baseline + 1);

    const removal = validOutput();
    removal.events = [
      { type: "post.remove", postId: newPrivatePost.id },
      { type: "post.remove", postId: newPrivatePost.id }
    ];
    const afterRemoval = applyAiOutput(afterPosts, removal);
    expect(afterRemoval.profile.postCount).toBe(baseline);
  });

  it("replaces an imported post total with the actual stored post count", () => {
    const base = createInitialStorySnapshot();
    base.posts = [];
    base.profile.postCount = 2_400;

    const next = applyAiOutput(base, validOutput());

    expect(next.profile.postCount).toBe(0);
  });

  it("enforces the configured render and homepage constraints", () => {
    const base = createInitialStorySnapshot();
    expect(() => validateRuleConstraints(base, validOutput(), { minProfileChanges: 3, minPanels: 3, maxPanels: 5 })).not.toThrow();
    const output = validOutput();
    output.renderPlan.panels = output.renderPlan.panels.slice(0, 1);
    expect(() => validateRuleConstraints(base, output, { minProfileChanges: 3, minPanels: 3, maxPanels: 5 })).toThrow(/panels/);
  });

  it("enforces representative comments for new posts", () => {
    const base = createInitialStorySnapshot();
    const output = validOutput();
    const newPost = { ...structuredClone(base.posts[0]!), id: "post-hard-constraint", pinned: false };
    output.events.push({ type: "post.upsert", post: newPost });
    output.renderPlan.panels[1] = { id: "panel-post", kind: "post", targetId: newPost.id, revealOrder: 1, delayMs: 120 };
    expect(() => validateRuleConstraints(base, output, {
      minProfileChanges: 3,
      minPanels: 3,
      maxPanels: 5,
      representativeComments: 15,
      requireProfilePanel: true,
      requireStrictRevealOrder: true,
      requireValidPanelTargets: true,
      minLiveQueueItems: 10,
      maxLiveQueueItems: 25,
      requireLiveBarrage: true,
      enforceFixedAccounts: true
    })).toThrow(/15 accompanying comments/);
  });

  it("enforces live queue length and barrage requirements", () => {
    const base = createInitialStorySnapshot();
    const output = validOutput();
    output.events.push({ type: "live.upsert", live: { ...structuredClone(base.lives[0]!), queue: [] } });
    expect(() => validateRuleConstraints(base, output, {
      minProfileChanges: 3, minPanels: 3, maxPanels: 5,
      minLiveQueueItems: 10, maxLiveQueueItems: 25, requireLiveBarrage: true
    })).toThrow(/queue must contain 10-25 items/);
  });

  it("enforces fixed account identities", () => {
    const base = createInitialStorySnapshot();
    const output = validOutput();
    output.events.push({
      type: "account.upsert",
      account: { ...structuredClone(base.accounts.find((account) => account.id === "account-heroine")!), handle: "changed-handle" }
    });
    expect(() => validateRuleConstraints(base, output, {
      minProfileChanges: 3, minPanels: 3, maxPanels: 5, enforceFixedAccounts: true
    })).toThrow(/fixed account account-heroine identity/);
  });

  it("enforces valid render targets and strict reveal order", () => {
    const base = createInitialStorySnapshot();
    const badTarget = validOutput();
    badTarget.renderPlan.panels[1]!.targetId = "missing-thread";
    expect(() => validateRuleConstraints(base, badTarget, {
      minProfileChanges: 3, minPanels: 3, maxPanels: 5, requireValidPanelTargets: true
    })).toThrow(/invalid target/);

    const badOrder = validOutput();
    badOrder.renderPlan.panels[1]!.revealOrder = 0;
    expect(() => validateRuleConstraints(base, badOrder, {
      minProfileChanges: 3, minPanels: 3, maxPanels: 5, requireStrictRevealOrder: true
    })).toThrow(/strictly increasing/);
  });
});
