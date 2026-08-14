import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch, RefreshCw, RotateCcw } from "lucide-react";
import { apiClient } from "../lib/api";
import { useSnapshot } from "../hooks/use-airp";
import { Spinner } from "./ui";

export function HistoryControls() {
  const { data } = useSnapshot();
  const client = useQueryClient();
  const latest = data?.turns.at(-1);
  const run = useMutation({
    mutationFn: async ({ action, id }: { action: "retry" | "regenerate" | "candidate" | "branch"; id: string }) => {
      if (action === "retry") return (await apiClient.retryTurn(id)).snapshot;
      if (action === "regenerate") return (await apiClient.regenerateTurn(id)).snapshot;
      if (action === "candidate") return apiClient.selectCandidate(id);
      return apiClient.activateBranch(id);
    },
    onSuccess: (snapshot) => client.setQueryData(["snapshot"], snapshot)
  });
  return <section className="rounded-2xl border border-line bg-white p-4">
    <div className="flex items-center justify-between"><h2 className="font-extrabold">会话状态</h2><GitBranch size={18} /></div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {data?.branches.map((branch) => <button key={branch.id} disabled={run.isPending} onClick={() => run.mutate({ action: "branch", id: branch.id })} className={`rounded-full px-2.5 py-1 text-xs ${branch.active ? "bg-ink font-bold text-white" : "bg-slate-100 text-muted hover:bg-slate-200"}`}>{branch.name}</button>)}
    </div>
    {latest && <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center justify-between text-xs text-muted"><span>回合 {latest.sequence}</span><span>{latest.status === "complete" ? "已提交" : latest.status === "failed" ? "生成失败" : "生成中"}</span></div>
      {latest.status === "pending" && <div className="mt-2"><Spinner /></div>}
      {latest.status === "failed" && <button className="mt-2 flex items-center gap-1.5 text-sm font-bold text-rose-600" onClick={() => run.mutate({ action: "retry", id: latest.id })}><RotateCcw size={15} />重试本回合</button>}
      {latest.status === "complete" && <div className="mt-2 flex items-center gap-2">
        <div className="flex gap-1">{latest.candidates.map((candidate, index) => <button aria-label={`候选 ${index + 1}`} key={candidate.id} onClick={() => run.mutate({ action: "candidate", id: candidate.id })} className={`h-2.5 w-2.5 rounded-full ${candidate.active ? "bg-accent" : "bg-slate-300"}`} />)}</div>
        <button title="重新生成一个候选" disabled={run.isPending} onClick={() => run.mutate({ action: "regenerate", id: latest.id })} className="ml-auto x-icon-button h-7 w-7"><RefreshCw size={15} /></button>
      </div>}
      {latest.error && <p className="mt-2 line-clamp-3 text-xs text-rose-600" title={latest.error}>{latest.error}</p>}
    </div>}
  </section>;
}

