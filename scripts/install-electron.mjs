import { existsSync } from "node:fs";
if (existsSync("node_modules/electron/install.js"))
  await import("../node_modules/electron/install.js");
