import type { StorySnapshot } from "@airp/shared";
import { migrateStorySnapshotV2 } from "./snapshot-migration.js";

export function synchronizeDerivedProfileStats(snapshot: StorySnapshot): StorySnapshot {
  const normalized = migrateStorySnapshotV2(snapshot);
  normalized.profile.postCount = normalized.posts.filter((post) =>
    post.authorId === normalized.profile.accountId && post.moderation !== "deleted"
  ).length;
  return normalized;
}
