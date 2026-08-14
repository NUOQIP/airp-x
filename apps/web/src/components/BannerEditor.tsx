import type { AppSnapshot } from "@airp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../lib/api";
import { ImageCropper } from "./ImageCropper";
import { Modal } from "./ui";

type BannerTone = AppSnapshot["profile"]["bannerTone"];

const bannerClasses: Record<BannerTone, string> = {
  sky: "from-sky-400 via-cyan-200 to-blue-100",
  rose: "from-rose-400 via-fuchsia-200 to-orange-100",
  violet: "from-violet-500 via-indigo-300 to-sky-200",
  amber: "from-amber-400 via-orange-200 to-rose-200",
  night: "from-slate-950 via-indigo-950 to-violet-800"
};

const toneOptions: Array<{ value: BannerTone; label: string }> = [
  { value: "sky", label: "天空" },
  { value: "rose", label: "玫瑰" },
  { value: "violet", label: "霓虹" },
  { value: "amber", label: "暖阳" },
  { value: "night", label: "夜色" }
];

export function BannerEditor({ branchId, currentTone, currentUrl, open, onOpenChange }: { branchId: string; currentTone: BannerTone; currentUrl?: string | undefined; open: boolean; onOpenChange: (value: boolean) => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bannerTone, setBannerTone] = useState<"" | BannerTone>(currentTone);
  const [bannerUrl, setBannerUrl] = useState(currentUrl ?? "");
  const [fileError, setFileError] = useState("");
  const [cropSource, setCropSource] = useState("");
  useEffect(() => {
    if (!open) return;
    setBannerTone(currentTone);
    setBannerUrl(currentUrl ?? "");
    setFileError("");
    setCropSource("");
  }, [currentTone, currentUrl, open]);
  useEffect(() => () => { if (cropSource) URL.revokeObjectURL(cropSource); }, [cropSource]);
  const mutation = useMutation({
    mutationFn: () => apiClient.updateProfileBanner(branchId, bannerTone, bannerUrl),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["snapshot"], snapshot);
      onOpenChange(false);
    }
  });
  const selectFile = (file?: File) => {
    if (!file) return;
    setFileError("");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
      if (file.size > 20 * 1024 * 1024) throw new Error("原图不能超过 20 MB。");
      setCropSource(URL.createObjectURL(file));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "封面图片处理失败。");
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const previewTone = bannerTone || currentTone;
  const safePreviewUrl = /^data:image\/(?:png|jpeg|webp);base64,/i.test(bannerUrl) ? bannerUrl : undefined;
  return <Modal
    open={open}
    onOpenChange={onOpenChange}
    title="编辑主页封面"
    footer={cropSource ? undefined : <>
      <button type="button" className="x-secondary" onClick={() => { setBannerTone(""); setBannerUrl(""); setFileError(""); }}>恢复剧情背景</button>
      <button type="button" className="x-primary" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "保存中…" : "保存封面"}</button>
    </>}
  >
    {cropSource ? <ImageCropper sourceUrl={cropSource} outputWidth={1_200} outputHeight={370} viewportWidth={600} label="裁剪主页封面" onCancel={() => setCropSource("")} onConfirm={(dataUrl) => { setBannerUrl(dataUrl); setCropSource(""); }} /> : <>
    <div className={`relative aspect-[3.24/1] overflow-hidden rounded-2xl bg-gradient-to-br ${bannerClasses[previewTone]}`} style={safePreviewUrl ? { backgroundImage: `url(${safePreviewUrl})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}>
      {!safePreviewUrl && <><div className="absolute -right-10 -top-20 h-56 w-56 rounded-full bg-white/20" /><div className="absolute bottom-4 left-32 h-16 w-64 -rotate-6 rounded-full bg-white/15" /></>}
    </div>
    <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
      <div><div className="text-sm font-extrabold">上传横幅图片</div><p className="mt-1 text-xs text-muted">自动按主页横幅比例居中裁剪并压缩，仅保存在本机。</p></div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="x-primary flex items-center gap-2" onClick={() => fileRef.current?.click()}><Upload size={16} />选择图片</button>
        {bannerUrl && <button type="button" className="x-secondary flex items-center gap-2" onClick={() => setBannerUrl("")}><ImageOff size={16} />移除</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} />
    </div>
    <div className="mt-4">
      <div className="text-sm font-extrabold">渐变主题</div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {toneOptions.map((option) => <button key={option.value} type="button" onClick={() => { setBannerTone(option.value); setBannerUrl(""); }} className={`overflow-hidden rounded-xl border-2 text-left ${bannerTone === option.value && !bannerUrl ? "border-ink" : "border-transparent"}`}>
          <span className={`block h-14 bg-gradient-to-br ${bannerClasses[option.value]}`} />
          <span className="block bg-slate-50 px-2 py-1.5 text-xs font-bold">{option.label}</span>
        </button>)}
      </div>
    </div>
    {(fileError || mutation.error) && <p className="mt-3 text-sm text-rose-600">{fileError || (mutation.error instanceof Error ? mutation.error.message : "封面保存失败，请重试。")}</p>}
    </>}
  </Modal>;
}
