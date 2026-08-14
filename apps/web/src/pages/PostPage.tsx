import { useMemo, useState } from "react";
import type { Comment } from "@airp/shared";
import { ArrowLeft, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { PostCard } from "../components/PostCard";
import { Avatar, Empty, Spinner, Verified } from "../components/ui";
import { useSnapshot, useTurnMutation } from "../hooks/use-airp";
import { compactNumber, storyDate } from "../lib/format";

function CommentItem({ comment, childrenByParent, snapshot, onReply, depth = 0 }: { comment: Comment; childrenByParent: Map<string, Comment[]>; snapshot: NonNullable<ReturnType<typeof useSnapshot>["data"]>; onReply: (comment: Comment) => void; depth?: number }) {
  const [showDeeper, setShowDeeper] = useState(false);
  const author = snapshot.accounts.find((item) => item.id === comment.authorId);
  if (!author || comment.moderation === "deleted" || comment.moderation === "hidden") return null;
  const children = childrenByParent.get(comment.id) ?? [];
  const nestingClass = depth === 0 ? "" : `${depth <= 2 ? "ml-8 " : ""}border-l-2 border-line pl-2`;
  return <div className={nestingClass}>
    <article className="border-b border-line px-4 py-3 hover:bg-slate-50">
      <div className="flex gap-3"><Avatar name={author.displayName} seed={author.avatarSeed} text={author.avatarText} url={author.avatarUrl} /><div className="min-w-0 flex-1">
        <div className="text-[15px]"><span className="font-bold">{author.displayName}{author.verified && <Verified />}</span><span className="ml-1 text-muted">@{author.handle} · {storyDate(comment.createdAt)}</span></div>
        {comment.moderation === "limited" && <div className="my-1 text-xs text-amber-600">此回复的可见范围受到限制</div>}
        <p className="plain-content mt-1 text-[15px] leading-5">{comment.text}</p>
        <div className="mt-2 flex max-w-sm justify-between text-xs text-muted"><button className="flex items-center gap-1 hover:text-accent" onClick={() => onReply(comment)}><MessageCircle size={16} />{compactNumber(comment.metrics.replies)}</button><span className="flex items-center gap-1"><Repeat2 size={16} />{compactNumber(comment.metrics.reposts)}</span><span className="flex items-center gap-1"><Heart size={16} />{compactNumber(comment.metrics.likes)}</span></div>
      </div></div>
    </article>
    {(depth < 5 || showDeeper) && children.map((child) => <CommentItem key={child.id} comment={child} childrenByParent={childrenByParent} snapshot={snapshot} onReply={onReply} depth={depth + 1} />)}
    {depth >= 5 && !showDeeper && children.length > 0 && <button className="ml-4 my-2 text-xs font-bold text-accent hover:underline" onClick={() => setShowDeeper(true)}>展开 {children.length} 条更深回复</button>}
  </div>;
}

export function PostPage() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useSnapshot();
  const turn = useTurnMutation();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Comment>();
  const post = data?.posts.find((item) => item.id === postId && item.moderation !== "hidden" && item.moderation !== "deleted");
  const comments = useMemo(() => data?.comments.filter((item) => item.postId === postId) ?? [], [data, postId]);
  const childrenByParent = useMemo(() => {
    const grouped = new Map<string, Comment[]>();
    for (const comment of comments) {
      if (!comment.parentId) continue;
      const list = grouped.get(comment.parentId) ?? [];
      list.push(comment);
      grouped.set(comment.parentId, list);
    }
    return grouped;
  }, [comments]);
  if (isLoading) return <div className="p-8"><Spinner /></div>;
  if (!data || !post) return <Empty title="找不到这条帖文" detail="它可能已被剧情事件删除。" />;
  const player = data.accounts.find((item) => item.id === "account-player");
  if (!player) return <Empty title="玩家账号缺失" detail="请从备份恢复或检查角色账号配置。" />;
  const submit = () => {
    if (!text.trim() || text.length > 12_000 || turn.isPending) return;
    const value = text.trim();
    const parent = replyTo;
    turn.mutate(
      { kind: "comment", branchId: data.session.activeBranchId, postId: post.id, ...(parent ? { parentCommentId: parent.id } : {}), text: value },
      { onSuccess: () => { setText((current) => current.trim() === value ? "" : current); setReplyTo((current) => current?.id === parent?.id ? undefined : current); } }
    );
  };
  return <div>
    <header className="sticky top-0 z-20 flex h-[53px] items-center gap-7 border-b border-line bg-white/90 px-3 backdrop-blur-md"><button aria-label="返回" className="x-icon-button" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button><h1 className="panel-title">帖文</h1></header>
    <PostCard post={post} snapshot={data} detail />
    <section className="border-b border-line px-4 py-3">
      {replyTo && <div className="mb-2 flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2 text-sm text-muted"><span>回复 @{data.accounts.find((item) => item.id === replyTo.authorId)?.handle}</span><button onClick={() => setReplyTo(undefined)}>取消</button></div>}
      <div className="flex gap-3"><Avatar name={player.displayName} seed={player.avatarSeed} text={player.avatarText} url={player.avatarUrl} /><div className="flex-1"><textarea maxLength={12_000} className="min-h-20 w-full resize-none border-0 py-2 text-lg outline-none placeholder:text-muted" placeholder="发布你的回复" value={text} onChange={(event) => setText(event.target.value)} /><div className="flex items-center justify-between border-t border-line pt-2"><span className="text-xs text-muted">{text.length}/12000</span><button className="rounded-full bg-accent px-5 py-2 font-bold text-white disabled:opacity-50" disabled={!text.trim() || text.length > 12_000 || turn.isPending} onClick={submit}>{turn.isPending ? "生成中…" : "回复"}</button></div></div></div>
      {turn.error && <div role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{turn.error.message}<div className="mt-1 text-xs">输入内容已保留；若回复已出现在评论区，请勿重复发送，可从会话状态重试。</div></div>}
    </section>
    {comments.filter((item) => !item.parentId).map((comment) => <CommentItem key={comment.id} comment={comment} childrenByParent={childrenByParent} snapshot={data} onReply={setReplyTo} />)}
    {comments.length === 0 && <Empty title="还没有回复" detail="发送第一条评论会开启新一轮剧情。" />}
  </div>;
}
