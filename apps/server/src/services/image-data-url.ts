const allowedMime = new Set(["image/png", "image/jpeg", "image/webp"]);

function jpegDimensions(bytes: Buffer) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof && length >= 7 && offset + length <= bytes.length) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    if (length < 2) break;
    offset += length;
  }
  return undefined;
}

function webpDimensions(bytes: Buffer) {
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X" && bytes.length >= 30) {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21]!; const b2 = bytes[22]!; const b3 = bytes[23]!; const b4 = bytes[24]!;
    return { width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10) };
  }
  if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return undefined;
}

export function inspectImageDataUrl(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match?.[1] || !match[2]) throw new Error("图片必须是本地 PNG、JPEG 或 WebP Data URL");
  const mime = match[1].toLowerCase();
  if (!allowedMime.has(mime)) throw new Error("不支持的图片类型");
  const bytes = Buffer.from(match[2], "base64");
  let actualMime: string | undefined;
  let dimensions: { width: number; height: number } | undefined;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    actualMime = "image/png";
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    actualMime = "image/jpeg";
    dimensions = jpegDimensions(bytes);
  } else if (bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    actualMime = "image/webp";
    dimensions = webpDimensions(bytes);
  }
  if (actualMime !== mime) throw new Error("图片声明的类型与实际文件不一致");
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new Error("无法读取图片尺寸");
  if (dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 25_000_000) throw new Error("图片像素尺寸过大");
  return { mime, bytes: bytes.length, ...dimensions };
}
