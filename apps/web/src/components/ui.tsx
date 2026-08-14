import type { PropsWithChildren, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, LoaderCircle, X } from "lucide-react";
import { avatarGradient, initials } from "../lib/format";

export function Avatar({ name, seed, text, url, size = "md" }: { name: string; seed: string; text?: string | undefined; url?: string | undefined; size?: "sm" | "md" | "lg" | "xl" }) {
  const cls = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-lg", xl: "h-32 w-32 text-3xl" }[size];
  const border = size === "xl" ? "border-[5px]" : "border-2";
  const safeUrl = url && /^data:image\/(?:png|jpeg|webp);base64,/i.test(url) ? url : undefined;
  return <div className={`${cls} ${border} grid shrink-0 place-items-center overflow-hidden rounded-full border-white font-black tracking-tight text-white shadow-[0_10px_30px_-15px_rgba(15,23,42,.75)] ring-1 ring-black/5`} style={{ background: avatarGradient(seed), textShadow: "0 1px 10px rgba(15,23,42,.28)" }}>
    {safeUrl ? <img src={safeUrl} alt={`${name}的头像`} className="h-full w-full object-cover" draggable={false} /> : (text?.trim() || initials(name)).toUpperCase()}
  </div>;
}

export function Verified() {
  return <span className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full bg-accent align-[-2px] text-white"><Check size={11} strokeWidth={4} /></span>;
}

export function Spinner({ label = "正在生成剧情" }: { label?: string }) {
  return <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="animate-spin" size={17} /><span>{label}</span></div>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="px-8 py-16 text-center"><div className="text-xl font-extrabold">{title}</div><p className="mt-2 text-sm text-muted">{detail}</p></div>;
}

export function Modal({ open, onOpenChange, title, children, footer }: PropsWithChildren<{ open: boolean; onOpenChange: (value: boolean) => void; title: string; footer?: ReactNode }>) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[720px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4"><Dialog.Title className="text-xl font-extrabold">{title}</Dialog.Title><Dialog.Close aria-label="关闭" className="x-icon-button"><X size={20} /></Dialog.Close></div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
