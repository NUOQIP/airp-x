import type { Account, AppSnapshot } from "@airp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../lib/api";
import { ImageCropper } from "./ImageCropper";
import { Avatar, Modal } from "./ui";

const avatarSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const avatarGraphemes = (value: string) => [...avatarSegmenter.segment(value.trim())].map((item) => item.segment);
const limitAvatarText = (value: string) => avatarGraphemes(value).slice(0, 2).join("");
const isAvatarTextValid = (value: string) => avatarGraphemes(value).length <= 2;
const acceptedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxSourceBytes = 15 * 1024 * 1024;

export function AvatarEditor({ account, branchId, open, onOpenChange }: { account: Account; branchId: string; open: boolean; onOpenChange: (value: boolean) => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarText, setAvatarText] = useState(account.avatarText ?? "");
  const [avatarUrl, setAvatarUrl] = useState(account.avatarUrl ?? "");
  const [fileError, setFileError] = useState("");
  const [cropSource, setCropSource] = useState("");
  useEffect(() => {
    if (!open) return;
    setAvatarText(account.avatarText ?? "");
    setAvatarUrl(account.avatarUrl ?? "");
    setFileError("");
    setCropSource("");
  }, [account.id, account.avatarText, account.avatarUrl, open]);
  useEffect(() => () => { if (cropSource) URL.revokeObjectURL(cropSource); }, [cropSource]);
  const mutation = useMutation({
    mutationFn: () => apiClient.updateAvatar(branchId, account.id, avatarText.trim(), avatarUrl),
    onSuccess: (snapshot: AppSnapshot) => {
      queryClient.setQueryData(["snapshot"], snapshot);
      onOpenChange(false);
    }
  });
  const selectFile = (file?: File) => {
    if (!file) return;
    setFileError("");
    try {
      if (!acceptedImageTypes.has(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
      if (file.size > maxSourceBytes) throw new Error("原图不能超过 15 MB。");
      setCropSource(URL.createObjectURL(file));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "头像图片处理失败。");
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  return <Modal
    open={open}
    onOpenChange={onOpenChange}
    title={`编辑 ${account.displayName} 的头像`}
    footer={cropSource ? undefined : <>
      <button type="button" className="x-secondary" onClick={() => { setAvatarText(""); setAvatarUrl(""); setFileError(""); }}>恢复自动头像</button>
      <button type="button" className="x-primary" disabled={mutation.isPending || !isAvatarTextValid(avatarText)} onClick={() => mutation.mutate()}>
        {mutation.isPending ? "保存中…" : "保存头像"}
      </button>
    </>}
  >
    {cropSource ? <ImageCropper sourceUrl={cropSource} outputWidth={512} outputHeight={512} viewportWidth={420} label="裁剪头像" onCancel={() => setCropSource("")} onConfirm={(dataUrl) => { setAvatarUrl(dataUrl); setCropSource(""); }} /> : <>
    <div className="flex items-center gap-5 rounded-2xl bg-slate-50 p-5">
      <Avatar name={account.displayName} seed={account.avatarSeed} text={avatarText || undefined} url={avatarUrl || undefined} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-extrabold">本地图片</div>
        <p className="mt-1 text-xs leading-5 text-muted">图片只保存在本机当前会话中；上传后会自动居中裁剪并压缩为正方形。</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="x-primary flex items-center gap-2" onClick={() => fileRef.current?.click()}><Upload size={16} />选择本地图片</button>
          {avatarUrl && <button type="button" className="x-secondary flex items-center gap-2" onClick={() => setAvatarUrl("")}><ImageOff size={16} />移除图片</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} />
      </div>
    </div>
    <div className="mt-4 rounded-2xl border border-line p-4">
      <label htmlFor={`avatar-text-${account.id}`} className="text-sm font-extrabold">字母头像备用文字</label>
      <input
        id={`avatar-text-${account.id}`}
        className="x-input mt-2 w-full text-lg font-bold"
        maxLength={64}
        value={avatarText}
        placeholder="留空自动提取昵称"
        onChange={(event) => setAvatarText(limitAvatarText(event.target.value))}
      />
      <p className="mt-2 text-xs leading-5 text-muted">图片优先显示；移除图片后使用这里的 1–2 个字符或 emoji，留空则自动取昵称。</p>
    </div>
    {(fileError || mutation.error) && <p className="mt-3 text-sm text-rose-600">{fileError || (mutation.error instanceof Error ? mutation.error.message : "头像保存失败，请重试。")}</p>}
    </>}
  </Modal>;
}
