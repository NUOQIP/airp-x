import { describe, expect, it } from "vitest";
import { inspectImageDataUrl } from "../apps/server/src/services/image-data-url.js";

describe("image Data URL validation", () => {
  const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("checks the real image signature and dimensions", () => {
    expect(inspectImageDataUrl(onePixelPng)).toMatchObject({ mime: "image/png", width: 1, height: 1 });
  });

  it("rejects content disguised with an image MIME type", () => {
    expect(() => inspectImageDataUrl(`data:image/png;base64,${Buffer.from("not an image").toString("base64")}`)).toThrow(/实际文件/);
  });

  it("rejects MIME confusion", () => {
    expect(() => inspectImageDataUrl(onePixelPng.replace("image/png", "image/jpeg"))).toThrow(/类型与实际文件/);
  });
});
