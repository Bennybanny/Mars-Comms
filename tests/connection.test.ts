import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import QRCode from "qrcode";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import { connectionInfo, type ConnectionQR } from "../shared/connection.js";
const { PNG } = createRequire(import.meta.url)("pngjs");
function assertQR(image: string, url: string) {
  const png = PNG.sync.read(Buffer.from(image.split(",")[1], "base64"));
  const matrix = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      const px = Math.floor(((x + 4.5) * png.width) / (matrix.size + 8));
      const py = Math.floor(((y + 4.5) * png.height) / (matrix.size + 8));
      assert.equal(
        png.data[(py * png.width + px) * 4] < 128,
        !!matrix.get(y, x),
      );
    }
  }
}
test("connection addresses use the selected LAN and custom ports; mDNS is optional", () => {
  const config = { address: "192.0.2.99", port: 8443, setupPort: 8802 };
  assert.deepEqual(connectionInfo(config), {
    address: config.address,
    appUrl: "https://192.0.2.99:8443",
    setupUrl: "http://192.0.2.99:8802/setup",
  });
  assert.equal(
    connectionInfo(config, true).mdnsUrl,
    "https://MarsComms.local:8443",
  );
});

test("authenticated crew gets local QR codes for authoritative URLs without credentials", async () => {
  const store = new Store(":memory:");
  store.saveUser(undefined, {
    username: "crew",
    displayName: "Crew",
    password: "test-password",
    admin: false,
    enabled: true,
    groups: [],
    micGain: 1,
  });
  const token = store.login("crew", "test-password")!;
  const config = { address: "192.0.2.99", port: 8443, setupPort: 8802 };
  const { server, signals } = createApp(store, undefined, {
    connectionInfo: () => connectionInfo(config),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/connection-info`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const result = await fetch(url, { headers: { Cookie: "mars=" + token } });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const info: ConnectionQR = await result.json();
    assert.equal(info.appUrl, "https://192.0.2.99:8443");
    assert.equal(info.setupUrl, "http://192.0.2.99:8802/setup");
    assert.deepEqual(Object.keys(info).sort(), [
      "address",
      "appQR",
      "appUrl",
      "setupQR",
      "setupUrl",
    ]);
    for (const link of [info.appUrl, info.setupUrl]) {
      const parsed = new URL(link);
      assert.equal(
        parsed.username + parsed.password + parsed.search + parsed.hash,
        "",
      );
      assert(!link.includes(token));
    }
    assert(!JSON.stringify(info).includes("PRIVATE KEY"));
    assertQR(info.appQR, info.appUrl);
    assertQR(info.setupQR, info.setupUrl);
  } finally {
    await signals.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
  }
});
