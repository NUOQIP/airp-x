import type { StorySnapshot } from "@airp/shared";

export function synchronizeDerivedProfileStats(snapshot: StorySnapshot): StorySnapshot {
  snapshot.profile.postCount = snapshot.posts.filter((post) =>
    post.authorId === snapshot.profile.accountId && post.moderation !== "deleted"
  ).length;
  return snapshot;
}
