import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { config, isLoopbackHost } from "./config.js";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { db, sqlite } from "./db/client.js";
import { ensureSeedData } from "./db/seed.js";
import { registerRoutes } from "./routes.js";
import { ContextBudgetError } from "./services/context-service.js";
import { AiConfigurationError, AiProviderError } from "./services/ai-client.js";
import { aiLogDirectory, flushAiLogs } from "./services/ai-log.js";
import { recoverInterruptedTurns } from "./services/turn-service.js";
import { HttpError } from "./services/http-error.js";
import { BackupValidationError } from "./services/backup-service.js";
import { isBranchMaintenanceActive } from "./services/branch-lock.js";

if (!isLoopbackHost(config.host) && !config.allowUnauthenticatedRemote) {
  throw new Error("AIRP 默认禁止无认证的远程监听。请使用 127.0.0.1，或明确设置 AIRP_ALLOW_UNAUTHENTICATED_REMOTE=true 并自行做好网络隔离。");
}

const app = Fastify({ logger: true, bodyLimit: 4 * 1024 * 1024 });

await app.register(cors, { origin: [config.webOrigin], credentials: false });
app.addHook("onSend", async (_request, reply, payload) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  return payload;
});
app.addHook("preHandler", async (request) => {
  if (request.method !== "GET" && request.url !== "/api/backup/restore" && isBranchMaintenanceActive()) {
    throw new HttpError(409, "MAINTENANCE_IN_PROGRESS", "系统正在恢复备份，请稍后再操作");
  }
});

const migrationsFolder = path.join(config.workspaceDir, "apps", "server", "drizzle");
migrate(db, { migrationsFolder });
await ensureSeedData();
await recoverInterruptedTurns();

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: "请求或 AI 输出不符合 Schema", code: "SCHEMA_VALIDATION_FAILED", details: error.flatten() });
  if (error instanceof AiConfigurationError) return reply.code(400).send({ error: error.message, code: error.code });
  if (error instanceof AiProviderError) return reply.code(error.providerStatus === 504 ? 504 : 502).send({ error: error.message, code: error.code, details: { providerStatus: error.providerStatus } });
  if (error instanceof ContextBudgetError) return reply.code(422).send({ error: error.message, code: "CONTEXT_BUDGET_EXCEEDED", details: { availableTokens: error.availableTokens, breakdown: error.breakdown } });
  if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message, code: error.code });
  if (error instanceof BackupValidationError) return reply.code(400).send({ error: error.message, code: "INVALID_BACKUP" });
  app.log.error(error);
  return reply.code(500).send({ error: "服务端发生内部错误，请查看服务端日志", code: "INTERNAL_ERROR" });
});

await registerRoutes(app);

app.addHook("onClose", async () => {
  await flushAiLogs();
  sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  sqlite.close();
});

const webDist = path.join(config.workspaceDir, "apps", "web", "dist");
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "API route not found", code: "NOT_FOUND" });
    return reply.sendFile("index.html");
  });
}

await app.listen({ host: config.host, port: config.port });
app.log.info({ aiLogDirectory }, "AI request/response logging enabled");
if (!isLoopbackHost(config.host)) app.log.warn("AIRP 正在无认证远程监听；请确保端口未暴露给不可信网络");

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down and flushing AI logs");
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    await flushAiLogs();
  }
};
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
