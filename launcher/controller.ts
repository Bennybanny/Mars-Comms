import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createApp } from "../server/app.js";
import { createBootstrapApp } from "../server/setup.js";
import { Store } from "../server/store.js";
import type {
  LauncherConfig,
  LauncherSnapshot,
  NetworkInterface,
} from "../shared/launcher.js";
import { CertificateManager } from "./certificates.js";
import { listInterfaces, selectionAvailable } from "./network.js";
import { writeAtomic } from "./files.js";
import { advertise, type Discovery } from "./discovery.js";
const configSchema = z
  .object({
    interfaceName: z.string().min(1).max(256),
    address: z.ipv4(),
    port: z.number().int().min(1024).max(65535),
    setupPort: z.number().int().min(1024).max(65535),
  })
  .refine(
    (value) => value.port !== value.setupPort,
    "Choose different HTTPS and client setup ports.",
  );
export async function closeListener(server: Server) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => server.closeAllConnections(), 1000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
export class LauncherController extends EventEmitter {
  readonly certificates: CertificateManager;
  config: LauncherConfig;
  state: LauncherSnapshot["state"] = "Stopped";
  mdns: LauncherSnapshot["mdns"] = "—";
  generating = false;
  error?: string;
  notice?: string;
  private instance?: ReturnType<typeof createApp>;
  private bootstrap?: Server;
  private store?: Store;
  private stopDiscovery?: () => Promise<void>;
  private polling?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    readonly options: {
      dataDirectory: string;
      staticRoot: string;
      version: string;
      interfaces?: () => NetworkInterface[];
      discovery?: Discovery;
    },
  ) {
    super();
    mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
    this.certificates = new CertificateManager(options.dataDirectory);
    const interfaces = this.interfaces();
    const initial = interfaces[0];
    this.config = {
      interfaceName: initial.name,
      address: initial.address,
      port: 8090,
      setupPort: 8092,
    };
    const path = join(options.dataDirectory, "launcher.json");
    if (existsSync(path)) {
      try {
        const saved = JSON.parse(readFileSync(path, "utf8"));
        const match = interfaces.find(
          (entry) => entry.address === saved.address,
        );
        this.config = configSchema.parse({
          interfaceName:
            saved.interfaceName ?? match?.name ?? "Previous network",
          address: saved.address,
          port: saved.port,
          setupPort: saved.setupPort ?? 8092,
        });
        if (saved.cert || saved.key)
          this.notice =
            "Existing users and groups are preserved. Generate an integrated certificate once; manually configured certificate files are no longer used.";
      } catch {
        this.notice =
          "The saved launcher settings could not be read. Select a network and save its settings before starting.";
        this.config = {
          ...this.config,
          interfaceName: "Previous network",
          address: "0.0.0.0",
        };
      }
    }
  }
  interfaces() {
    return (this.options.interfaces ?? listInterfaces)();
  }
  snapshot(): LauncherSnapshot {
    const interfaces = this.interfaces();
    const running = this.state === "Running";
    return {
      version: this.options.version,
      state: this.state,
      config: { ...this.config },
      interfaces,
      selectionMissing: !selectionAvailable(this.config, interfaces),
      certificate: this.certificates.status(this.config.address),
      generating: this.generating,
      mdns: this.mdns,
      error: this.error,
      notice: this.notice,
      dataDirectory: this.options.dataDirectory,
      ...(running
        ? {
            url: `https://${this.config.address}:${this.config.port}`,
            setupUrl: `http://${this.config.address}:${this.config.setupPort}/setup`,
            ...(this.mdns === "Available"
              ? { mdnsUrl: `https://MarsComms.local:${this.config.port}` }
              : {}),
          }
        : {}),
    };
  }
  notify() {
    this.emit("change", this.snapshot());
  }
  watch() {
    this.polling ??= setInterval(() => this.notify(), 3000);
    this.polling.unref();
  }
  private ensureIdle() {
    if (
      this.busy ||
      this.generating ||
      !["Stopped", "Error"].includes(this.state)
    )
      throw Error(
        "Stop the server and wait for the current operation before changing settings.",
      );
  }
  configure(input: unknown) {
    this.ensureIdle();
    const parsed = configSchema.safeParse(input);
    if (!parsed.success)
      throw Error(
        "Select an available interface and two different port numbers from 1024 to 65535.",
      );
    const config = parsed.data;
    if (!selectionAvailable(config, this.interfaces()))
      throw Error(
        "The selected network is unavailable. Select an available interface.",
      );
    writeAtomic(
      join(this.options.dataDirectory, "launcher.json"),
      JSON.stringify(config, null, 2),
    );
    this.config = config;
    this.error = undefined;
    this.notice = undefined;
    this.notify();
  }
  async generate() {
    this.ensureIdle();
    if (!selectionAvailable(this.config, this.interfaces()))
      throw Error(
        "Select an available network interface before generating a certificate.",
      );
    this.generating = true;
    this.error = undefined;
    this.notify();
    try {
      await this.certificates.generate(this.config.address);
    } catch (error) {
      this.error = (error as Error).message;
      throw error;
    } finally {
      this.generating = false;
      this.notify();
    }
  }
  async importDatabase(source: string) {
    this.ensureIdle();
    const destination = join(this.options.dataDirectory, "mars.sqlite");
    if (existsSync(destination))
      throw Error(
        "This installation already has a database. It will not be overwritten. Back it up and use a separate data directory to import older data.",
      );
    this.busy = true;
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(source, { readOnly: true });
      if (
        (
          db.prepare("PRAGMA integrity_check").get() as {
            integrity_check: string;
          }
        ).integrity_check !== "ok"
      )
        throw Error("The selected database failed its integrity check.");
      db.prepare("SELECT id,username,hash,json FROM users LIMIT 1").get();
      db.prepare("SELECT id,json FROM groups LIMIT 1").get();
      db.prepare("SELECT token,userId,expires FROM sessions LIMIT 1").get();
      const temporary = destination + "." + randomUUID() + ".tmp";
      await backup(db, temporary);
      renameSync(temporary, destination);
      this.notice =
        "Existing users and groups imported. The source database was not changed.";
    } finally {
      db?.close();
      this.busy = false;
      this.notify();
    }
  }
  async start() {
    this.ensureIdle();
    this.state = "Starting";
    this.error = undefined;
    this.mdns = "—";
    this.notify();
    try {
      if (!selectionAvailable(this.config, this.interfaces()))
        throw Error(
          "The saved network is no longer available. Select an available interface before starting.",
        );
      const certificate = this.certificates.status(this.config.address);
      if (certificate.state !== "ready") throw Error(certificate.message);
      this.store = new Store(join(this.options.dataDirectory, "mars.sqlite"));
      const setup = {
        address: this.config.address,
        httpsPort: this.config.port,
        fingerprint: certificate.fingerprint!,
        publicCertificate: () => this.certificates.publicCertificate(),
      };
      this.instance = createApp(this.store, this.certificates.leafPaths(), {
        staticRoot: this.options.staticRoot,
        setup,
      });
      this.bootstrap = createServer(createBootstrapApp(setup));
      this.bootstrap.on("upgrade", (_req, socket) => socket.destroy());
      await this.listen(this.instance.server, this.config.port);
      await this.listen(this.bootstrap, this.config.setupPort);
      this.instance.server.on("error", () => {
        this.error =
          "The HTTPS listener encountered an error. Stop and restart the server.";
        this.notify();
      });
      this.bootstrap.on("error", () => {
        this.error =
          "The client setup listener encountered an error. Stop and restart the server.";
        this.notify();
      });
      this.mdns = "Starting";
      try {
        this.stopDiscovery = (this.options.discovery ?? advertise)(
          this.config.address,
          this.config.port,
          (state) => {
            if (this.state === "Starting" || this.state === "Running") {
              this.mdns = state;
              this.notify();
            }
          },
        );
      } catch {
        this.mdns = "Unavailable";
      }
      this.state = "Running";
      this.notify();
    } catch (error) {
      await this.cleanup();
      this.state = "Error";
      const code = (error as NodeJS.ErrnoException).code;
      this.error =
        code === "EADDRINUSE"
          ? "One of the selected ports is already in use. Choose different ports or close the other application."
          : code === "EADDRNOTAVAIL"
            ? "The selected network address is no longer available. Select your active Ethernet or Wi-Fi interface."
            : (error as Error).message;
      this.notify();
      throw Error(this.error);
    }
  }
  private async listen(server: Server, port: number) {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      server.once("error", fail);
      server.listen(port, this.config.address, () => {
        server.off("error", fail);
        resolve();
      });
    });
  }
  private async cleanup() {
    const discovery = this.stopDiscovery;
    this.stopDiscovery = undefined;
    const goodbye = Promise.resolve()
      .then(() => discovery?.())
      .catch(() => {});
    if (this.instance) {
      await this.instance.signals.close();
      await closeListener(this.instance.server);
      this.instance = undefined;
    }
    if (this.bootstrap) {
      await closeListener(this.bootstrap);
      this.bootstrap = undefined;
    }
    this.store?.db.close();
    this.store = undefined;
    this.mdns = "—";
    await goodbye;
  }
  async stop() {
    if (this.state === "Stopped") return;
    if (this.state === "Starting" || this.state === "Stopping")
      throw Error("Wait for the server lifecycle operation to finish.");
    this.state = "Stopping";
    this.notify();
    try {
      await this.cleanup();
      this.state = "Stopped";
      this.error = undefined;
    } catch {
      this.state = "Error";
      this.error =
        "Mars Comms could not close all services. Quit the launcher before restarting.";
      throw Error(this.error);
    } finally {
      this.notify();
    }
  }
  async dispose() {
    if (this.state === "Starting" || this.generating || this.busy)
      throw Error("Wait for the current operation to finish before quitting.");
    clearInterval(this.polling);
    await this.stop();
    this.removeAllListeners();
  }
}
