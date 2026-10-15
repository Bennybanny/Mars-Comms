import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
if (process.platform !== "win32")
  throw Error("The portable executable smoke test requires Windows.");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const result = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    resolve("scripts/smoke-portable.ps1"),
    "-Executable",
    resolve(`release/Mars-Comms-${version}-Windows-Portable.exe`),
    "-DataDirectory",
    resolve(`portable-test-results/portable-${randomUUID()}`),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
