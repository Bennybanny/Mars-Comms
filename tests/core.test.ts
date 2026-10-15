import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Store, hashPassword, verifyPassword } from "../server/store.js";
import { createApp } from "../server/app.js";
import { sanitizeState, routeVolume } from "../shared/types.js";
const userData = (groups: string[] = []) => ({
  username: "camera",
  displayName: "Camera phone",
  password: "secret",
  admin: false,
  enabled: true,
  groups,
  micGain: 1,
});
test("password hashing uses unique salts and rejects wrong passwords", () => {
  const a = hashPassword("secret"),
    b = hashPassword("secret");
  assert.notEqual(a, b);
  assert(!a.includes("secret"));
  assert(verifyPassword("secret", a));
  assert(!verifyPassword("wrong", a));
});
test("seed, user CRUD, unique usernames, admin invariant and sessions", () => {
  const s = new Store(":memory:");
  try {
    assert.equal(s.groups().length, 4);
    const admin = s.users()[0];
    assert(admin.defaultPassword);
    assert.throws(() => s.deleteUser(admin.id));
    assert.equal(s.login("admin", "incorrect"), undefined);
    const token = s.login("admin", "admin")!;
    assert.equal(s.session(token)?.id, admin.id);
    s.logout(token);
    assert.equal(s.session(token), undefined);
    const u = s.saveUser(undefined, userData());
    assert.throws(() => s.saveUser(undefined, userData()));
    assert.throws(() => s.saveUser(u.id, { ...u, micGain: 2 }));
    s.saveUser(u.id, { ...u, displayName: "Camera two" });
    assert.equal(s.user(u.id)?.displayName, "Camera two");
    assert(s.login("camera", "secret"));
    s.saveUser(u.id, { ...u, enabled: false });
    assert.equal(s.login("camera", "secret"), undefined);
    s.deleteUser(u.id);
    assert.equal(s.user(u.id), undefined);
    s.saveUser(admin.id, { ...admin, password: "new-password" });
    assert(!s.user(admin.id)?.defaultPassword);
  } finally {
    s.db.close();
  }
});
test("groups, membership and talk authorization", () => {
  const s = new Store(":memory:");
  try {
    const g = s.saveGroup(undefined, {
      name: "Special",
      color: "#123456",
      enabled: true,
    });
    const u = s.saveUser(undefined, userData([g.id]));
    assert.deepEqual(
      sanitizeState(u, s.groups(), [g.id, "unauthorized", g.id]),
      [g.id],
    );
    assert.throws(() => s.saveUser(u.id, { ...u, groups: ["missing"] }));
    s.saveGroup(g.id, { ...g, enabled: false });
    assert.deepEqual(sanitizeState(u, s.groups(), [g.id]), []);
    s.deleteGroup(g.id);
    assert.deepEqual(s.user(u.id)?.groups, []);
    assert(!s.groups().some((x) => x.id === g.id));
    assert.equal(routeVolume(["one", "two"], { one: 0.2, two: 0.7 }), 0.7);
    assert.equal(routeVolume(["unknown"], { one: 1 }), 0);
  } finally {
    s.db.close();
  }
});
test("SQLite persists configuration and sessions across restart without talk state", () => {
  const dir = mkdtempSync(join(tmpdir(), "mars-test-"));
  try {
    const path = join(dir, "mars.sqlite");
    let s = new Store(path);
    const g = s.groups()[0];
    const u = s.saveUser(undefined, userData([g.id]));
    const token = s.login("camera", "secret")!;
    s.db.close();
    s = new Store(path);
    assert.equal(s.user(u.id)?.micGain, 1);
    assert.equal(s.session(token)?.id, u.id);
    assert.equal(s.groups()[0].id, g.id);
    assert(!("talk" in s.user(u.id)!));
    s.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP authentication, admin permissions, CSRF origin and CRUD", async () => {
  const store = new Store(":memory:");
  const { server, signals } = createApp(store);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie = "",
    origin = base,
  ) =>
    fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: origin,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await request("/me")).status, 401);
    assert.equal(
      (
        await request(
          "/login",
          "POST",
          { username: "admin", password: "admin" },
          "",
          "https://evil.test",
        )
      ).status,
      403,
    );
    const login = await request("/login", "POST", {
      username: "admin",
      password: "admin",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert(cookie.includes("mars="));
    const g = store.groups()[0];
    const created = await request(
      "/admin/users",
      "POST",
      userData([g.id]),
      cookie,
    );
    assert.equal(created.status, 200);
    const u = await created.json();
    const normal = await request("/login", "POST", {
      username: "camera",
      password: "secret",
    });
    const normalCookie = normal.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await request("/admin/users", "GET", undefined, normalCookie)).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/admin/users/" + u.id,
          "PUT",
          { ...u, micGain: 1.4 },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(store.user(u.id)?.micGain, 1.4);
    assert.equal(
      (await request("/admin/users/" + u.id, "DELETE", undefined, cookie))
        .status,
      200,
    );
    assert.equal(
      (await request("/me", "GET", undefined, normalCookie)).status,
      401,
    );
  } finally {
    signals.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
  }
});
test("WebSocket strips unauthorized talk, clears presence and never restores latch", async () => {
  const store = new Store(":memory:");
  const group = store.groups()[0];
  const u = store.saveUser(undefined, userData([group.id]));
  const token = store.login(u.username, "secret")!;
  const { server, signals } = createApp(store);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const open = () =>
    new WebSocket(`ws://127.0.0.1:${port}/signal`, {
      origin: `http://127.0.0.1:${port}`,
      headers: { Cookie: "mars=" + token },
    });
  let ws = open();
  try {
    const initial = JSON.parse((await once(ws, "message"))[0].toString());
    assert.deepEqual(initial.peers, []);
    ws.send(
      JSON.stringify({
        type: "state",
        talk: [group.id, "forbidden"],
        listen: [group.id],
      }),
    );
    const state = JSON.parse((await once(ws, "message"))[0].toString());
    assert.equal(state.type, "snapshot");
    const observer = open();
    const observed = JSON.parse(
      (await once(observer, "message"))[0].toString(),
    );
    assert.deepEqual(observed.peers[0].talk, [group.id]);
    observer.close();
    await once(observer, "close");
    ws.close();
    await once(ws, "close");
    ws = open();
    const next = JSON.parse((await once(ws, "message"))[0].toString());
    assert.notEqual(initial.self, next.self);
    assert.deepEqual(next.peers, []);
    const other = open();
    const otherSnapshot = JSON.parse(
      (await once(other, "message"))[0].toString(),
    );
    assert.deepEqual(otherSnapshot.peers[0].talk, []);
    other.close();
    await once(other, "close");
  } finally {
    ws.terminate();
    signals.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
  }
});
