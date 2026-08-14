import { describe, expect, it } from "vitest";
import { activeBranchLockCount, beginBranchMaintenance, withBranchLock } from "../apps/server/src/services/branch-lock";

describe("branch state lock", () => {
  it("serializes work on the same branch while allowing another branch to proceed", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = withBranchLock("main", async () => {
      events.push("main-1-start");
      await firstGate;
      events.push("main-1-end");
    });
    const second = withBranchLock("main", async () => { events.push("main-2"); });
    const other = withBranchLock("other", async () => { events.push("other"); });
    await other;
    expect(events).toEqual(["main-1-start", "other"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["main-1-start", "other", "main-1-end", "main-2"]);
    expect(activeBranchLockCount()).toBe(0);
  });

  it("releases a branch after an operation throws", async () => {
    await expect(withBranchLock("main", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withBranchLock("main", async () => "recovered")).resolves.toBe("recovered");
    expect(activeBranchLockCount()).toBe(0);
  });

  it("blocks new branch mutations while backup maintenance is reserved", async () => {
    const release = beginBranchMaintenance();
    await expect(withBranchLock("main", async () => undefined)).rejects.toMatchObject({ code: "MAINTENANCE_IN_PROGRESS" });
    release();
    await expect(withBranchLock("main", async () => "ok")).resolves.toBe("ok");
  });
});
