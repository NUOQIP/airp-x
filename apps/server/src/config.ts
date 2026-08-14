import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(serverDir, "../../..");
dotenv.config({ path: path.join(workspaceDir, ".env") });

export const config = {
  workspaceDir,
  host: process.env.AIRP_HOST ?? "127.0.0.1",
  port: Number(process.env.AIRP_PORT ?? 4317),
  webOrigin: process.env.AIRP_WEB_ORIGIN ?? "http://127.0.0.1:4318",
  dataDir: path.resolve(workspaceDir, process.env.AIRP_DATA_DIR ?? "data"),
  envApiBaseUrl: process.env.AIRP_API_BASE_URL,
  envApiKey: process.env.AIRP_API_KEY,
  envModel: process.env.AIRP_MODEL
} as const;

