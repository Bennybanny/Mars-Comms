import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { connectionInfo } from "../shared/connection.js";
const directory = mkdtempSync(join(tmpdir(), "mars-browser-"));
const store = new Store(join(directory, "mars.sqlite"));
const groups = store.groups();
// Distinct fixture colors are configured values, never group-name rules.
for (const [index, group] of groups.entries())
  store.saveGroup(group.id, {
    ...group,
    color: ["#2563eb", "#8b5cf6", "#dc2626", "#16a34a"][index],
  });
for (const username of [
  "camera",
  "receiver",
  "tech",
  "beltpack",
  "allchannels",
])
  store.saveUser(undefined, {
    username,
    displayName: username,
    password: "test-password",
    admin: false,
    enabled: true,
    groups:
      username === "beltpack"
        ? groups.slice(0, 3).map((g) => g.id)
        : username === "allchannels"
          ? groups.map((g) => g.id)
          : username === "camera"
            ? groups.slice(0, 2).map((g) => g.id)
            : [groups[username === "tech" ? 1 : 0].id],
    micGain: 1,
  });
const { server, signals } = createApp(store, undefined, {
  connectionInfo: () =>
    connectionInfo({ address: "192.0.2.25", port: 8443, setupPort: 8802 }),
});
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
