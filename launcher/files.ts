import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export function writeAtomic(path: string, contents: string, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + "." + randomUUID() + ".tmp";
  writeFileSync(temporary, contents, { mode, flag: "wx" });
  renameSync(temporary, path);
}
