import type { PropsWithChildren } from "react";
import { Home, Mail, Radio, Settings2, Sparkles } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useSnapshot } from "../hooks/use-airp";
import { Avatar } from "./ui";
import { RightRail } from "./RightRail";

const nav = [
  { to: "/", label: "主页", icon: Home, end: true },
  { to: "/messages", label: "私信", icon: Mail },
  { to: "/live", label: "直播", icon: Radio },
  { to: "/config", label: "配置", icon: Settings2 }
];

export function AppShell({ children }: PropsWithChildren) {
  const location = useLocation();
  const configWide = location.pathname.startsWith("/config");
  const fullRail = location.pathname === "/" || location.pathname.startsWith("/messages");
  const trendsOnlyRail = location.pathname.startsWith("/post/") || location.pathname.startsWith("/live");
  const showRail = !configWide && (fullRail || trendsOnlyRail);
  const { data } = useSnapshot();
  const player = data?.accounts.find((item) => item.id === "account-player");
  return <div className={`app-shell mx-auto grid min-h-screen ${configWide || !showRail ? "app-shell-wide" : "app-shell-rail"}`}>
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
    <main className="min-h-screen min-w-0 border-r border-line">{children}</main>
    {showRail && <aside className="app-right-rail sticky top-0 h-screen min-w-0 overflow-y-auto py-3">
      {data && <RightRail snapshot={data} mode={fullRail ? "full" : "trends"} />}
    </aside>}
  </div>;
}
