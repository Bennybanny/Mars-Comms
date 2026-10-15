import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "selfsigned";
import { request } from "node:https";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";

test("trusted HTTPS login sets Secure cookie and WSS authenticates with certificate validation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mars-tls-"));
  const cert = await generate([{ name: "commonName", value: "localhost" }], {
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: true },
      {
        name: "keyUsage",
        digitalSignature: true,
        keyEncipherment: true,
        keyCertSign: true,
      },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 7, ip: "127.0.0.1" },
          { type: 2, value: "localhost" },
        ],
      },
    ],
  });
  const certPath = join(directory, "cert.pem"),
    keyPath = join(directory, "key.pem");
  writeFileSync(certPath, cert.cert);
  writeFileSync(keyPath, cert.private);
  const store = new Store(":memory:");
  const { server, signals } = createApp(store, {
    cert: certPath,
    key: keyPath,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  let ws: WebSocket | undefined;
  try {
    const result = await new Promise<{
      status: number;
      cookie: string;
      body: string;
    }>((resolve, reject) => {
      const req = request(
        `https://127.0.0.1:${port}/api/login`,
        {
          method: "POST",
          ca: cert.cert,
          headers: {
            "Content-Type": "application/json",
            Origin: `https://127.0.0.1:${port}`,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              cookie: res.headers["set-cookie"]?.[0] ?? "",
              body,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ username: "admin", password: "admin" }));
    });
    assert.equal(result.status, 200);
    assert.match(result.cookie, /; Secure/);
    assert.equal(JSON.parse(result.body).username, "admin");
    ws = new WebSocket(`wss://127.0.0.1:${port}/signal`, {
      ca: cert.cert,
      origin: `https://127.0.0.1:${port}`,
      headers: { Cookie: result.cookie.split(";")[0] },
    });
    const snapshot = JSON.parse((await once(ws, "message"))[0].toString());
    assert.equal(snapshot.type, "snapshot");
    assert.equal(snapshot.groups.length, 4);
  } finally {
    ws?.terminate();
    signals.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
