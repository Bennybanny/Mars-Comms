import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
const directory = mkdtempSync(join(tmpdir(), "mars-browser-"));
const store = new Store(join(directory, "mars.sqlite"));
const groups = store.groups();
for (const username of ["camera", "receiver", "tech"])
  store.saveUser(undefined, {
    username,
    displayName: username,
    password: "test-password",
    admin: false,
    enabled: true,
    groups:
      username === "camera"
        ? groups.slice(0, 2).map((g) => g.id)
        : [groups[username === "tech" ? 1 : 0].id],
    micGain: 1,
  });
const { server, signals } = createApp(store);
server.listen(8190, "127.0.0.1", () =>
  console.log("Browser fixture: http://127.0.0.1:8190"),
);
const stop = () => {
  signals.close();
  server.close();
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
