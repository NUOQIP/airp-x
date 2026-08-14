import type { ApiErrorBody, AppSnapshot, ConfigSnapshot, HomepageDraft, LocalAction, PlayerTurnInput, RuntimeSettings, TurnAccepted } from "@airp/shared";

export class ApiError extends Error {
  constructor(message: string, public code: string, public details?: unknown, public status?: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  const timeoutSignal = AbortSignal.timeout(620_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new ApiError("请求超时，请检查模型服务后重试", "REQUEST_TIMEOUT");
    throw error;
  }
  if (!response.ok) {
    let body: ApiErrorBody = { error: response.statusText, code: "HTTP_ERROR" };
    try { body = await response.json() as ApiErrorBody; } catch { /* no-op */ }
    throw new ApiError(body.error, body.code, body.details, response.status);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text.trim()) return undefined as T;
  try { return JSON.parse(text) as T; }
  catch { throw new ApiError("服务端返回了无法解析的数据", "INVALID_RESPONSE", undefined, response.status); }
}

export const apiClient = {
  snapshot: (branchId?: string) => api<AppSnapshot>(`/api/snapshot${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`),
  config: () => api<ConfigSnapshot>("/api/config"),
  submitTurn: (input: PlayerTurnInput) => api<TurnAccepted>("/api/turns", { method: "POST", body: JSON.stringify(input) }),
  retryTurn: (id: string) => api<TurnAccepted>(`/api/turns/${id}/retry`, { method: "POST", body: "{}" }),
  regenerateTurn: (id: string) => api<TurnAccepted>(`/api/turns/${id}/regenerate`, { method: "POST", body: "{}" }),
  selectCandidate: (id: string) => api<AppSnapshot>(`/api/candidates/${id}/select`, { method: "POST", body: "{}" }),
  localAction: (input: LocalAction) => api<AppSnapshot>("/api/actions", { method: "POST", body: JSON.stringify(input) }),
  updateAvatar: (branchId: string, accountId: string, avatarText: string, avatarUrl: string) => api<AppSnapshot>(`/api/accounts/${encodeURIComponent(accountId)}/avatar`, { method: "PUT", body: JSON.stringify({ branchId, avatarText, avatarUrl }) }),
  updateProfileBanner: (branchId: string, bannerTone: "" | AppSnapshot["profile"]["bannerTone"], bannerUrl: string) => api<AppSnapshot>("/api/profile/banner", { method: "PUT", body: JSON.stringify({ branchId, bannerTone, bannerUrl }) }),
  createSession: (name: string) => api<AppSnapshot>("/api/sessions", { method: "POST", body: JSON.stringify({ name }) }),
  activateSession: (id: string) => api<AppSnapshot>(`/api/sessions/${id}/activate`, { method: "POST", body: "{}" }),
  activateBranch: (id: string) => api<AppSnapshot>(`/api/branches/${id}/activate`, { method: "POST", body: "{}" }),
  forkFromTurn: (id: string, text: string) => api<TurnAccepted>(`/api/branches/from-turn/${id}`, { method: "POST", body: JSON.stringify({ text }) }),
  previewHomepage: (sourceText: string) => api<{ draft: HomepageDraft }>("/api/homepage/preview", { method: "POST", body: JSON.stringify({ sourceText }) }),
  applyHomepage: (branchId: string, sourceText: string, draft: HomepageDraft) => api<AppSnapshot>("/api/homepage/apply", { method: "POST", body: JSON.stringify({ branchId, sourceText, draft }) }),
  saveSettings: (value: Partial<RuntimeSettings>) => api<ConfigSnapshot["settings"]>("/api/settings", { method: "PUT", body: JSON.stringify(value) }),
  testSettings: (value: Partial<RuntimeSettings>) => api<{ ok: boolean; model: string; mode: "json_schema" | "json_object" }>("/api/settings/test", { method: "POST", body: JSON.stringify(value) })
};
