import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { config } from "../config.js";
import * as schema from "./schema.js";

fs.mkdirSync(config.dataDir, { recursive: true });
const sqlite = new DatabaseSync(path.join(config.dataDir, "airp.db"));
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA busy_timeout = 5000");

export const db = drizzle({ client: sqlite });
export { sqlite };
