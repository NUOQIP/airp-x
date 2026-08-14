import { useEffect, useMemo, useRef, useState } from "react";
import { LockKeyhole, Mail, Pencil, Search, Send } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AvatarEditor } from "../components/AvatarEditor";
import { Avatar, Empty, Spinner } from "../components/ui";
import { useSnapshot, useTurnMutation } from "../hooks/use-airp";
import { storyDate } from "../lib/format";
import { useUiStore } from "../store/ui";

export function MessagesPage() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useSnapshot();
  const turn = useTurnMutation();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [replyToId, setReplyToId] = useState<string>();
  const [avatarAccountId, setAvatarAccountId] = useState<string>();
  const revealPlan = useUiStore((state) => state.revealPlan);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threads = useMemo(() => data ? [...data.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [], [data]);
  const selected = threads.find((thread) => thread.id === threadId) ?? threads[0];
  const messagesByThread = useMemo(() => {
    const grouped = new Map<string, NonNullable<typeof data>["messages"]>();
    for (const message of data?.messages ?? []) {
      const list = grouped.get(message.threadId) ?? [];
      list.push(message);
      grouped.set(message.threadId, list);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return grouped;
  }, [data]);
  const messages = selected ? messagesByThread.get(selected.id) ?? [] : [];
  const visibleThreads = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle || !data) return threads;
    return threads.filter((thread) => {
      const participants = thread.participantIds
        .map((id) => data.accounts.find((account) => account.id === id))
        .filter(Boolean)
        .map((account) => `${account?.displayName ?? ""} @${account?.handle ?? ""}`)
        .join(" ");
      const recentText = (messagesByThread.get(thread.id) ?? []).slice(-20).map((message) => message.text).join(" ");
      return `${thread.title} ${participants} ${recentText}`.toLocaleLowerCase().includes(needle);
    });
  }, [data, messagesByThread, search, threads]);
  useEffect(() => { if (!threadId && selected) navigate(`/messages/${selected.id}`, { replace: true }); }, [threadId, selected, navigate]);
  useEffect(() => { setText(""); setReplyToId(undefined); }, [selected?.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, turn.isPending]);
  if (isLoading) return <div className="p-8"><Spinner label="载入私信" /></div>;
  if (!data || !selected) return <Empty title="没有私信" detail="AI 创建的会话会出现在这里。" />;
  const selectedMembers = selected.participantIds.map((id) => data.accounts.find((account) => account.id === id)).filter(Boolean);
  const selectedIncludesPlayer = selected.participantIds.includes("account-player");
  const selectedAvatar = selectedIncludesPlayer
    ? selectedMembers.find((item) => item?.id !== "account-player") ?? selectedMembers[0]
    : selectedMembers.find((item) => item?.id !== "account-heroine" && item?.id !== "account-heroine-cover") ?? selectedMembers[0];
  const avatarEditorAccount = data.accounts.find((account) => account.id === avatarAccountId);
  const submit = () => {
    if (!text.trim() || !selected.playerCanSend || turn.isPending) return;
    const value = text.trim();
    const replyId = replyToId;
    turn.mutate(
      { kind: selected.kind, branchId: data.session.activeBranchId, threadId: selected.id, ...(replyId ? { replyToMessageId: replyId } : {}), text: value },
      { onSuccess: () => { setText((current) => current.trim() === value ? "" : current); setReplyToId((current) => current === replyId ? undefined : current); } }
    );
  };
  return <div className="grid h-screen grid-cols-[255px_1fr] overflow-hidden">
    <section className="border-r border-line">
      <header className="flex h-[53px] items-center justify-between px-4"><h1 className="panel-title">私信</h1><Mail size={20} /></header>
      <div className="mx-3 mb-2 flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-muted"><Search size={16} /><input aria-label="搜索私信" className="w-full bg-transparent text-sm outline-none" placeholder="搜索私信" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="h-[calc(100vh-103px)] overflow-y-auto">
        {visibleThreads.map((thread) => {
          const members = thread.participantIds.map((id) => data.accounts.find((account) => account.id === id)).filter(Boolean);
          const includesPlayer = thread.participantIds.includes("account-player");
          const avatar = includesPlayer
            ? members.find((item) => item?.id !== "account-player") ?? members[0]
            : members.find((item) => item?.id !== "account-heroine" && item?.id !== "account-heroine-cover") ?? members[0];
          const last = messagesByThread.get(thread.id)?.at(-1);
          return <button key={thread.id} onClick={() => navigate(`/messages/${thread.id}`)} className={`flex w-full gap-3 px-3 py-3 text-left hover:bg-slate-50 ${selected.id === thread.id ? "border-r-2 border-accent bg-sky-50/60" : ""}`}>
            <Avatar name={avatar?.displayName ?? thread.title} seed={avatar?.avatarSeed ?? thread.id} text={avatar?.avatarText} url={avatar?.avatarUrl} />
            <div className="min-w-0 flex-1"><div className="flex items-center"><span className="truncate text-sm font-bold">{thread.title}</span>{thread.kind === "group" && <span className="ml-1 text-[10px] text-muted">群组</span>}</div><div className="truncate text-xs text-muted">{last?.text ?? "暂无消息"}</div></div>
            {thread.unreadCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] text-white">{thread.unreadCount}</span>}
          </button>;
        })}
        {visibleThreads.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted">没有匹配的私信</div>}
      </div>
    </section>
    <section className="flex min-w-0 flex-col">
      <header className="flex h-[53px] shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {selectedAvatar && <button type="button" aria-label={`编辑${selectedAvatar.displayName}的头像`} title="编辑此账号头像" className="group relative rounded-full" onClick={() => setAvatarAccountId(selectedAvatar.id)}>
            <Avatar name={selectedAvatar.displayName} seed={selectedAvatar.avatarSeed} text={selectedAvatar.avatarText} url={selectedAvatar.avatarUrl} size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-ink text-white opacity-0 transition group-hover:opacity-100"><Pencil size={9} /></span>
          </button>}
          <div className="min-w-0"><h2 className="truncate font-extrabold">{selected.title}</h2><div className="text-xs text-muted">{selected.kind === "group" ? `${selected.participantIds.length} 位成员` : "私人对话"}</div></div>
        </div>
      </header>
      <div style={revealPlan?.panels.find((panel) => panel.targetId === selected.id && (panel.kind === "dm" || panel.kind === "group")) ? { animationDelay: `${revealPlan.panels.find((panel) => panel.targetId === selected.id && (panel.kind === "dm" || panel.kind === "group"))!.delayMs}ms` } : undefined} className="reveal-item flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto mb-6 max-w-xs text-center"><div className="text-lg font-extrabold">{selected.title}</div><p className="mt-1 text-xs text-muted">Master 以全知视角查看此会话。账户隐私仅属于故事设定。</p></div>
        <div className="space-y-2">
          {messages.map((message) => {
            const sender = data.accounts.find((account) => account.id === message.senderId);
            if (!sender) return null;
            const player = message.senderId === "account-player";
            const replied = message.replyToMessageId ? messages.find((item) => item.id === message.replyToMessageId) : undefined;
            return <div key={message.id} className={`group flex items-end gap-2 ${player ? "justify-end" : "justify-start"}`}>
              {!player && <button type="button" aria-label={`编辑${sender.displayName}的头像`} className="mb-4 shrink-0 rounded-full" onClick={() => setAvatarAccountId(sender.id)}><Avatar name={sender.displayName} seed={sender.avatarSeed} text={sender.avatarText} url={sender.avatarUrl} size="sm" /></button>}
              <button className={`max-w-[78%] text-left ${player ? "items-end" : "items-start"}`} onDoubleClick={() => selected.playerCanSend && setReplyToId(message.id)}>
                {selected.kind === "group" && !player && <div className="mb-0.5 ml-2 text-[10px] text-muted">{sender.displayName}</div>}
                {replied && <div className={`mb-1 max-w-full truncate rounded-lg border-l-2 px-2 py-1 text-[11px] ${player ? "border-white/70 bg-sky-500 text-white/90" : "border-slate-400 bg-slate-50 text-muted"}`}>回复：{replied.text}</div>}
                <div className={`plain-content rounded-2xl px-3 py-2 text-[15px] leading-5 ${player ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm bg-slate-100"}`}>{message.text}</div>
                <div className={`mt-0.5 text-[10px] text-muted ${player ? "text-right" : "text-left"}`}>{storyDate(message.createdAt)}{player ? ` · ${message.status === "read" ? "已读" : "已发送"}` : ""}</div>
              </button>
              {player && <button type="button" aria-label={`编辑${sender.displayName}的头像`} className="mb-4 shrink-0 rounded-full" onClick={() => setAvatarAccountId(sender.id)}><Avatar name={sender.displayName} seed={sender.avatarSeed} text={sender.avatarText} url={sender.avatarUrl} size="sm" /></button>}
            </div>;
          })}
          {turn.isPending && <div className="flex justify-start"><div className="flex gap-1 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:120ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:240ms]" /></div></div>}
          <div ref={bottomRef} />
        </div>
      </div>
      {selected.playerCanSend ? <div className="shrink-0 border-t border-line p-3">
        {replyToId && <div className="mb-2 flex justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-muted"><span>回复一条消息</span><button onClick={() => setReplyToId(undefined)}>取消</button></div>}
        {turn.error && <div role="alert" className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{turn.error.message}。输入内容已保留；若消息已出现在会话中，请勿重复发送，可从会话状态重试。</div>}
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 px-3 py-2 focus-within:border-accent"><textarea value={text} maxLength={12_000} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} className="max-h-32 min-h-8 flex-1 resize-none border-0 bg-transparent outline-none" placeholder="开始一条新消息" /><button aria-label="发送私信" className="x-icon-button text-accent" disabled={!text.trim() || turn.isPending} onClick={submit}><Send size={19} /></button></div>
      </div> : <div className="flex shrink-0 items-center gap-2 border-t border-line bg-slate-50 p-4 text-sm text-muted"><LockKeyhole size={16} />这是只读叙事会话，玩家账号不是参与者。</div>}
    </section>
    {avatarEditorAccount && <AvatarEditor account={avatarEditorAccount} branchId={data.session.activeBranchId} open onOpenChange={(open) => { if (!open) setAvatarAccountId(undefined); }} />}
  </div>;
}
