import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("desktop-dist", { recursive: true });
await build({
  entryPoints: ["desktop/main.ts"],
  outfile: "desktop-dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  packages: "external",
  sourcemap: true,
});
await build({
  entryPoints: ["desktop/preload.ts"],
  outfile: "desktop-dist/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
});
await build({
  entryPoints: ["desktop/renderer.ts"],
  outfile: "desktop-dist/renderer.js",
  bundle: true,
  platform: "browser",
  target: "chrome120",
});
await Promise.all(
  ["index.html", "launcher.css"].map((file) =>
    copyFile("desktop/" + file, "desktop-dist/" + file),
  ),
);
await import("./create-icon.mjs");
await copyFile("build/icon.png", "desktop-dist/icon.png");
