import { conflict } from "./http-error.js";

const branchTails = new Map<string, Promise<void>>();
let maintenanceActive = false;

/**
 * Serializes state-changing work for one branch in this single-process desktop server.
 * Different branches remain independent, while a failed operation never poisons the queue.
 */
export async function withBranchLock<T>(branchId: string, operation: () => Promise<T>): Promise<T> {
  if (maintenanceActive) throw conflict("系统正在恢复备份，请稍后再操作", "MAINTENANCE_IN_PROGRESS");
  const previous = branchTails.get(branchId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  branchTails.set(branchId, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (branchTails.get(branchId) === tail) branchTails.delete(branchId);
  }
}

export function beginBranchMaintenance() {
  if (maintenanceActive || branchTails.size > 0) throw conflict("仍有回合或平台操作正在处理，暂时不能恢复备份", "APP_BUSY");
  maintenanceActive = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    maintenanceActive = false;
  };
}

export function activeBranchLockCount() {
  return branchTails.size;
}

export function isBranchMaintenanceActive() {
  return maintenanceActive;
}
