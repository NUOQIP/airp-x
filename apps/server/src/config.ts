import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(serverDir, "../../..");
dotenv.config({ path: path.join(workspaceDir, ".env") });

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isLoopbackHost(host: string) {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export const config = {
  workspaceDir,
  host: process.env.AIRP_HOST ?? "127.0.0.1",
  allowUnauthenticatedRemote: process.env.AIRP_ALLOW_UNAUTHENTICATED_REMOTE === "true",
  port: Number(process.env.AIRP_PORT ?? 4317),
  webOrigin: process.env.AIRP_WEB_ORIGIN ?? "http://127.0.0.1:4318",
  dataDir: path.resolve(workspaceDir, process.env.AIRP_DATA_DIR ?? "data"),
  aiRequestTimeoutMs: positiveNumber(process.env.AIRP_AI_TIMEOUT_MS, 600_000),
  aiMaxResponseBytes: positiveNumber(process.env.AIRP_AI_MAX_RESPONSE_BYTES, 16 * 1024 * 1024),
  aiLogRetentionDays: positiveNumber(process.env.AIRP_AI_LOG_RETENTION_DAYS, 30),
  aiLogMaxFileBytes: positiveNumber(process.env.AIRP_AI_LOG_MAX_FILE_BYTES, 100 * 1024 * 1024),
  envApiBaseUrl: process.env.AIRP_API_BASE_URL,
  envApiKey: process.env.AIRP_API_KEY,
  envModel: process.env.AIRP_MODEL
} as const;
