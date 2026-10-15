import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
const executable =
  process.platform === "win32"
    ? resolve("release/win-unpacked/Mars Comms.exe")
    : process.env.MARS_COMMS_EXECUTABLE;
if (!executable || !existsSync(executable))
  throw Error(
    "Build the unpacked desktop application first. On macOS/Linux set MARS_COMMS_EXECUTABLE to its executable.",
  );
const child = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.desktop.config.ts",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, MARS_COMMS_EXECUTABLE: executable },
  },
);
process.exit(child.status ?? 1);
