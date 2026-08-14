import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { db, sqlite } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../../drizzle");

migrate(db, { migrationsFolder });
sqlite.exec("PRAGMA optimize");
console.log(`Applied migrations from ${migrationsFolder}`);
