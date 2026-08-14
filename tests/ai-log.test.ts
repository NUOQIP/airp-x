import { beforeEach, describe, expect, it, vi } from "vitest";

const fileMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  appendFile: vi.fn(async () => undefined),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }),
  unlink: vi.fn(async () => undefined)
}));

vi.mock("node:fs/promises", () => ({
  default: fileMocks,
  ...fileMocks
}));

import {
  aiLogDirectory,
  expiredAiLogFilenames,
  flushAiLogs,
  sanitizeAiLogValue,
  startAiTrace
} from "../apps/server/src/services/ai-log";

function writtenRecords() {
  return fileMocks.appendFile.mock.calls.map((call) => JSON.parse(String(call[1])) as Record<string, unknown>);
}

describe("AI request logging", () => {
  beforeEach(async () => {
    await flushAiLogs();
    fileMocks.mkdir.mockReset().mockResolvedValue(undefined);
    fileMocks.appendFile.mockReset().mockResolvedValue(undefined);
    fileMocks.readdir.mockReset().mockResolvedValue([]);
    fileMocks.stat.mockReset().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    fileMocks.unlink.mockReset().mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it("deeply redacts credentials, URL secrets, Bearer tokens, known secrets, and Data URLs", () => {
    const image = "data:image/png;base64,QUJDRA==";
    const input = {
      apiKey: "top-level",
      nested: {
        api_key: "snake",
        authorization: "Bearer hidden-auth",
        "x-api-key": "header-key",
        "proxy-authorization": "proxy-key",
        safe: "Bearer token-value and known-value",
        url: "https://user:password@provider.example/v1?api_key=query-key&visible=yes&access_token=access-key#fragment",
        image,
        prose: `before data:text/plain,private-payload after`
      }
    };

    const output = sanitizeAiLogValue(input, ["known-value"]) as typeof input;
    expect(output).not.toBe(input);
    expect(output.apiKey).toBe("[REDACTED]");
    expect(output.nested.api_key).toBe("[REDACTED]");
    expect(output.nested.authorization).toBe("[REDACTED]");
    expect(output.nested["x-api-key"]).toBe("[REDACTED]");
    expect(output.nested["proxy-authorization"]).toBe("[REDACTED]");
    expect(output.nested.safe).toBe("Bearer [REDACTED] and [REDACTED_SECRET]");
    expect(output.nested.url).not.toContain("user");
    expect(output.nested.url).not.toContain("password");
    expect(output.nested.url).toContain("api_key=[REDACTED]");
    expect(output.nested.url).toContain("visible=yes");
    expect(output.nested.url).toContain("access_token=[REDACTED]");
    expect(output.nested.image).toBe(`[REDACTED_DATA_URL mime=image/png chars=${image.length}]`);
    expect(output.nested.prose).toContain("[REDACTED_DATA_URL mime=text/plain chars=");
    expect(JSON.stringify(output)).not.toContain("private-payload");
    expect(input.nested.image).toBe(image);
  });

  it("selects only expired dated log files for retention cleanup", () => {
    expect(expiredAiLogFilenames([
      "ai-2026-07-01.jsonl",
      "ai-2026-07-15-2.jsonl",
      "ai-2026-08-01.jsonl",
      "other.jsonl"
    ], "2026-08-14", 30)).toEqual(["ai-2026-07-01.jsonl"]);
  });

  it("serializes Error fields, Zod-style issues, cycles, and long content without truncation", () => {
    const longContent = "x".repeat(100_000);
    const error = Object.assign(new Error("invalid Bearer error-secret"), {
      code: "SCHEMA_VALIDATION_FAILED",
      issues: [{ code: "invalid_string", path: ["events", 4, "account", "avatarText"], message: "Invalid" }]
    });
    const cyclic: Record<string, unknown> = { error, longContent };
    cyclic.self = cyclic;
    const shared = { retained: "twice" };
    cyclic.shared = [shared, shared];

    const output = sanitizeAiLogValue(cyclic) as Record<string, unknown>;
    const serializedError = output.error as Record<string, unknown>;
    expect(serializedError.name).toBe("Error");
    expect(serializedError.message).toBe("invalid Bearer [REDACTED]");
    expect(serializedError.code).toBe("SCHEMA_VALIDATION_FAILED");
    expect(serializedError.issues).toEqual(error.issues);
    expect(output.self).toBe("[Circular]");
    expect(output.shared).toEqual([shared, shared]);
    expect(output.longContent).toBe(longContent);
  });

  it("writes request and result records in queue order with the same call id", async () => {
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    fileMocks.appendFile.mockImplementation(async () => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await Promise.resolve();
      activeWrites -= 1;
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const first = startAiTrace({
      operation: "turn",
      model: "model-a",
      endpoint: "https://provider.example/v1/chat/completions?api_key=secret-query",
      request: { messages: [{ role: "user", content: "full request" }], authorization: "Bearer key" },
      metadata: { turnId: "turn-1", branchId: "branch-1" }
    });
    const second = startAiTrace({ operation: "homepage", model: "model-b", endpoint: "https://provider.example/v1/chat/completions", request: { source: "homepage" } });
    second.failure(Object.assign(new Error("bad output"), { issues: [{ path: ["profile"] }] }), { status: 200, content: "not json" });
    first.success({
      status: 200,
      content: "complete raw content",
      reasoning: "complete reasoning",
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
    });

    await flushAiLogs();
    const records = writtenRecords();
    expect(records.map((record) => [record.event, record.callId])).toEqual([
      ["ai.request", first.callId],
      ["ai.request", second.callId],
      ["ai.result", second.callId],
      ["ai.result", first.callId]
    ]);
    expect(records[2]).toMatchObject({ outcome: "failure", details: { status: 200, content: "not json" } });
    expect(records[3]).toMatchObject({ outcome: "success", details: { content: "complete raw content", reasoning: "complete reasoning" } });
    expect(JSON.stringify(records[0])).not.toContain("secret-query");
    expect(maximumActiveWrites).toBe(1);
    expect(fileMocks.appendFile.mock.calls.every((call) => String(call[0]).startsWith(aiLogDirectory))).toBe(true);
    expect(fileMocks.appendFile.mock.calls.every((call) => /ai-\d{4}-\d{2}-\d{2}\.jsonl$/.test(String(call[0])))).toBe(true);
    expect(info).toHaveBeenCalledTimes(4);
    expect(info.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain("complete raw content");
    expect(info.mock.calls.map((call) => String(call[0])).join("\n")).toContain("status=200 in=11 out=7 total=18 content=20c reasoning=18c");
  });

  it("finishes a trace only once", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const trace = startAiTrace({ operation: "capability", model: "model", endpoint: "https://provider.example", request: {} });
    trace.success({ status: 200 });
    trace.failure(new Error("late failure"));
    await flushAiLogs();
    expect(writtenRecords()).toHaveLength(2);
    expect(writtenRecords()[1]).toMatchObject({ event: "ai.result", outcome: "success" });
  });

  it("swallows filesystem failures and rate-limits warnings", async () => {
    fileMocks.appendFile.mockRejectedValue(new Error("disk unavailable known-log-secret"));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => {
      const trace = startAiTrace({ operation: "turn", model: "model", endpoint: "https://provider.example", request: {}, secrets: ["known-log-secret"] });
      trace.failure(new Error("provider error"));
    }).not.toThrow();
    await expect(flushAiLogs()).resolves.toBeUndefined();
    expect(fileMocks.appendFile).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(String(warning.mock.calls[0]?.[0])).not.toContain("known-log-secret");
  });
});
