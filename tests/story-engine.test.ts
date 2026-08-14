import { describe, expect, it } from "vitest";
import type { AiTurnOutput } from "@airp/shared";
import { createInitialStorySnapshot } from "../apps/server/src/db/defaults";
import { applyAiOutput, normalizeAiTimeline, validateRuleConstraints } from "../apps/server/src/services/story-engine";

function validOutput(): AiTurnOutput {
  return {
    schemaVersion: "1.0",
    storyTime: "2026-10-25T15:12+08:00",
    events: [
      { type: "platform.impact", id: "impact-1", target: "profile", targetId: "account-heroine", kind: "growth", scale: "small" }
    ],
    mvuOperations: [
      { op: "set", path: "heroine.status", value: "进入中庭" },
      { op: "set", path: "heroine.outfit", value: "直播造型（整理后）" },
      { op: "set", path: "heroine.mood", value: "专注" }
    ],
    renderPlan: {
      panels: [
        { id: "panel-profile", kind: "profile", revealOrder: 0, delayMs: 0 }
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
    expect(next.profile.location).toBe("成都 · IFS");
    expect(next.profile.followerCount).toBeGreaterThan(originalFollowers);
    expect(next.mvu.heroine.mood).toBe("专注");
    expect(next.mvu.revision).toBe(1);
  });

  it("rejects prototype paths in MVU patches", () => {
    const output = validOutput();
    output.mvuOperations = [{ op: "set", path: "extensions.__proto__.polluted", value: true }];
    expect(() => applyAiOutput(createInitialStorySnapshot(), output)).toThrow(/Unsafe MVU path/);
  });

  it("starts an increment at zero when an extension counter does not exist yet", () => {
    const output = validOutput();
    output.mvuOperations = [{ op: "increment", path: "extensions.flags.reportCount", value: 1 }];
    const next = applyAiOutput(createInitialStorySnapshot(), output);
    expect(next.mvu.extensions).toMatchObject({ flags: { reportCount: 1 } });
  });

  it("still rejects incrementing an existing non-numeric value", () => {
    const dirty = createInitialStorySnapshot();
    dirty.mvu.extensions.flags = { reportCount: "one" };
    const output = validOutput();
    output.mvuOperations = [{ op: "increment", path: "extensions.flags.reportCount", value: 1 }];
    expect(() => applyAiOutput(dirty, output)).toThrow("MVU increment requires a number");
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
    const newPrivatePost = { ...structuredClone(existingPost), id: "post-count-private", createdAt: "2026-10-25T15:13+08:00", pinned: false };
    const newCoverPost = { ...structuredClone(existingPost), id: "post-count-cover", authorId: "account-heroine-cover", createdAt: "2026-10-25T15:14+08:00", pinned: false };
    const output = validOutput();
    output.events = [
      { type: "post.upsert", post: newPrivatePost },
      { type: "post.upsert", post: newCoverPost }
    ];

    const afterPosts = applyAiOutput(base, output);
    expect(afterPosts.profile.postCount).toBe(baseline + 1);
    expect(afterPosts.posts.find((post) => post.id === newPrivatePost.id)?.visibility).toBe("followers");
    expect(afterPosts.posts.find((post) => post.id === newCoverPost.id)?.visibility).toBe(newCoverPost.visibility);

    const removal = validOutput();
    removal.events = [
      { type: "post.remove", postId: newPrivatePost.id },
      { type: "post.remove", postId: newPrivatePost.id }
    ];
    const afterRemoval = applyAiOutput(afterPosts, removal);
    expect(afterRemoval.profile.postCount).toBe(baseline);

    const overwrite = validOutput();
    overwrite.events = [{ type: "post.upsert", post: { ...existingPost, text: "编辑已有帖文" } }];
    expect(() => applyAiOutput(base, overwrite)).toThrow(/cannot be overwritten/);
  });

  it("spaces generated comments and messages and extends the final story time", () => {
    const base = createInitialStorySnapshot();
    const output = validOutput();
    output.storyTime = base.mvu.storyTime;
    const post = { ...structuredClone(base.posts[0]!), id: "post-timeline", createdAt: output.storyTime, pinned: false };
    const comment = { ...structuredClone(base.comments[0]!), id: "comment-timeline-1", postId: post.id, createdAt: output.storyTime };
    output.events = [
      { type: "post.upsert", post },
      { type: "comment.upsert", comment },
      { type: "comment.upsert", comment: { ...comment, id: "comment-timeline-2", parentId: comment.id } },
      { type: "message.add", message: { id: "message-timeline-1", threadId: "dm-player-heroine", senderId: "account-heroine-cover", createdAt: output.storyTime, text: "第一段", status: "read", isPlayerInput: false } },
      { type: "message.add", message: { id: "message-timeline-2", threadId: "dm-player-heroine", senderId: "account-heroine-cover", createdAt: output.storyTime, text: "第二段", status: "read", isPlayerInput: false } }
    ];

    const normalized = normalizeAiTimeline(base, output);
    const comments = normalized.events.filter((event) => event.type === "comment.upsert");
    const messages = normalized.events.filter((event) => event.type === "message.add");
    expect(Date.parse(comments[1]!.comment.createdAt) - Date.parse(comments[0]!.comment.createdAt)).toBe(45_000);
    expect(Date.parse(messages[1]!.message.createdAt) - Date.parse(messages[0]!.message.createdAt)).toBe(20_000);
    expect(Date.parse(normalized.storyTime)).toBeGreaterThan(Date.parse(output.storyTime));

    const next = applyAiOutput(base, normalized);
    expect(next.mvu.storyTime).toBe(normalized.storyTime);
    expect(next.comments.find((item) => item.id === "comment-timeline-1")?.createdAt).toBe(comments[0]!.comment.createdAt);
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
    expect(() => validateRuleConstraints(base, validOutput(), { minProfileChanges: 0, minPanels: 1, maxPanels: 5 })).not.toThrow();
    const output = validOutput();
    output.renderPlan.panels = [];
    expect(() => validateRuleConstraints(base, output, { minProfileChanges: 0, minPanels: 1, maxPanels: 5 })).toThrow(/panels/);
  });

  it("treats representative comments as a target while requiring one real comment", () => {
    const base = createInitialStorySnapshot();
    const output = validOutput();
    const newPost = { ...structuredClone(base.posts[0]!), id: "post-hard-constraint", pinned: false };
    output.events.push({ type: "post.upsert", post: newPost });
    output.renderPlan.panels.push({ id: "panel-post", kind: "post", targetId: newPost.id, revealOrder: 1, delayMs: 120 });
    const rule = {
      minProfileChanges: 0,
      minPanels: 1,
      maxPanels: 5,
      representativeComments: 15,
      requireProfilePanel: true,
      requireStrictRevealOrder: true,
      requireValidPanelTargets: true,
      minLiveQueueItems: 10,
      maxLiveQueueItems: 25,
      requireLiveBarrage: true,
      enforceFixedAccounts: true
    };
    expect(() => validateRuleConstraints(base, output, rule)).toThrow(/at least 1 accompanying comment/);

    output.events.push({ type: "comment.upsert", comment: { ...structuredClone(base.comments[0]!), id: "comment-representative", postId: newPost.id, parentId: undefined } });
    expect(() => validateRuleConstraints(base, output, rule)).not.toThrow();
  });

  it("allows a post created earlier in the turn to become the pinned post", () => {
    const base = createInitialStorySnapshot();
    const output = validOutput();
    const newPost = { ...structuredClone(base.posts[0]!), id: "post-new-pinned", pinned: false };
    output.events.push(
      { type: "post.upsert", post: newPost },
      { type: "profile.patch", patch: { pinnedPostId: newPost.id, upsertSections: [], removeSectionIds: [] } }
    );
    output.renderPlan.panels.push({ id: "panel-new-post", kind: "post", targetId: newPost.id, revealOrder: 1, delayMs: 120 });
    expect(() => validateRuleConstraints(base, output, { minProfileChanges: 0, minPanels: 1, maxPanels: 5, representativeComments: 0 })).not.toThrow();
  });

  it("enforces live queue length and barrage requirements", () => {
    const base = createInitialStorySnapshot();
    const output = validOutput();
    output.events.push({ type: "live.upsert", live: { ...structuredClone(base.lives[0]!), queue: [] } });
    expect(() => validateRuleConstraints(base, output, {
      minProfileChanges: 0, minPanels: 1, maxPanels: 5,
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
      minProfileChanges: 0, minPanels: 1, maxPanels: 5, enforceFixedAccounts: true
    })).toThrow(/locked account|fixed account/);
  });

  it("enforces valid render targets and strict reveal order", () => {
    const base = createInitialStorySnapshot();
    const badTarget = validOutput();
    badTarget.renderPlan.panels.push({ id: "panel-missing", kind: "dm", targetId: "missing-thread", revealOrder: 1, delayMs: 10 });
    expect(() => validateRuleConstraints(base, badTarget, {
      minProfileChanges: 0, minPanels: 1, maxPanels: 5, requireValidPanelTargets: true
    })).toThrow(/invalid target/);

    const badOrder = validOutput();
    badOrder.renderPlan.panels.push({ id: "panel-profile-2", kind: "profile", revealOrder: 0, delayMs: 10 });
    expect(() => validateRuleConstraints(base, badOrder, {
      minProfileChanges: 0, minPanels: 1, maxPanels: 5, requireStrictRevealOrder: true
    })).toThrow(/strictly increasing/);
  });
});
