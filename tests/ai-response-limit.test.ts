import { describe, expect, it } from "vitest";
import { AiProviderError, readProviderResponseText } from "../apps/server/src/services/ai-client";

describe("AI provider response limits", () => {
  it("reads a normal UTF-8 response across stream chunks", async () => {
    const response = new Response("你好，world");
    await expect(readProviderResponseText(response, 1024)).resolves.toBe("你好，world");
  });

  it("rejects an oversized provider response", async () => {
    const response = new Response("x".repeat(64));
    await expect(readProviderResponseText(response, 16)).rejects.toBeInstanceOf(AiProviderError);
  });
});
