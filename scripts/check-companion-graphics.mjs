// Optional local QA: use the installed Companion renderer, isolated from its running server/configuration.
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
const resources =
  process.env.COMPANION_RESOURCES ?? "C:/Program Files/Companion/resources";
const moduleDirectory =
  process.env.MARS_COMPANION_MODULE_DIR ??
  resolve("../companion-module-mars-comms");
const { buttonElements } = await import(
  pathToFileURL(join(moduleDirectory, "dist/definitions.js")).href
);
const worker = new Worker(pathToFileURL(join(resources, "RenderThread.js")));
let sequence = 0;
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off("message", receive);
      reject(Error("Companion renderer timeout"));
    }, 15000);
    function receive(message) {
      if (message?.id !== id) return;
      clearTimeout(timeout);
      worker.off("message", receive);
      if (message.error) reject(Error(message.error.message));
      else resolve(message.result);
    }
    worker.on("message", receive);
    worker.postMessage({ id, method, params });
  });
}
try {
  await once(worker, "message");
  const directory = resolve("test-results/companion-graphics");
  mkdirSync(directory, { recursive: true });
  const sheet = new PNG({ width: 720, height: 360 });
  sheet.data.fill(18);
  let index = 0;
  for (const active of [false, true])
    for (const [label, name, color] of [
      ["PTT", "CAMERA", 0x2563eb],
      ["LATCH", "TECH", 0x8b5cf6],
      ["LISTEN", "SHOW", 0xeab308],
      ["SMART", "A LONG CHANNEL NAME", 0x16a34a],
      ["CLEAR TALK", "COMMS", 0x8b5cf6],
    ]) {
      const elements = buttonElements(label, label !== "CLEAR TALK").map(
        (raw) => {
          const e = {
            enabled: true,
            opacity: 1,
            rotation: 0,
            cornerRadius: 0,
            borderWidth: 0,
            borderColor: 0,
            borderPosition: "inside",
            font: "companion-sans",
            weight: "normal",
            styles: [],
            outlineColor: 0xff000000,
            ...raw,
          };
          for (const key of ["x", "y", "width", "height", "borderWidth"])
            if (typeof e[key] === "number") e[key] /= 100;
          if (e.id === "bar") e.color = color;
          if (e.id === "channel") e.text = name;
          if (e.id === "frame" && active && label !== "CLEAR TALK")
            e.borderWidth = 0.04;
          return e;
        },
      );
      for (const size of [72, 96, 144]) {
        const result = await request("drawButtonImageBuffer", [
          {
            type: "button",
            elements,
            decoration: "none",
            show_status_icons: false,
            pushed: false,
            stepCount: 1,
            stepCurrent: 1,
          },
          { width: size, height: size, oversampling: 4 },
          null,
          "rgba",
        ]);
        const image = new PNG({ width: size, height: size });
        image.data = Buffer.from(result);
        assert.equal(image.data.length, size * size * 4);
        const pixel = (x, y) => [
          ...image.data.subarray((y * size + x) * 4, (y * size + x) * 4 + 3),
        ];
        assert.deepEqual(
          pixel(0, Math.floor(size / 2)),
          active && label !== "CLEAR TALK" ? [255, 255, 255] : [32, 21, 47],
        );
        if (label !== "CLEAR TALK")
          assert.deepEqual(
            pixel(Math.floor(size / 2), Math.floor(size * 0.055)),
            [(color >> 16) & 255, (color >> 8) & 255, color & 255],
          );
        writeFileSync(
          join(
            directory,
            `${label.replaceAll(" ", "-")}-${active ? "active" : "idle"}-${size}.png`,
          ),
          PNG.sync.write(image),
        );
        if (size === 144)
          for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
              const target =
                (((active ? 180 : 0) + y + 18) * sheet.width +
                  (index % 5) * 144 +
                  x) *
                4;
              image.data.copy(
                sheet.data,
                target,
                (y * size + x) * 4,
                (y * size + x) * 4 + 4,
              );
            }
      }
      index++;
    }
  writeFileSync(join(directory, "contact-sheet.png"), PNG.sync.write(sheet));
  console.log(
    `Companion native renderer: 30 renders verified; ${join(directory, "contact-sheet.png")}`,
  );
} finally {
  await worker.terminate();
}
