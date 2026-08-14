import type { Account, AppSnapshot, Post } from "@airp/shared";
import { BarChart3, Bookmark, Heart, MessageCircle, Radio, Repeat2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { compactNumber, storyDate } from "../lib/format";
import { useLocalActionMutation } from "../hooks/use-airp";
import { Avatar, Verified } from "./ui";
import { useUiStore } from "../store/ui";

function MediaCard({ media }: { media: Post["media"][number] }) {
  return <div role="group" aria-label={media.altText ?? media.title ?? `${media.kind} 文字媒体`} className={`mt-3 overflow-hidden rounded-2xl border border-slate-300 ${media.tone === "night" ? "bg-slate-900 text-white" : media.tone === "dramatic" ? "bg-gradient-to-br from-rose-50 to-violet-100" : "bg-slate-50"}`}>
    <div className="relative min-h-36 p-5">
      <div className="mb-8 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-70">{media.kind === "image" ? "图片文字实况" : media.kind === "video" ? "视频文字实况" : <><Radio size={14} className="text-rose-500" />直播文字实况</>}</div>
      {media.title && <div className="text-lg font-extrabold">{media.title}</div>}
      <p className="plain-content mt-1 text-sm leading-6">{media.description}</p>
      {media.subtitle && <div className="mt-3 inline-block rounded bg-black/75 px-2 py-1 text-xs text-white">{media.subtitle}</div>}
      {media.durationSeconds && <div className="absolute bottom-3 right-3 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">{Math.floor(media.durationSeconds / 60)}:{String(media.durationSeconds % 60).padStart(2, "0")}</div>}
    </div>
    {media.kind === "video" && <div className="h-1 bg-slate-200"><div className="h-full w-[38%] bg-accent" /></div>}
  </div>;
}

function PollCard({ post, branchId }: { post: Post; branchId: string }) {
  const action = useLocalActionMutation();
  if (!post.poll) return null;
  const total = post.poll.options.reduce((sum, option) => sum + option.votes, 0);
  return <div className="mt-3 space-y-2" onClick={(event) => event.stopPropagation()}>
    <div className="font-bold">{post.poll.question}</div>
    {post.poll.options.map((option) => {
      const percentage = total ? Math.round(option.votes / total * 100) : 0;
      const chosen = post.poll?.playerChoiceId === option.id;
      return <button key={option.id} disabled={Boolean(post.poll?.playerChoiceId) || post.poll?.closed || action.isPending} onClick={() => action.mutate({ kind: "poll_vote", branchId, postId: post.id, optionId: option.id })} className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm font-bold ${chosen ? "border-accent" : "border-slate-300"}`}>
        <span className="absolute inset-y-0 left-0 bg-sky-100" style={{ width: `${percentage}%` }} /><span className="relative flex justify-between"><span>{option.label}</span><span>{percentage}%</span></span>
      </button>;
    })}
    <div className="text-xs text-muted">{compactNumber(total)} 票 · {post.poll.closed ? "投票已结束" : `截止 ${storyDate(post.poll.endsAt)}`}</div>
  </div>;
}

export function PostCard({ post, snapshot, detail = false }: { post: Post; snapshot: AppSnapshot; detail?: boolean }) {
  const navigate = useNavigate();
  const action = useLocalActionMutation();
  const revealPlan = useUiStore((state) => state.revealPlan);
  const revealPanel = revealPlan?.panels.find((panel) => panel.targetId === post.id && (panel.kind === "post" || panel.kind === "poll"));
  const author = snapshot.accounts.find((item) => item.id === post.authorId) as Account | undefined;
  const flags = snapshot.mvu.platform.flags;
  const act = (kind: "like" | "repost" | "bookmark") => {
    const active = flags[`${kind}:${post.id}`] !== true;
    action.mutate({ kind, branchId: snapshot.session.activeBranchId, postId: post.id, active });
  };
  const replyTo = post.replyToPostId ? snapshot.posts.find((item) => item.id === post.replyToPostId) : undefined;
  const quoted = post.quotedPostId ? snapshot.posts.find((item) => item.id === post.quotedPostId && item.moderation !== "hidden" && item.moderation !== "deleted") : undefined;
  const quotedAuthor = quoted ? snapshot.accounts.find((item) => item.id === quoted.authorId) : undefined;
  if (!author || post.moderation === "deleted" || post.moderation === "hidden") return null;
  return <article tabIndex={detail ? undefined : 0} role={detail ? undefined : "link"} aria-label={detail ? undefined : `打开 ${author.displayName} 的帖文`} style={revealPanel ? { animationDelay: `${revealPanel.delayMs}ms` } : undefined} onKeyDown={(event) => { if (!detail && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); navigate(`/post/${post.id}`); } }} onClick={() => !detail && navigate(`/post/${post.id}`)} className={`${detail ? "" : "cursor-pointer hover:bg-slate-50/70"} border-b border-line px-4 py-3 transition reveal-item`}>
    <div className="flex gap-3">
      <Avatar name={author.displayName} seed={author.avatarSeed} text={author.avatarText} url={author.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center text-[15px]"><span className="truncate font-bold">{author.displayName}{author.verified && <Verified />}</span><span className="ml-1 truncate text-muted">@{author.handle} · {storyDate(post.createdAt)}</span></div>
        {post.pinned && <div className="mb-1 text-xs font-bold text-muted">置顶帖文</div>}
        {replyTo && <div className="mb-1 text-xs text-muted">回复 @{snapshot.accounts.find((item) => item.id === replyTo.authorId)?.handle ?? "未知账号"}</div>}
        {(post.visibility !== "public" || post.moderation === "limited") && <div className="mb-1 flex gap-2 text-xs font-bold text-amber-600">{post.visibility === "followers" && <span>仅关注者可见</span>}{post.visibility === "private_setting" && <span>私密设定</span>}{post.moderation === "limited" && <span>可见范围受限</span>}</div>}
        <p className={`${detail ? "text-[20px] leading-7" : "text-[15px] leading-5"} plain-content mt-0.5`}>{post.text}</p>
        {post.media.map((media) => <MediaCard key={media.id} media={media} />)}
        {quoted && quotedAuthor && <div className="mt-3 rounded-2xl border border-slate-300 p-3"><div className="text-sm"><span className="font-bold">{quotedAuthor.displayName}</span><span className="ml-1 text-muted">@{quotedAuthor.handle}</span></div><p className="plain-content mt-1 text-sm leading-5">{quoted.text}</p>{quoted.media.length > 0 && <div className="mt-2 text-xs text-muted">含 {quoted.media.length} 个文字媒体</div>}</div>}
        <PollCard post={post} branchId={snapshot.session.activeBranchId} />
        <div className={`mt-3 flex max-w-[510px] justify-between text-muted ${revealPanel ? "metric-pop" : ""}`} onClick={(event) => event.stopPropagation()}>
          <button aria-label={`查看评论，${post.metrics.replies} 条`} className="group flex items-center gap-1 text-xs hover:text-accent" onClick={() => navigate(`/post/${post.id}`)}><span className="x-icon-button h-8 w-8 group-hover:bg-sky-50"><MessageCircle size={18} /></span>{compactNumber(post.metrics.replies)}</button>
          <button aria-label={flags[`repost:${post.id}`] ? "取消转帖" : "转帖"} className={`group flex items-center gap-1 text-xs ${flags[`repost:${post.id}`] ? "text-emerald-500" : "hover:text-emerald-500"}`} onClick={() => act("repost")}><span className="x-icon-button h-8 w-8 group-hover:bg-emerald-50"><Repeat2 size={18} /></span>{compactNumber(post.metrics.reposts)}</button>
          <button aria-label={flags[`like:${post.id}`] ? "取消喜欢" : "喜欢"} className={`group flex items-center gap-1 text-xs ${flags[`like:${post.id}`] ? "text-rose-500" : "hover:text-rose-500"}`} onClick={() => act("like")}><span className="x-icon-button h-8 w-8 group-hover:bg-rose-50"><Heart size={18} fill={flags[`like:${post.id}`] ? "currentColor" : "none"} /></span>{compactNumber(post.metrics.likes)}</button>
          <span aria-label={`${post.metrics.views} 次查看`} className="flex items-center gap-2 text-xs"><BarChart3 size={17} />{compactNumber(post.metrics.views)}</span>
          <button aria-label={flags[`bookmark:${post.id}`] ? "移除书签" : "添加书签"} className={`x-icon-button h-8 w-8 ${flags[`bookmark:${post.id}`] ? "text-accent" : ""}`} onClick={() => act("bookmark")}><Bookmark size={17} fill={flags[`bookmark:${post.id}`] ? "currentColor" : "none"} /></button>
        </div>
      </div>
    </div>
  </article>;
}
