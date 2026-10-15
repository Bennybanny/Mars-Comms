import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  renameSync,
} from "node:fs";
import { tmpdir, type NetworkInterfaceInfo } from "node:os";
import { join, resolve } from "node:path";
import { X509Certificate } from "node:crypto";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Store } from "../server/store.js";
import { CertificateManager } from "../launcher/certificates.js";
import { LauncherController, closeListener } from "../launcher/controller.js";
import { listInterfaces, selectionAvailable } from "../launcher/network.js";
import { dataDirectory } from "../launcher/paths.js";
const local = { name: "Local test", address: "127.0.0.1" };
const temporary = () => mkdtempSync(join(tmpdir(), "mars-launcher-"));
test("packaged data paths are outside the application and honor XDG on Linux", () => {
  const root = resolve(tmpdir(), "mars-path-check");
  const input = {
    packaged: true,
    appData: join(root, "appData"),
    home: join(root, "home"),
  };
  assert.equal(
    dataDirectory({ ...input, platform: "win32" }),
    join(root, "appData", "Mars Comms"),
  );
  assert.equal(
    dataDirectory({ ...input, platform: "darwin" }),
    join(root, "appData", "Mars Comms"),
  );
  assert.equal(
    dataDirectory({ ...input, platform: "linux" }),
    join(root, "home", ".local", "share", "Mars Comms"),
  );
  assert.equal(
    dataDirectory({
      ...input,
      platform: "linux",
      xdgDataHome: join(root, "xdg"),
    }),
    join(root, "xdg", "Mars Comms"),
  );
  assert.equal(
    dataDirectory({ ...input, packaged: false, developmentRoot: root }),
    join(root, "data"),
  );
});
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await closeListener(server);
  return port;
}
function https(url: string, ca: string, body?: unknown) {
  return new Promise<{ status: number; body: string; cookie: string }>(
    (resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          ca,
          method: body ? "POST" : "GET",
          headers: body
            ? {
                "Content-Type": "application/json",
                Origin: new URL(url).origin,
              }
            : {},
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              body: data,
              cookie: res.headers["set-cookie"]?.[0]?.split(";")[0] ?? "",
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    },
  );
}
test("NIC enumeration filters unsuitable IPv4 interfaces and retains explicit localhost", () => {
  const entry = (address: string, internal = false, family = "IPv4") =>
    ({
      address,
      internal,
      family,
      netmask: "255.255.255.0",
      mac: "00:11:22:33:44:55",
      cidr: address + "/24",
    }) as NetworkInterfaceInfo;
  const interfaces = listInterfaces({
    Ethernet: [entry("192.168.1.2"), entry("fe80::1", false, "IPv6")],
    "Wi-Fi": [entry("169.254.1.2"), entry("192.168.1.2")],
    NordLynx: [entry("10.0.0.2")],
    "vEthernet (Default Switch)": [entry("172.18.1.1")],
    lo: [entry("127.0.0.1", true)],
  });
  assert.deepEqual(interfaces, [
    { name: "Ethernet", address: "192.168.1.2" },
    { name: "Localhost / development", address: "127.0.0.1" },
  ]);
  assert(
    !selectionAvailable(
      {
        interfaceName: "Old Ethernet",
        address: "192.168.1.2",
        port: 8090,
        setupPort: 8092,
      },
      interfaces,
    ),
  );
});
test("CA and leaf creation, SANs, CA reuse, mismatch, renewal, expiry and public-only export", async () => {
  const directory = temporary();
  try {
    const manager = new CertificateManager(join(directory, "app"));
    assert.equal(manager.status("192.168.1.20").state, "missing");
    await manager.generate("192.168.1.20");
    const initial = manager.status("192.168.1.20");
    assert.equal(initial.state, "ready");
    const root = manager.publicCertificate(),
      key = readFileSync(manager.caKeyPath, "utf8"),
      paths = manager.leafPaths(),
      leaf = new X509Certificate(readFileSync(paths.cert)),
      ca = new X509Certificate(root);
    assert(ca.ca);
    assert(!leaf.ca);
    assert(leaf.verify(ca.publicKey));
    assert(leaf.checkIP("192.168.1.20"));
    assert(leaf.checkIP("127.0.0.1"));
    assert(leaf.checkHost("MarsComms.local"));
    assert(leaf.checkHost("localhost"));
    assert(leaf.keyUsage?.includes("1.3.6.1.5.5.7.3.1"));
    assert.equal(manager.status("192.168.50.10").state, "needs-update");
    assert.equal(
      manager.status("192.168.1.20", new Date(leaf.validTo).getTime() + 1)
        .state,
      "expired",
    );
    assert.equal(
      manager.status(
        "192.168.1.20",
        new Date(leaf.validTo).getTime() - 86400000,
      ).state,
      "needs-update",
    );
    await manager.generate("192.168.50.10");
    assert.equal(manager.status("192.168.50.10").state, "ready");
    assert.equal(manager.publicCertificate(), root);
    writeFileSync(manager.caKeyPath, "invalid private key");
    assert.equal(manager.status("192.168.50.10").state, "error");
    await assert.rejects(() => manager.generate("192.168.50.10"), /local CA/);
    assert.equal(manager.publicCertificate(), root);
    assert.equal(
      readFileSync(manager.caKeyPath, "utf8"),
      "invalid private key",
    );
    writeFileSync(manager.caKeyPath, key);
    const caDirectory = join(manager.directory, "ca");
    const backupDirectory = join(manager.directory, "ca-backup");
    renameSync(caDirectory, backupDirectory);
    assert.equal(manager.status("192.168.50.10").state, "error");
    await assert.rejects(
      () => manager.generate("192.168.50.10"),
      /local CA is missing/,
    );
    renameSync(backupDirectory, caDirectory);
    assert.equal(readFileSync(manager.caKeyPath, "utf8"), key);
    assert.notEqual(manager.leafPaths().cert, paths.cert);
    const exported = join(directory, "Mars-Comms-CA.crt");
    manager.exportPublicCA(exported);
    assert.equal(readFileSync(exported, "utf8"), root);
    assert(!readFileSync(exported, "utf8").includes("PRIVATE KEY"));
    assert.throws(() => manager.exportPublicCA(manager.caKeyPath));
    if (process.platform !== "win32")
      assert.equal(statSync(manager.caKeyPath).mode & 0o777, 0o600);
    const current = manager.leafPaths();
    writeFileSync(current.cert, "broken certificate");
    assert.equal(manager.status("192.168.50.10").state, "error");
    await manager.generate("192.168.50.10");
    assert.equal(manager.status("192.168.50.10").state, "ready");
    assert.equal(manager.publicCertificate(), root);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("missing saved NIC never silently selects another interface, including after restart", () => {
  const directory = temporary();
  try {
    const options = {
      dataDirectory: directory,
      staticRoot: resolve("dist"),
      version: "test",
      interfaces: () => [local],
    };
    const c = new LauncherController(options);
    c.configure({
      interfaceName: local.name,
      address: local.address,
      port: 8090,
      setupPort: 8092,
    });
    const restored = new LauncherController({
      ...options,
      interfaces: () => [{ name: "Other network", address: "192.168.1.3" }],
    });
    assert(restored.snapshot().selectionMissing);
    assert.equal(restored.snapshot().config.address, "127.0.0.1");
    assert.equal(restored.snapshot().config.interfaceName, local.name);
    assert.throws(() => restored.configure({ ...restored.config, port: 8092 }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("real HTTPS lifecycle, setup allowlist, no key download, duplicate start, graceful stop and persistent data", async () => {
  const directory = temporary();
  let controller: LauncherController | undefined;
  try {
    const port = await freePort();
    let setupPort = await freePort();
    while (setupPort === port) setupPort = await freePort();
    controller = new LauncherController({
      dataDirectory: directory,
      staticRoot: resolve("dist"),
      version: "test",
      interfaces: () => [local],
      discovery: () => {
        throw Error("mDNS unavailable");
      },
    });
    const c = controller;
    const transitions: string[] = [];
    c.on("change", (state) => transitions.push(state.state));
    c.configure({ ...local, interfaceName: local.name, port, setupPort });
    await assert.rejects(() => c.start(), /Generate a certificate/);
    assert.equal(c.state, "Error");
    await c.generate();
    await c.start();
    assert.equal(c.state, "Running");
    assert.equal(c.mdns, "Unavailable");
    await assert.rejects(() => c.start());
    assert.throws(() => c.configure(c.config));
    const ca = c.certificates.publicCertificate(),
      rootFingerprint = c.snapshot().certificate.fingerprint,
      base = `https://127.0.0.1:${port}`,
      bootstrap = `http://127.0.0.1:${setupPort}`;
    const login = await https(base + "/api/login", ca, {
      username: "admin",
      password: "admin",
    });
    assert.equal(login.status, 200);
    assert.equal(JSON.parse(login.body).username, "admin");
    for (const origin of [base, bootstrap]) {
      const load = (path: string) =>
        origin === base
          ? https(origin + path, ca)
          : fetch(origin + path).then(async (r) => ({
              status: r.status,
              body: await r.text(),
            }));
      const setup = await load("/setup");
      assert.equal(setup.status, 200);
      assert(setup.body.includes(base));
      assert(setup.body.includes(rootFingerprint!));
      const certificate = await load("/certificate");
      assert.equal(certificate.status, 200);
      assert.equal(certificate.body, ca);
      assert(!certificate.body.includes("PRIVATE KEY"));
      for (const path of [
        "/mars-comms-root-ca-key.pem",
        "/certificates/ca/mars-comms-root-ca-key.pem",
        "/certificates/server/mars-comms-server-key.pem",
        "/data/mars.sqlite",
        "/server/store.ts",
        "/%2e%2e/certificates/ca/mars-comms-root-ca-key.pem",
      ]) {
        const blocked = await load(path);
        assert.equal(blocked.status, 404, path);
        assert(!blocked.body.includes("PRIVATE KEY"));
      }
    }
    for (const path of [
      "/api/me",
      "/api/admin/users",
      "/api/login",
      "/signal",
      "/assets/index.js",
    ])
      assert.equal((await fetch(bootstrap + path)).status, 404, path);
    assert.equal(
      (await fetch(bootstrap + "/api/login", { method: "POST", body: "{}" }))
        .status,
      405,
    );
    const ws = new WebSocket(`wss://127.0.0.1:${port}/signal`, {
      ca,
      origin: base,
      headers: { Cookie: login.cookie },
    });
    const snapshot = JSON.parse((await once(ws, "message"))[0].toString());
    ws.send(
      JSON.stringify({
        type: "state",
        talk: [snapshot.groups[0].id],
        listen: [],
      }),
    );
    await once(ws, "message");
    const closed = once(ws, "close");
    await c.stop();
    assert.equal((await closed)[0], 1001);
    assert.equal(c.state, "Stopped");
    await assert.rejects(() => https(base, ca));
    await assert.rejects(() => fetch(bootstrap + "/setup"));
    assert(transitions.includes("Starting"));
    assert(transitions.includes("Running"));
    assert(transitions.includes("Stopping"));
    assert.equal(transitions.at(-1), "Stopped");
    await c.start();
    assert.equal(
      c.certificates.status(local.address).fingerprint,
      rootFingerprint,
    );
    const relogin = await https(base + "/api/login", ca, {
      username: "admin",
      password: "admin",
    });
    assert.equal(relogin.status, 200);
    const next = new WebSocket(`wss://127.0.0.1:${port}/signal`, {
      ca,
      origin: base,
      headers: { Cookie: relogin.cookie },
    });
    const reconnected = JSON.parse((await once(next, "message"))[0].toString());
    assert.deepEqual(reconnected.peers, []);
    assert.notEqual(reconnected.self, snapshot.self);
    // Simulate a client that cannot process the graceful close handshake.
    const transport = (
      next as unknown as { _socket: { pause: () => void; resume: () => void } }
    )._socket;
    transport.pause();
    const closedUnresponsive = once(next, "close");
    const stopStarted = Date.now();
    await c.stop();
    transport.resume();
    await closedUnresponsive;
    assert(
      Date.now() - stopStarted < 4000,
      "Stop must finish even with an unresponsive WebSocket client",
    );
  } finally {
    await controller?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("occupied setup port rolls HTTPS startup back and allows a later retry", async () => {
  const directory = temporary(),
    occupied = createServer();
  let c: LauncherController | undefined;
  try {
    occupied.listen(0, "127.0.0.1");
    await once(occupied, "listening");
    const setupPort = (occupied.address() as { port: number }).port;
    const port = await freePort();
    c = new LauncherController({
      dataDirectory: directory,
      staticRoot: resolve("dist"),
      version: "test",
      interfaces: () => [local],
      discovery: () => async () => {},
    });
    c.configure({
      interfaceName: local.name,
      address: local.address,
      port,
      setupPort,
    });
    await c.generate();
    await assert.rejects(() => c!.start(), /already in use/);
    assert.equal(c.state, "Error");
    await assert.rejects(() =>
      https(`https://127.0.0.1:${port}`, c!.certificates.publicCertificate()),
    );
    await closeListener(occupied);
    await c.start();
    assert.equal(c.state, "Running");
  } finally {
    await c?.dispose();
    await closeListener(occupied);
    rmSync(directory, { recursive: true, force: true });
  }
});
test("existing development database import preserves users and never overwrites a target database", async () => {
  const directory = temporary();
  try {
    const legacy = new Store(join(directory, "legacy.sqlite"));
    const user = legacy.saveUser(undefined, {
      username: "existing",
      displayName: "Existing crew",
      password: "secret",
      enabled: true,
      admin: false,
      groups: [],
      micGain: 1,
    });
    const c = new LauncherController({
      dataDirectory: join(directory, "app"),
      staticRoot: resolve("dist"),
      version: "test",
      interfaces: () => [local],
    });
    await c.importDatabase(join(directory, "legacy.sqlite"));
    const imported = new Store(join(directory, "app", "mars.sqlite"));
    assert.equal(imported.user(user.id)?.username, "existing");
    assert(imported.login("existing", "secret"));
    assert(legacy.user(user.id));
    await assert.rejects(
      () => c.importDatabase(join(directory, "legacy.sqlite")),
      /not be overwritten/,
    );
    legacy.db.close();
    imported.db.close();
    await c.dispose();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
