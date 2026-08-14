import type { AppSnapshot, PlayerTurnInput } from "@airp/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LockKeyhole, Mail, Pencil, Plus, Search, Send, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AvatarEditor } from "../components/AvatarEditor";
import { Avatar, Empty, Spinner } from "../components/ui";
import { useSnapshot, useTurnMutation } from "../hooks/use-airp";
import { storyDate } from "../lib/format";
import { useUiStore } from "../store/ui";

type MessageCompat = AppSnapshot["messages"][number] & { turnId?: string; bubbleOrder?: number };

function cleanSegments(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function MessagesPage() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useSnapshot();
  const turn = useTurnMutation();
  const [segments, setSegments] = useState([""]);
  const [directorInstruction, setDirectorInstruction] = useState("");
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
    for (const list of grouped.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)
      || (a.turnId && a.turnId === b.turnId ? (a.bubbleOrder ?? 0) - (b.bubbleOrder ?? 0) : 0));
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
  useEffect(() => { setSegments([""]); setDirectorInstruction(""); setReplyToId(undefined); }, [selected?.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, turn.isPending]);
  if (isLoading) return <div className="p-8"><Spinner label="载入私信" /></div>;
  if (!data || !selected) return <Empty title="没有私信" detail="AI 创建的会话会出现在这里。" />;
  const selectedMembers = selected.participantIds.map((id) => data.accounts.find((account) => account.id === id)).filter(Boolean);
  const selectedIncludesPlayer = selected.participantIds.includes("account-player");
  const selectedAvatar = selectedIncludesPlayer
    ? selectedMembers.find((item) => item?.id !== "account-player") ?? selectedMembers[0]
    : selectedMembers.find((item) => item?.id !== "account-heroine" && item?.id !== "account-heroine-cover") ?? selectedMembers[0];
  const avatarEditorAccount = data.accounts.find((account) => account.id === avatarAccountId);
  const playerAccount = data.accounts.find((account) => account.id === "account-player");
  const conversationPanel = revealPlan?.panels.find((panel) => panel.targetId === selected.id && (panel.kind === "dm" || panel.kind === "group"));
  const latestAiTurnId = [...messages].reverse().find((message) => !message.isPlayerInput && message.turnId)?.turnId;
  const totalInputLength = segments.reduce((total, value) => total + value.length, 0) + directorInstruction.length;
  const hasInput = cleanSegments(segments).length > 0 || directorInstruction.trim().length > 0;
  const updateSegment = (index: number, value: string) => setSegments((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  const addSegment = () => setSegments((current) => [...current, ""]);
  const removeSegment = (index: number) => setSegments((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index));
  const submit = () => {
    const speechSegments = cleanSegments(segments);
    const director = directorInstruction.trim();
    if ((!speechSegments.length && !director) || totalInputLength > 12_000 || !selected.playerCanSend || turn.isPending) return;
    const replyId = replyToId;
    const sentSegments = JSON.stringify(speechSegments);
    turn.mutate(
      {
        kind: selected.kind,
        branchId: data.session.activeBranchId,
        threadId: selected.id,
        ...(replyId ? { replyToMessageId: replyId } : {}),
        speechSegments,
        ...(director ? { directorInstruction: director } : {})
      } as unknown as PlayerTurnInput,
      { onSuccess: () => {
        setSegments((current) => JSON.stringify(cleanSegments(current)) === sentSegments ? [""] : current);
        setDirectorInstruction((current) => current.trim() === director ? "" : current);
        setReplyToId((current) => current === replyId ? undefined : current);
      } }
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
    <section className="flex min-h-0 min-w-0 flex-col">
      <header className="flex h-[53px] shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {selectedAvatar && <button type="button" aria-label={`编辑${selectedAvatar.displayName}的头像`} title="编辑此账号头像" className="group relative rounded-full" onClick={() => setAvatarAccountId(selectedAvatar.id)}>
            <Avatar name={selectedAvatar.displayName} seed={selectedAvatar.avatarSeed} text={selectedAvatar.avatarText} url={selectedAvatar.avatarUrl} size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-ink text-white opacity-0 transition group-hover:opacity-100"><Pencil size={9} /></span>
          </button>}
          <div className="min-w-0"><h2 className="truncate font-extrabold">{selected.title}</h2><div className="text-xs text-muted">{selected.kind === "group" ? `${selected.participantIds.length} 位成员` : "私人对话"}</div></div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto mb-6 max-w-xs text-center"><div className="text-lg font-extrabold">{selected.title}</div><p className="mt-1 text-xs text-muted">Master 以全知视角查看此会话。账户隐私仅属于故事设定。</p></div>
        <div className="space-y-2">
          {messages.map((message, index) => {
            const sender = data.accounts.find((account) => account.id === message.senderId);
            if (!sender) return null;
            const player = message.senderId === "account-player";
            const replied = message.replyToMessageId ? messages.find((item) => item.id === message.replyToMessageId) : undefined;
            const compatible = message as MessageCompat;
            const next = messages[index + 1] as MessageCompat | undefined;
            const joinsNext = Boolean(compatible.turnId && next?.turnId === compatible.turnId && next.senderId === message.senderId);
            const animateBubble = !player && Boolean(compatible.turnId && compatible.turnId === latestAiTurnId);
            const delayMs = (conversationPanel?.delayMs ?? 0) + Math.max(0, compatible.bubbleOrder ?? 0) * 320;
            return <div key={message.id} style={animateBubble ? { animationDelay: `${delayMs}ms` } : undefined} className={`${animateBubble ? "dm-bubble-reveal" : ""} group flex items-end gap-2 ${player ? "justify-end" : "justify-start"}`}>
              {!player && (joinsNext ? <span className="w-8 shrink-0" /> : <button type="button" aria-label={`编辑${sender.displayName}的头像`} className="mb-4 shrink-0 rounded-full" onClick={() => setAvatarAccountId(sender.id)}><Avatar name={sender.displayName} seed={sender.avatarSeed} text={sender.avatarText} url={sender.avatarUrl} size="sm" /></button>)}
              <button className={`max-w-[78%] text-left ${player ? "items-end" : "items-start"}`} onDoubleClick={() => selected.playerCanSend && setReplyToId(message.id)}>
                {selected.kind === "group" && !player && <div className="mb-0.5 ml-2 text-[10px] text-muted">{sender.displayName}</div>}
                {replied && <div className={`mb-1 max-w-full truncate rounded-lg border-l-2 px-2 py-1 text-[11px] ${player ? "border-white/70 bg-sky-500 text-white/90" : "border-slate-400 bg-slate-50 text-muted"}`}>回复：{replied.text}</div>}
                <div className={`plain-content rounded-2xl px-3 py-2 text-[15px] leading-5 ${player ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm bg-slate-100"}`}>{message.text}</div>
                {!joinsNext && <div className={`mt-0.5 text-[10px] text-muted ${player ? "text-right" : "text-left"}`}>{storyDate(message.createdAt)}{player ? ` · ${message.status === "read" ? "已读" : "已发送"}` : ""}</div>}
              </button>
              {player && (joinsNext ? <span className="w-8 shrink-0" /> : <button type="button" aria-label={`编辑${sender.displayName}的头像`} className="mb-4 shrink-0 rounded-full" onClick={() => setAvatarAccountId(sender.id)}><Avatar name={sender.displayName} seed={sender.avatarSeed} text={sender.avatarText} url={sender.avatarUrl} size="sm" /></button>)}
            </div>;
          })}
          {turn.isPending && <div className="flex justify-start"><div className="flex gap-1 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:120ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:240ms]" /></div></div>}
          <div ref={bottomRef} />
        </div>
      </div>
      {selected.playerCanSend ? <div className="shrink-0 border-t border-line bg-white p-3">
        {replyToId && <div className="mb-2 flex justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-muted"><span>回复一条消息</span><button onClick={() => setReplyToId(undefined)}>取消</button></div>}
        {turn.error && <div role="alert" className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{turn.error.message}。输入内容已保留；若消息已出现在会话中，请勿重复发送，可从会话状态重试。</div>}
        <div className="rounded-2xl border border-slate-300 p-2.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20">
          <div className="mb-2 flex items-center justify-between px-1"><div><span className="text-xs font-extrabold">{playerAccount?.displayName ?? "諾奇"}的消息</span><span className="ml-1.5 text-[10px] text-muted">每段将作为独立气泡发送</span></div><span className={`text-[10px] ${totalInputLength > 12_000 ? "font-bold text-rose-600" : "text-muted"}`}>{totalInputLength}/12000</span></div>
          <div className="max-h-40 space-y-2 overflow-y-auto pr-1">{segments.map((value, index) => <div key={index} className="group/input flex items-end gap-1.5 rounded-xl bg-sky-50/60 px-2 py-1.5">
            <span className="mb-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-white">{index + 1}</span>
            <textarea
              aria-label={`第 ${index + 1} 个私信气泡`}
              value={value}
              onChange={(event) => updateSegment(index, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              className="max-h-24 min-h-8 flex-1 resize-none border-0 bg-transparent text-sm leading-5 outline-none"
              placeholder={index === 0 ? "输入第一条消息；Shift + Enter 换行" : "继续说……"}
            />
            {segments.length > 1 && <button type="button" aria-label={`删除第 ${index + 1} 个气泡`} className="x-icon-button h-7 w-7 opacity-55 hover:text-rose-600 group-hover/input:opacity-100" onClick={() => removeSegment(index)}><Trash2 size={14} /></button>}
          </div>)}</div>
          <div className="mt-2 flex items-center justify-between">
            <button type="button" className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold text-accent transition hover:bg-sky-50" onClick={addSegment}><Plus size={14} />新气泡</button>
            <button aria-label={directorInstruction.trim() && !cleanSegments(segments).length ? "执行Master指令" : "发送私信"} className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40" disabled={!hasInput || totalInputLength > 12_000 || turn.isPending} onClick={submit}>{turn.isPending ? "生成中" : directorInstruction.trim() && !cleanSegments(segments).length ? "推进剧情" : "发送"}<Send size={16} /></button>
          </div>
        </div>
        <details className="director-box group mt-2 rounded-xl border border-dashed border-violet-200 bg-violet-50/40">
          <summary className="flex list-none cursor-pointer items-center justify-between px-3 py-2 text-xs font-bold text-violet-800"><span>Master导演指令 <span className="font-normal text-violet-600/70">（可留空，不显示为私信）</span></span><ChevronDown size={15} className="transition group-open:rotate-180" /></summary>
          <div className="border-t border-violet-100 px-3 py-2"><textarea value={directorInstruction} onChange={(event) => setDirectorInstruction(event.target.value)} maxLength={12_000} className="max-h-28 min-h-16 w-full resize-y bg-transparent text-sm leading-5 outline-none" placeholder="可填写剧情推进、镜头或时间安排；諾奇不会把它当作聊天内容。" /></div>
        </details>
      </div> : <div className="flex shrink-0 items-center gap-2 border-t border-line bg-slate-50 p-4 text-sm text-muted"><LockKeyhole size={16} />这是只读叙事会话，玩家账号不是参与者。</div>}
    </section>
    {avatarEditorAccount && <AvatarEditor account={avatarEditorAccount} branchId={data.session.activeBranchId} open onOpenChange={(open) => { if (!open) setAvatarAccountId(undefined); }} />}
  </div>;
}
