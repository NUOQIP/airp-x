import type { LocalAction, StorySnapshot } from "@airp/shared";
import { conflict, notFound } from "./http-error.js";

/** Applies a local UI action to a snapshot without writing the database. */
export function applyLocalActionState(story: StorySnapshot, input: LocalAction) {
  const flags = story.mvu.platform.flags;
  const key = `${input.kind}:${"postId" in input ? input.postId : "accountId" in input ? input.accountId : ""}`;
  if (input.kind === "like" || input.kind === "repost" || input.kind === "bookmark") {
    const post = story.posts.find((item) => item.id === input.postId);
    if (!post) throw notFound("帖文不存在", "POST_NOT_FOUND");
    const previous = flags[key] === true;
    if (previous !== input.active) {
      const metric = input.kind === "like" ? "likes" : input.kind === "repost" ? "reposts" : "bookmarks";
      post.metrics[metric] = Math.max(0, post.metrics[metric] + (input.active ? 1 : -1));
    }
    flags[key] = input.active;
  } else if (input.kind === "follow") {
    flags[key] = input.active;
  } else {
    const post = story.posts.find((item) => item.id === input.postId);
    if (!post?.poll) throw notFound("投票不存在", "POLL_NOT_FOUND");
    if (post.poll.closed) throw conflict("投票已经结束", "POLL_CLOSED");
    if (post.poll.playerChoiceId) throw conflict("玩家已经投过票", "POLL_ALREADY_VOTED");
    const option = post.poll.options.find((item) => item.id === input.optionId);
    if (!option) throw notFound("投票选项不存在", "POLL_OPTION_NOT_FOUND");
    option.votes += 1;
    post.poll.playerChoiceId = input.optionId;
  }
  story.mvu.revision += 1;
  return story;
}
