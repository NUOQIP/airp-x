import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { config } from "./config.js";
import "./db/client.js";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { db } from "./db/client.js";
import { ensureSeedData } from "./db/seed.js";
import { registerRoutes } from "./routes.js";
import { ContextBudgetError } from "./services/context-service.js";
import { AiConfigurationError, AiProviderError } from "./services/ai-client.js";
import { aiLogDirectory, flushAiLogs } from "./services/ai-log.js";

const app = Fastify({ logger: true, bodyLimit: 4 * 1024 * 1024 });

await app.register(cors, { origin: [config.webOrigin], credentials: false });

const migrationsFolder = path.join(config.workspaceDir, "apps", "server", "drizzle");
migrate(db, { migrationsFolder });
await ensureSeedData();

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: "请求或 AI 输出不符合 Schema", code: "SCHEMA_VALIDATION_FAILED", details: error.flatten() });
  if (error instanceof AiConfigurationError) return reply.code(400).send({ error: error.message, code: error.code });
  if (error instanceof AiProviderError) return reply.code(502).send({ error: error.message, code: error.code, details: { providerStatus: error.providerStatus } });
  if (error instanceof ContextBudgetError) return reply.code(422).send({ error: error.message, code: "CONTEXT_BUDGET_EXCEEDED", details: { availableTokens: error.availableTokens, breakdown: error.breakdown } });
  app.log.error(error);
  return reply.code(500).send({ error: error instanceof Error ? error.message : String(error), code: "INTERNAL_ERROR" });
});

await registerRoutes(app);

app.addHook("onClose", async () => {
  await flushAiLogs();
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
