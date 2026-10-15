import express from "express";
import { networkInterfaces } from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Bonjour } from "bonjour-service";
import { createApp } from "./app.js";
import { Store } from "./store.js";
const launcher = express();
const token = randomBytes(24).toString("hex");
launcher.use(express.json());
launcher.use((req, res, next) => {
  if (!["127.0.0.1:8091", "localhost:8091"].includes(req.headers.host ?? "")) {
    res.sendStatus(403);
    return;
  }
  next();
});
let running: ReturnType<typeof createApp> | undefined;
let starting = false;
let bonjour: Bonjour | undefined;
let status: Record<string, unknown> = { running: false };
const interfaces = () =>
  Object.entries(networkInterfaces())
    .filter(
      ([name]) =>
        !/loopback|vethernet|virtual|vmware|vbox|docker|wsl|vpn|nordlynx|tailscale|zerotier/i.test(
          name,
        ),
    )
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter(
          (e) =>
            e.family === "IPv4" &&
            !e.internal &&
            !e.address.startsWith("169.254."),
        )
        .map((e) => ({ name, address: e.address })),
    );
launcher.get("/", (_req, res) =>
  res
    .type("html")
    .send(
      readFileSync(
        new URL("./launcher.html", import.meta.url),
        "utf8",
      ).replaceAll("__TOKEN__", token),
    ),
);
let saved = {};
try {
  saved = JSON.parse(readFileSync("data/launcher.json", "utf8"));
} catch {}
launcher.get("/status", (_req, res) =>
  res.json({ ...status, saved, interfaces: interfaces() }),
);
launcher.post("/start", async (req, res) => {
  if (req.headers["x-launcher-token"] !== token) {
    res.sendStatus(403);
    return;
  }
  if (running || starting) {
    res.status(409).json({
      error: "Server already running; restart the launcher to change settings.",
    });
    return;
  }
  starting = true;
  let store: Store | undefined;
  let instance: ReturnType<typeof createApp> | undefined;
  try {
    const { address, port, cert, key } = req.body;
    if (
      !interfaces().some((i) => i.address === address) &&
      address !== "127.0.0.1"
    )
      throw Error("Select an available interface");
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8091)
      throw Error("Port must be 1024–65535, excluding launcher port 8091");
    if (Boolean(cert) !== Boolean(key))
      throw Error("Both certificate and key paths are required");
    const tls = cert && key ? { cert, key } : undefined;
    store = new Store("data/mars.sqlite");
    instance = createApp(store, tls);
    const app = instance;
    await new Promise<void>((yes, no) => {
      app.server.once("error", no);
      app.server.listen(port, address, () => {
        app.server.off("error", no);
        yes();
      });
    });
    mkdirSync("data", { recursive: true });
    writeFileSync(
      "data/launcher.json",
      JSON.stringify({ address, port, cert, key }),
    );
    running = instance;
    status = {
      running: true,
      url: `${tls ? "https" : "http"}://${address}:${port}`,
      mdns: "Starting",
      secure: !!tls,
    };
    try {
      bonjour = new Bonjour({}, () => {
        status.mdns = "Unavailable — use IP address";
      });
      const service = bonjour.publish({
        name: "Mars Comms",
        type: tls ? "https" : "http",
        port,
        host: "MarsComms.local",
        probe: true,
        disableIPv6: true,
      });
      // Bonjour enumerates every interface by default. Advertise only the IP
      // where the actual application socket is bound.
      const records = service.records.bind(service);
      service.records = () => [
        ...records().filter(
          (record) => record.type !== "A" && record.type !== "AAAA",
        ),
        { name: service.host, type: "A", ttl: 120, data: address },
      ];
      service.on("up", () => {
        status.mdns = "Available";
        status.mdnsUrl = `${tls ? "https" : "http"}://MarsComms.local:${port}`;
      });
      service.on("error", () => {
        status.mdns = "Unavailable — use IP address";
      });
      setTimeout(() => {
        if (status.mdns === "Starting")
          status.mdns = "Unavailable — use IP address";
      }, 5000);
    } catch {
      status.mdns = "Unavailable — use IP address";
    }
    res.json(status);
  } catch (e) {
    if (instance !== running) {
      instance?.signals.close();
      instance?.server.close();
      store?.db.close();
    }
    res.status(400).json({ error: (e as Error).message });
  } finally {
    starting = false;
  }
});
launcher.listen(8091, "127.0.0.1", () =>
  console.log("Mars Comms launcher: http://127.0.0.1:8091"),
);
function stop() {
  bonjour?.destroy();
  running?.signals.close();
  running?.server.close();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
