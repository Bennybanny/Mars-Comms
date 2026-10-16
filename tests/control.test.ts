import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import type {
  ControlServerMessage,
  ControlSnapshot,
} from "../shared/control.js";
async function until(check: () => boolean, timeout = 2000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    assert(performance.now() < deadline, "Control state deadline exceeded");
    await delay(10);
  }
}
async function fixture() {
  const store = new Store(":memory:");
  const groups = store.groups();
  const user = store.saveUser(undefined, {
    username: "operator",
    displayName: "FOH",
    password: "test-password",
    enabled: true,
    admin: false,
    groups: groups.slice(0, 2).map((g) => g.id),
    micGain: 1,
  });
  const session = store.login(user.username, "test-password")!;
  const admin = store.login("admin", "admin")!;
  const key = store.createControlCredential(user.id, "FOH Companion");
  const { server, signals } = createApp(store);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sockets: WebSocket[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  async function browser(token = session, ready = true) {
    const ws = new WebSocket(base.replace("http", "ws") + "/signal", {
      origin: base,
      headers: { Cookie: "mars=" + token },
    });
    sockets.push(ws);
    const client = { ws, latest: undefined as any };
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "snapshot") client.latest = message;
    });
    await until(() => !!client.latest);
    ws.send(
      JSON.stringify({
        type: "state",
        talk: [],
        listen: user.groups,
        mediaReady: ready,
      }),
    );
    timers.push(
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "heartbeat" }));
      }, 1000),
    );
    await delay(20);
    return client;
  }
  const observer = await browser(admin, false);
  async function control(token = key.token, heartbeat = true, autoPong = true) {
    const ws = new WebSocket(base.replace("http", "ws") + "/api/control/v1", {
      autoPong,
    });
    sockets.push(ws);
    const client = {
      ws,
      latest: undefined as ControlSnapshot | undefined,
      messages: [] as ControlServerMessage[],
    };
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      client.messages.push(message);
      if (message.type === "snapshot") client.latest = message;
    });
    await once(ws, "open");
    ws.send(JSON.stringify({ v: 1, type: "authenticate", token }));
    await until(() => client.messages.length > 0);
    if (heartbeat)
      timers.push(
        setInterval(() => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ v: 1, type: "heartbeat" }));
        }, 1000),
      );
    return client;
  }
  function state(
    client: Awaited<ReturnType<typeof browser>>,
    talk: string[],
    ready = true,
  ) {
    client.ws.send(
      JSON.stringify({
        type: "state",
        talk,
        listen: user.groups,
        mediaReady: ready,
      }),
    );
  }
  async function ptt(
    client: Awaited<ReturnType<typeof control>>,
    start: boolean,
    groupId = groups[0].id,
  ) {
    const requestId = String(client.messages.length);
    client.ws.send(
      JSON.stringify({
        v: 1,
        type: start ? "ptt-start" : "ptt-stop",
        groupId,
        requestId,
      }),
    );
    await until(() =>
      client.messages.some(
        (m) => "requestId" in m && m.requestId === requestId,
      ),
    );
    return client.messages.find(
      (m) => "requestId" in m && m.requestId === requestId,
    )!;
  }
  const observed = (peerId: string) =>
    observer.latest.peers.find((peer: any) => peer.id === peerId);
  async function close() {
    timers.forEach(clearInterval);
    sockets.forEach((ws) => ws.terminate());
    await signals.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
  }
  return {
    store,
    user,
    groups,
    session,
    admin,
    key,
    base,
    signals,
    observer,
    browser,
    control,
    state,
    ptt,
    observed,
    close,
  };
}

for (const reason of ["revoked", "disabled"] as const) {
  test(`${reason} credentials cannot authenticate a new control connection`, async () => {
    const f = await fixture();
    try {
      if (reason === "revoked")
        f.store.revokeControlCredential(f.user.id, f.key.credential.id);
      else f.store.saveUser(f.user.id, { ...f.user, enabled: false });
      const client = await f.control();
      assert(
        client.messages.some(
          (m) => m.type === "error" && m.code === "authentication-failed",
        ),
      );
    } finally {
      await f.close();
    }
  });
}

test("membership removal clears only unauthorized held groups", async () => {
  const f = await fixture();
  try {
    const media = await f.browser(),
      control = await f.control();
    await f.ptt(control, true, f.groups[0].id);
    await f.ptt(control, true, f.groups[1].id);
    await until(() => control.latest?.holds.length === 2);
    f.store.saveUser(f.user.id, { ...f.user, groups: [f.groups[1].id] });
    f.signals.broadcast();
    await until(() => control.latest?.holds.length === 1);
    assert.deepEqual(control.latest!.holds, [f.groups[1].id]);
    assert.deepEqual(f.observed(media.latest.self).talk, [f.groups[1].id]);
  } finally {
    await f.close();
  }
});

test("control credentials are hashed, metadata-only, rotated and admin-protected", async () => {
  const f = await fixture();
  try {
    const path = f.base + `/api/admin/users/${f.user.id}/control-credentials`;
    assert.equal(
      (await fetch(path, { headers: { Cookie: "mars=" + f.session } })).status,
      403,
    );
    const result = await fetch(path, {
      method: "POST",
      headers: {
        Cookie: "mars=" + f.admin,
        Origin: f.base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Replacement" }),
    });
    assert.equal(result.status, 200);
    const created = await result.json();
    assert(/^mc_[A-Za-z0-9_-]{43}$/.test(created.token));
    const rows = f.store.db
      .prepare("SELECT tokenHash FROM control_credentials")
      .all() as { tokenHash: string }[];
    assert(rows.every((row) => /^[0-9a-f]{64}$/.test(row.tokenHash)));
    const metadata = await fetch(path, {
      headers: { Cookie: "mars=" + f.admin },
    }).then((res) => res.json());
    assert(metadata.every((row: any) => !row.tokenHash && !row.token));
    assert(!f.store.authenticateControl(f.key.token));
    assert(f.store.authenticateControl(created.token));
    const revoked = await fetch(path + "/" + created.credential.id, {
      method: "DELETE",
      headers: { Cookie: "mars=" + f.admin, Origin: f.base },
    });
    assert.equal(revoked.status, 200);
    assert(!f.store.authenticateControl(created.token));
  } finally {
    await f.close();
  }
});

test("authentication, group discovery and unauthorized identity/group rejection", async () => {
  const f = await fixture();
  try {
    const invalid = await f.control("invalid");
    assert(
      invalid.messages.some(
        (m) => m.type === "error" && m.code === "authentication-failed",
      ),
    );
    const client = await f.control();
    await until(() => !!client.latest);
    assert.equal(client.latest!.operator.id, f.user.id);
    assert.deepEqual(
      client.latest!.groups.map((g) => g.id),
      f.user.groups,
    );
    assert.deepEqual(client.latest!.holds, []);
    assert.equal((await f.ptt(client, true, f.groups[2].id)).type, "error");
    assert.equal((await f.ptt(client, false, f.groups[2].id)).type, "error");
    f.store.saveGroup(f.groups[0].id, { ...f.groups[0], name: "Cameras" });
    f.signals.broadcast();
    await until(() =>
      client.latest!.groups.some(
        (g) => g.id === f.groups[0].id && g.name === "Cameras",
      ),
    );
    client.ws.send(
      JSON.stringify({
        v: 1,
        type: "ptt-start",
        groupId: f.groups[0].id,
        userId: "another-user",
      }),
    );
    await until(() => client.ws.readyState !== WebSocket.OPEN);
  } finally {
    await f.close();
  }
});

test("no media and ambiguous media fail closed; exactly one target accepts explicit down/up", async () => {
  const f = await fixture();
  try {
    const control = await f.control();
    assert.equal(((await f.ptt(control, true)) as any).code, "no-media");
    const a = await f.browser();
    const b = await f.browser();
    assert.equal(((await f.ptt(control, true)) as any).code, "ambiguous-media");
    f.state(b, [], false);
    await delay(30);
    assert.equal((await f.ptt(control, true)).type, "ack");
    await until(() => f.observed(a.latest.self)?.talk.includes(f.groups[0].id));
    assert.deepEqual(a.latest.externalTalk, [f.groups[0].id]);
    assert.equal((await f.ptt(control, false)).type, "ack");
    await until(() => f.observed(a.latest.self)?.talk.length === 0);
  } finally {
    await f.close();
  }
});

test("browser and two controller sources release only their own holds", async () => {
  const f = await fixture();
  try {
    const media = await f.browser(),
      a = await f.control(),
      b = await f.control();
    await f.ptt(a, true);
    await f.ptt(b, true);
    f.state(media, [f.groups[0].id]);
    await delay(30);
    await f.ptt(a, false);
    await f.ptt(b, false);
    await until(() =>
      f.observed(media.latest.self)?.talk.includes(f.groups[0].id),
    );
    await f.ptt(a, true);
    f.state(media, []);
    await delay(30);
    assert(f.observed(media.latest.self).talk.includes(f.groups[0].id));
    a.ws.terminate();
    await until(() => f.observed(media.latest.self)?.talk.length === 0);
    const fresh = await f.control();
    await until(() => !!fresh.latest);
    assert.deepEqual(fresh.latest!.holds, []);
  } finally {
    await f.close();
  }
});

for (const reason of [
  "revoke",
  "disable",
  "membership",
  "browser-loss",
  "not-ready",
  "second-media",
  "group-disable",
] as const) {
  test(`active external PTT is cleared on ${reason}`, async () => {
    const f = await fixture();
    try {
      const media = await f.browser(),
        control = await f.control();
      await f.ptt(control, true);
      await until(() => f.observed(media.latest.self)?.talk.length === 1);
      if (reason === "revoke")
        f.store.revokeControlCredential(f.user.id, f.key.credential.id);
      if (reason === "disable")
        f.store.saveUser(f.user.id, { ...f.user, enabled: false });
      if (reason === "membership")
        f.store.saveUser(f.user.id, { ...f.user, groups: [f.groups[1].id] });
      if (reason === "group-disable")
        f.store.saveGroup(f.groups[0].id, { ...f.groups[0], enabled: false });
      if (reason === "browser-loss") media.ws.terminate();
      if (reason === "not-ready") f.state(media, [], false);
      if (reason === "second-media") await f.browser();
      f.signals.broadcast();
      await until(() => !f.observed(media.latest.self)?.talk.length);
      if (reason !== "disable" && reason !== "revoke")
        await until(() => control.latest?.holds.length === 0);
    } finally {
      await f.close();
    }
  });
}

for (const [heartbeat, autoPong] of [
  [false, true],
  [true, false],
]) {
  test(
    `dead controller cleanup without final OFF (application heartbeat=${heartbeat})`,
    { timeout: 12000 },
    async () => {
      const f = await fixture();
      try {
        const media = await f.browser(),
          control = await f.control(f.key.token, heartbeat, autoPong);
        await f.ptt(control, true);
        await until(() => f.observed(media.latest.self)?.talk.length === 1);
        await until(
          () => f.observed(media.latest.self)?.talk.length === 0,
          7000,
        );
        assert.equal(media.ws.readyState, WebSocket.OPEN);
      } finally {
        await f.close();
      }
    },
  );
}
