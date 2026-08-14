import { Check, Crop, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

export function ImageCropper({ sourceUrl, outputWidth, outputHeight, viewportWidth, label, onCancel, onConfirm }: {
  sourceUrl: string;
  outputWidth: number;
  outputHeight: number;
  viewportWidth: number;
  label: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const viewportHeight = Math.round(viewportWidth * outputHeight / outputWidth);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | undefined>(undefined);
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; offset: Point } | undefined>(undefined);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [error, setError] = useState("");

  const clampOffset = (value: Point, scaleZoom = zoom) => {
    if (!imageSize.width || !imageSize.height) return { x: 0, y: 0 };
    const baseScale = Math.max(viewportWidth / imageSize.width, viewportHeight / imageSize.height);
    const scaledWidth = imageSize.width * baseScale * scaleZoom;
    const scaledHeight = imageSize.height * baseScale * scaleZoom;
    const maxX = Math.max(0, (scaledWidth - viewportWidth) / 2);
    const maxY = Math.max(0, (scaledHeight - viewportHeight) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, value.x)), y: Math.max(-maxY, Math.min(maxY, value.y)) };
  };

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError("");
    };
    image.onerror = () => setError("无法读取这张图片，请重新选择。");
    image.src = sourceUrl;
    return () => { if (imageRef.current === image) imageRef.current = undefined; };
  }, [sourceUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageSize.width) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const baseScale = Math.max(viewportWidth / imageSize.width, viewportHeight / imageSize.height);
    const scale = baseScale * zoom;
    const width = imageSize.width * scale;
    const height = imageSize.height * scale;
    context.clearRect(0, 0, viewportWidth, viewportHeight);
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, viewportWidth, viewportHeight);
    context.drawImage(image, (viewportWidth - width) / 2 + offset.x, (viewportHeight - height) / 2 + offset.y, width, height);
  }, [imageSize, offset, viewportHeight, viewportWidth, zoom]);

  const changeZoom = (value: number) => {
    const nextZoom = Math.max(1, Math.min(3, value));
    setZoom(nextZoom);
    setOffset((current) => clampOffset(current, nextZoom));
  };

  const confirm = () => {
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return setError("浏览器无法生成裁剪图片。");
    const outputScale = outputWidth / viewportWidth;
    const baseScale = Math.max(viewportWidth / imageSize.width, viewportHeight / imageSize.height);
    const scale = baseScale * zoom * outputScale;
    const width = imageSize.width * scale;
    const height = imageSize.height * scale;
    context.drawImage(image, (outputWidth - width) / 2 + offset.x * outputScale, (outputHeight - height) / 2 + offset.y * outputScale, width, height);
    const qualities = [0.86, 0.74, 0.62];
    const encoded = qualities.map((quality) => canvas.toDataURL("image/webp", quality)).find((value) => value.length <= 750_000);
    if (!encoded) return setError("裁剪后的图片仍然过大，请缩小原图后重试。");
    onConfirm(encoded);
  };

  return <div>
    <div className="mb-3 flex items-center gap-2 text-sm font-extrabold"><Crop size={17} />{label}</div>
    <div className="mx-auto select-none overflow-hidden rounded-2xl bg-slate-950 shadow-inner" style={{ width: viewportWidth, maxWidth: "100%", aspectRatio: `${outputWidth} / ${outputHeight}` }}>
      <div className="relative h-full w-full touch-none cursor-grab active:cursor-grabbing">
        <canvas
          ref={canvasRef}
          width={viewportWidth}
          height={viewportHeight}
          className="h-full w-full"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, offset };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const next = {
              x: drag.offset.x + (event.clientX - drag.clientX) * viewportWidth / rect.width,
              y: drag.offset.y + (event.clientY - drag.clientY) * viewportHeight / rect.height
            };
            setOffset(clampOffset(next));
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { dragRef.current = undefined; }}
        />
        <div className="pointer-events-none absolute inset-0 border-2 border-white/90 shadow-[inset_0_0_0_999px_rgba(15,23,42,.08)]" />
        <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-dashed border-white/55" />
        <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-dashed border-white/55" />
        <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-dashed border-white/55" />
        <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-dashed border-white/55" />
      </div>
    </div>
    <div className="mx-auto mt-4 flex max-w-xl items-center gap-3">
      <ZoomOut size={17} className="shrink-0 text-muted" />
      <input type="range" aria-label="裁剪缩放" min={1} max={3} step={0.01} value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} className="min-w-0 flex-1 accent-accent" />
      <ZoomIn size={17} className="shrink-0 text-muted" />
      <button type="button" title="重置位置和缩放" className="x-icon-button shrink-0" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={17} /></button>
    </div>
    <p className="mt-2 text-center text-xs text-muted">拖动图片调整位置，使用滑杆缩放；框内内容就是最终效果。</p>
    {error && <p className="mt-3 text-center text-sm text-rose-600">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="x-secondary" onClick={onCancel}>取消裁剪</button>
      <button type="button" className="x-primary flex items-center gap-2" disabled={!imageSize.width} onClick={confirm}><Check size={16} />使用此裁剪</button>
    </div>
  </div>;
}
