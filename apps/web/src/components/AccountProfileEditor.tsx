import type { Account, AppSnapshot } from "@airp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";
import { Modal, Verified } from "./ui";

export function AccountProfileEditor({ account, branchId, open, onOpenChange }: { account: Account; branchId: string; open: boolean; onOpenChange: (value: boolean) => void }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [verified, setVerified] = useState(account.verified);
  useEffect(() => {
    if (!open) return;
    setDisplayName(account.displayName);
    setVerified(account.verified);
  }, [account.displayName, account.id, account.verified, open]);
  const mutation = useMutation({
    mutationFn: () => apiClient.updateAccountProfile(branchId, account.id, displayName.trim(), verified),
    onSuccess: (snapshot: AppSnapshot) => {
      queryClient.setQueryData(["snapshot"], snapshot);
      onOpenChange(false);
    }
  });
  const valid = displayName.trim().length > 0 && displayName.trim().length <= 80;
  return <Modal
    open={open}
    onOpenChange={onOpenChange}
    title="编辑账号资料"
    footer={<button type="button" className="x-primary" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "保存中…" : "保存资料"}</button>}
  >
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-muted">受保护的固定身份</div>
      <div className="mt-2 text-sm"><span className="font-bold">@{account.handle}</span><span className="ml-2 text-muted">账号ID与私密状态不可在这里修改</span></div>
    </div>
    <label className="mt-4 block text-sm font-extrabold">显示名
      <input className="x-input mt-2" maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
    </label>
    <label className="mt-4 flex cursor-pointer items-center justify-between rounded-2xl border border-line px-4 py-3">
      <span><span className="flex items-center text-sm font-extrabold">认证标志 <Verified /></span><span className="mt-1 block text-xs leading-5 text-muted">只改变账号名称旁的认证徽章，不影响隐私、权限或剧情可见范围。</span></span>
      <input type="checkbox" className="h-5 w-5 accent-sky-500" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
    </label>
    {mutation.error && <p role="alert" className="mt-3 text-sm text-rose-600">{mutation.error instanceof Error ? mutation.error.message : "账号资料保存失败，请重试。"}</p>}
  </Modal>;
}
