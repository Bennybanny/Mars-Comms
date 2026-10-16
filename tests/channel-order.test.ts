import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { allowedGroups } from "../shared/types.js";
import { orderedGroups } from "../shared/channel-order.js";
const data = (groups: string[]) => ({
  username: "crew",
  displayName: "Crew",
  password: "secret",
  admin: false,
  enabled: true,
  groups,
  micGain: 1,
});
test("channel order persists across database/session restart, with separate users and stable IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "mars-order-")),
    path = join(dir, "mars.sqlite");
  let s = new Store(path);
  try {
    const groups = s.groups(),
      ids = groups.map((g) => g.id),
      user = s.saveUser(undefined, data(ids.slice(0, 3)));
    assert.deepEqual(s.channelOrder(user.id), { groupIds: [], revision: 0 });
    const order = [ids[2], ids[0], ids[1]];
    s.saveChannelOrder(user.id, { groupIds: order });
    const token = s.login(user.username, "secret")!;
    s.logout(token);
    s.db.close();
    s = new Store(path);
    assert(s.login(user.username, "secret"));
    assert.deepEqual(s.channelOrder(user.id).groupIds, order);
    assert.deepEqual(
      s.channelOrder(s.users().find((u) => u.admin)!.id).groupIds,
      [],
    );
    s.saveGroup(ids[0], { ...groups[0], name: "Cameras", color: "#eab308" });
    assert.deepEqual(
      orderedGroups(
        allowedGroups(user, s.groups()),
        s.channelOrder(user.id).groupIds,
      ).map((g) => g.id),
      order,
    );
    s.saveUser(user.id, { ...user, groups: ids });
    s.saveGroup(ids[1], { ...groups[1], enabled: false });
    assert.deepEqual(
      orderedGroups(
        allowedGroups(s.user(user.id)!, s.groups()),
        s.channelOrder(user.id).groupIds,
      ).map((g) => g.id),
      [ids[2], ids[0], ids[3]],
    );
    s.saveGroup(ids[1], groups[1]);
    assert.deepEqual(
      orderedGroups(
        allowedGroups(s.user(user.id)!, s.groups()),
        s.channelOrder(user.id).groupIds,
      ).map((g) => g.id),
      [...order, ids[3]],
    );
    s.saveUser(user.id, { ...user, groups: [ids[1], ids[2]] });
    assert.deepEqual(
      orderedGroups(
        allowedGroups(s.user(user.id)!, s.groups()),
        s.channelOrder(user.id).groupIds,
      ).map((g) => g.id),
      [ids[2], ids[1]],
    );
    s.saveChannelOrder(user.id, { groupIds: [ids[1], ids[2]] });
    s.saveUser(user.id, { ...user, groups: ids.slice(0, 3) });
    assert.deepEqual(
      orderedGroups(
        allowedGroups(s.user(user.id)!, s.groups()),
        s.channelOrder(user.id).groupIds,
      ).map((g) => g.id),
      [ids[1], ids[0], ids[2]],
    );
    s.deleteGroup(ids[0]);
    assert(!s.channelOrder(user.id).groupIds.includes(ids[0]));
    assert.equal(
      orderedGroups(
        allowedGroups(s.user(user.id)!, s.groups()),
        s.channelOrder(user.id).groupIds,
      ).length,
      2,
    );
    s.deleteUser(user.id);
    assert.equal(
      s.db
        .prepare("SELECT * FROM user_channel_order WHERE userId=?")
        .get(user.id),
      undefined,
    );
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("own authenticated order API validates payload and synchronizes same-user snapshots only", async () => {
  const store = new Store(":memory:"),
    ids = store.groups().map((g) => g.id),
    user = store.saveUser(undefined, data(ids.slice(0, 3))),
    token = store.login(user.username, "secret")!,
    adminToken = store.login("admin", "admin")!;
  const { server, signals } = createApp(store);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    path = base + "/api/me/channel-order",
    sockets: WebSocket[] = [];
  const request = (body: unknown, cookie = token, origin = base) =>
    fetch(path, {
      method: "PUT",
      headers: {
        Cookie: "mars=" + cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  async function browser(cookie: string) {
    const ws = new WebSocket(base.replace("http", "ws") + "/signal", {
      origin: base,
      headers: { Cookie: "mars=" + cookie },
    });
    sockets.push(ws);
    const client = { ws, latest: undefined as any };
    ws.on("message", (r) => {
      const m = JSON.parse(r.toString());
      if (m.type === "snapshot") client.latest = m;
    });
    await once(ws, "open");
    return client;
  }
  async function until(check: () => boolean) {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("Snapshot deadline");
  }
  try {
    assert.equal((await fetch(path)).status, 401);
    assert.equal((await request({ groupIds: [] }, "invalid")).status, 401);
    assert.equal(
      (await request({ groupIds: [] }, token, "https://evil.example")).status,
      403,
    );
    for (const body of [
      { groupIds: [ids[0], ids[0]] },
      { groupIds: ["bad"] },
      { groupIds: [ids[3]] },
      { groupIds: ["00000000-0000-4000-8000-000000000000"] },
      { groupIds: "bad" },
      { groupIds: Array(101).fill(ids[0]) },
      { groupIds: [], userId: store.users()[0].id },
    ])
      assert.equal((await request(body)).status, 400);
    const a = await browser(token),
      b = await browser(token),
      other = await browser(adminToken);
    await until(() => !!a.latest && !!b.latest && !!other.latest);
    const initialGlobal = store.groups().map((g) => g.id),
      order = [ids[2], ids[0], ids[1]];
    const response = await request({ groupIds: order });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.revision, 1);
    await until(
      () =>
        a.latest.channelOrder.revision === 1 &&
        b.latest.channelOrder.revision === 1,
    );
    assert.deepEqual(a.latest.channelOrder.groupIds, order);
    assert.deepEqual(b.latest.channelOrder.groupIds, order);
    assert.deepEqual(other.latest.channelOrder.groupIds, []);
    assert.deepEqual(
      store.groups().map((g) => g.id),
      initialGlobal,
    );
    assert.deepEqual(
      await fetch(path, { headers: { Cookie: "mars=" + token } }).then((r) =>
        r.json(),
      ),
      saved,
    );
    assert.equal(
      (await request({ groupIds: order }).then((r) => r.json())).revision,
      1,
    ); // no-op is idempotent
    await request({ groupIds: [ids[1], ids[2], ids[0]] });
    assert.equal(store.channelOrder(user.id).revision, 2); // last accepted wins
    store.deleteGroup(ids[0]);
    assert.equal((await request({ groupIds: [ids[0]] })).status, 400);
  } finally {
    sockets.forEach((ws) => ws.terminate());
    await signals.close();
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
  }
});
