import type { PropsWithChildren } from "react";
import { Home, Mail, Radio, Settings2, Sparkles } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useSnapshot } from "../hooks/use-airp";
import { Avatar } from "./ui";
import { HistoryControls } from "./HistoryControls";

const nav = [
  { to: "/", label: "主页", icon: Home, end: true },
  { to: "/messages", label: "私信", icon: Mail },
  { to: "/live", label: "直播", icon: Radio },
  { to: "/config", label: "配置", icon: Settings2 }
];

export function AppShell({ children }: PropsWithChildren) {
  const location = useLocation();
  const configWide = location.pathname.startsWith("/config");
  const { data } = useSnapshot();
  const player = data?.accounts.find((item) => item.id === "account-player");
  return <div className={`mx-auto grid min-h-screen w-[1265px] ${configWide ? "grid-cols-[260px_1005px]" : "grid-cols-[260px_650px_355px]"}`}>
    <aside className="sticky top-0 flex h-screen flex-col border-r border-line px-3 py-3">
      <NavLink to="/" className="mb-3 grid h-12 w-12 place-items-center rounded-full hover:bg-slate-100" aria-label="Airp X 主页">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-white"><Sparkles size={21} /></div>
      </NavLink>
      <nav className="space-y-1">
        {nav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} {...(end ? { end: true } : {})} className={({ isActive }) => `flex w-fit items-center gap-5 rounded-full px-4 py-3 text-xl transition hover:bg-slate-100 ${isActive ? "font-extrabold" : "font-normal"}`}>
          <Icon size={26} strokeWidth={2.1} /><span>{label}</span>
        </NavLink>)}
      </nav>
      <NavLink to="/messages" className="mt-5 rounded-full bg-ink py-3 text-center text-lg font-extrabold text-white hover:bg-slate-800">发私信</NavLink>
      <div className="mt-auto rounded-2xl p-3 hover:bg-slate-50">
        <div className="flex items-center gap-3">
          <Avatar name={player?.displayName ?? "玩家"} seed={player?.avatarSeed ?? "player"} text={player?.avatarText} url={player?.avatarUrl} />
          <div className="min-w-0"><div className="truncate font-bold">{player?.displayName ?? "玩家"}</div><div className="truncate text-sm text-muted">@{player?.handle ?? "Master"}</div></div>
        </div>
      </div>
    </aside>
    <main className="min-h-screen border-r border-line">{children}</main>
    {!configWide && <aside className="px-6 py-3">
      <div className="sticky top-3 space-y-4">
        <HistoryControls />
        <section className="overflow-hidden rounded-2xl bg-[#f7f9f9]">
          <h2 className="px-4 pb-2 pt-3 text-xl font-extrabold">正在发生</h2>
          {data?.trends.length ? data.trends.map((trend) => <div key={trend.rank} className="px-4 py-3 hover:bg-slate-100">
            <div className="text-xs text-muted">{trend.rank} · 热门</div>
            <div className="font-bold">#{trend.label.replace(/^#/, "")}</div>
            <div className="text-xs text-muted">{trend.volumeLabel}</div>
          </div>) : <div className="px-4 pb-4 pt-1"><div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-4 text-center"><Sparkles size={17} className="mx-auto text-accent" /><div className="mt-2 text-sm font-bold">等待剧情升温</div><p className="mt-1 text-xs leading-5 text-muted">热点与趋势会随回合实时出现。</p></div></div>}
        </section>
        <div className="px-3 text-xs leading-5 text-muted">本地单用户模式 · 全知视角<br />内容由你的角色卡、世界书与模型配置驱动</div>
      </div>
    </aside>}
  </div>;
}
