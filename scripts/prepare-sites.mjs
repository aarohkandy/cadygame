import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { force: true, recursive: true });
mkdirSync("dist/client", { recursive: true });
mkdirSync("dist/server", { recursive: true });
cpSync("out", "dist/client", { recursive: true });
cpSync("worker/index.js", "dist/server/index.js");
