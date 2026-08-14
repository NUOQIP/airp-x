import { useEffect, useMemo, useState } from "react";
import { Eye, Gift, Pause, Play, Radio, Volume2 } from "lucide-react";
import type { LiveQueueItem } from "@airp/shared";
import { Avatar, Empty, Spinner } from "../components/ui";
import { useSnapshot } from "../hooks/use-airp";
import { compactNumber } from "../lib/format";

const MIN_FIRST_ITEM_DELAY_MS = 1_200;
const MIN_QUEUE_ITEM_GAP_MS = 2_200;
const playbackSpeeds = [0.25, 0.5, 1, 1.5] as const;

function formatPlaybackTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function LivePage() {
  const { data, isLoading } = useSnapshot();
  const live = data?.lives.find((item) => item.status === "live") ?? data?.lives[0];
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState<(typeof playbackSpeeds)[number]>(0.5);
  const [scrubbing, setScrubbing] = useState(false);
  const playbackQueue = useMemo(() => {
    if (!live) return [];
    let previousOffset = 0;
    return [...live.queue]
      .sort((left, right) => left.offsetMs - right.offsetMs)
      .map((item, index) => {
        const minimumOffset = index === 0 ? MIN_FIRST_ITEM_DELAY_MS : previousOffset + MIN_QUEUE_ITEM_GAP_MS;
        const playbackOffsetMs = Math.max(item.offsetMs, minimumOffset);
        previousOffset = playbackOffsetMs;
        return { item, playbackOffsetMs };
      });
  }, [live]);
  const durationMs = playbackQueue.at(-1)?.playbackOffsetMs ?? 0;
  const revealed = useMemo<LiveQueueItem[]>(() => playbackQueue.filter((entry) => entry.playbackOffsetMs <= elapsed).map((entry) => entry.item), [elapsed, playbackQueue]);
  useEffect(() => { setElapsed(0); setPaused(false); setScrubbing(false); }, [live?.id, data?.mvu.revision]);
  useEffect(() => {
    if (!live || paused || scrubbing || durationMs === 0) return;
    const interval = window.setInterval(() => setElapsed((value) => Math.min(durationMs, value + 100 * speed)), 100);
    return () => window.clearInterval(interval);
  }, [durationMs, live, paused, scrubbing, speed]);
  const viewer = useMemo(() => [...revealed].reverse().find((item) => item.kind === "viewer_count"), [revealed]);
  const hostLines = revealed.filter((item) => item.kind === "host" || item.kind === "system");
  const chat = revealed.filter((item) => item.kind === "barrage" || item.kind === "gift" || item.kind === "superchat");
  if (isLoading) return <div className="p-8"><Spinner label="接入直播" /></div>;
  if (!data || !live) return <Empty title="当前没有直播" detail="AI 创建直播事件后，这里会自动出现预生成的实时队列。" />;
  const host = data.accounts.find((account) => account.id === live.hostId)!;
  const exhausted = revealed.length === live.queue.length;
  return <div>
    <header className="sticky top-0 z-20 flex h-[53px] items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur-md"><h1 className="panel-title">直播</h1><span className="flex items-center gap-1.5 rounded-full bg-rose-500 px-3 py-1 text-xs font-extrabold text-white"><Radio size={13} />LIVE</span></header>
    <section className="relative aspect-video overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-800 text-white">
      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_30%,#ec4899_0,transparent_36%),radial-gradient(circle_at_80%_70%,#38bdf8_0,transparent_35%)]" />
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 backdrop-blur"><Avatar name={host.displayName} seed={host.avatarSeed} text={host.avatarText} url={host.avatarUrl} size="sm" /><span className="text-sm font-bold">{host.displayName}</span></div>
      <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs backdrop-blur"><Eye size={14} />{compactNumber(viewer?.kind === "viewer_count" ? viewer.viewers : live.viewerCount)}</div>
      <div className="absolute inset-x-12 top-1/2 -translate-y-1/2 text-center">
        <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs uppercase tracking-widest backdrop-blur">文字画面</div>
        <p className="plain-content text-xl font-bold leading-8 drop-shadow">{hostLines.at(-1)?.text ?? live.sceneDescription}</p>
      </div>
      <div className="absolute bottom-3 left-4 right-4 rounded-2xl bg-black/35 px-3 py-2 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <button type="button" aria-label={paused ? "继续播放" : "暂停播放"} onClick={() => setPaused(!paused)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 hover:bg-white/25">{paused ? <Play size={17} /> : <Pause size={17} />}</button>
          <Volume2 size={16} className="shrink-0 text-white/75" />
          <input
            type="range"
            aria-label="直播播放进度"
            min={0}
            max={Math.max(1, durationMs)}
            step={100}
            value={Math.min(elapsed, Math.max(1, durationMs))}
            disabled={durationMs === 0}
            onPointerDown={() => setScrubbing(true)}
            onPointerUp={() => setScrubbing(false)}
            onPointerCancel={() => setScrubbing(false)}
            onChange={(event) => setElapsed(Number(event.target.value))}
            className="h-5 min-w-0 flex-1 cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="w-[72px] shrink-0 text-right font-mono text-[11px] text-white/80">{formatPlaybackTime(elapsed)} / {formatPlaybackTime(durationMs)}</span>
          <select
            aria-label="直播播放速度"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value) as (typeof playbackSpeeds)[number])}
            className="h-8 rounded-full border border-white/20 bg-white/10 px-2 text-xs font-bold text-white outline-none hover:bg-white/20 focus:border-white/50"
          >
            {playbackSpeeds.map((value) => <option key={value} value={value} className="bg-slate-900 text-white">{value}×</option>)}
          </select>
        </div>
        <div className="mt-0.5 text-right text-[10px] font-semibold text-white/60">{exhausted ? "队列已播完，可拖动回看" : scrubbing ? "正在定位" : paused ? "已暂停" : "播放中"}</div>
      </div>
    </section>
    <section className="border-b border-line p-4"><h2 className="text-xl font-extrabold">{live.title}</h2><div className="mt-2 flex items-center gap-3"><Avatar name={host.displayName} seed={host.avatarSeed} text={host.avatarText} url={host.avatarUrl} /><div><div className="font-bold">{host.displayName}</div><div className="text-sm text-muted">@{host.handle}</div></div></div><p className="plain-content mt-3 text-sm leading-6 text-muted">{live.sceneDescription}</p></section>
    <section>
      <div className="flex h-12 items-center justify-between border-b border-line px-4"><h3 className="font-extrabold">实时互动</h3><span className="text-xs text-muted">预生成队列 · {revealed.length}/{live.queue.length}</span></div>
      <div className="min-h-64 divide-y divide-line">
        {chat.map((item) => {
          const account = "accountId" in item ? data.accounts.find((candidate) => candidate.id === item.accountId) : undefined;
          return <div key={item.id} className={`reveal-item flex gap-3 px-4 py-3 ${item.kind === "superchat" ? "bg-amber-50" : item.kind === "gift" ? "bg-rose-50" : ""}`}>
            {account && <Avatar name={account.displayName} seed={account.avatarSeed} text={account.avatarText} url={account.avatarUrl} size="sm" />}
            <div className="text-sm"><span className="mr-2 font-bold">{account?.displayName ?? "系统"}</span>{item.kind === "barrage" ? item.text : item.kind === "superchat" ? <><span>{item.text}</span><strong className="ml-2 text-amber-700">{item.currency} {item.amount}</strong></> : item.kind === "gift" ? <span className="inline-flex items-center gap-1 text-rose-600"><Gift size={14} />赠送 {item.giftName} · {item.currency} {item.amount}</span> : null}</div>
          </div>;
        })}
        {chat.length === 0 && <div className="p-8 text-center text-sm text-muted">互动消息正在进入队列…</div>}
      </div>
    </section>
  </div>;
}
