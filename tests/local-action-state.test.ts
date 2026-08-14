import { describe, expect, it } from "vitest";
import { createInitialStorySnapshot } from "../apps/server/src/db/defaults.js";
import { applyLocalActionState } from "../apps/server/src/services/local-action-state.js";

describe("local action snapshot replay", () => {
  it("replays likes idempotently so candidate switching cannot lose them", () => {
    const story = createInitialStorySnapshot();
    const post = story.posts[0]!;
    const baseline = post.metrics.likes;
    const action = { kind: "like" as const, branchId: "branch", postId: post.id, active: true };
    applyLocalActionState(story, action);
    applyLocalActionState(story, action);
    expect(post.metrics.likes).toBe(baseline + 1);
    expect(story.mvu.platform.flags[`like:${post.id}`]).toBe(true);
  });

  it("preserves non-negative metrics when replaying removal", () => {
    const story = createInitialStorySnapshot();
    const post = story.posts[0]!;
    post.metrics.bookmarks = 0;
    story.mvu.platform.flags[`bookmark:${post.id}`] = true;
    applyLocalActionState(story, { kind: "bookmark", branchId: "branch", postId: post.id, active: false });
    expect(post.metrics.bookmarks).toBe(0);
  });
});
