import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { Store } from "../server/store.js";
import { HEARTBEAT_INTERVAL_MS, PEER_TIMEOUT_MS } from "../server/signaling.js";
import type { ServerMessage } from "../shared/types.js";

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;
async function until(check: () => boolean, timeout = 2000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    assert(
      performance.now() < deadline,
      "Expected corrected server snapshot before deadline",
    );
    await delay(10);
  }
}
async function fixture() {
  const store = new Store(":memory:");
  const groups = store
    .groups()
    .slice(0, 2)
    .map((g) => g.id);
  const user = store.saveUser(undefined, {
    username: "phone",
    displayName: "Phone",
    password: "test-password",
    admin: false,
    enabled: true,
    groups,
    micGain: 1,
  });
  const token = store.login("phone", "test-password")!;
  const adminToken = store.login("admin", "admin")!;
  const { server, signals } = createApp(store);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sockets: WebSocket[] = [];
  const heartbeats: ReturnType<typeof setInterval>[] = [];
  async function connect(
    session = token,
    autoPong = true,
    applicationAlive = true,
  ) {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/signal", {
      origin: base,
      headers: { Cookie: "mars=" + session },
      autoPong,
    });
    sockets.push(ws);
    const client = {
      ws,
      snapshot: undefined as Snapshot | undefined,
      messages: [] as ServerMessage[],
    };
    ws.on("message", (raw) => {
      const message: ServerMessage = JSON.parse(raw.toString());
      client.messages.push(message);
      if (message.type === "snapshot") client.snapshot = message;
    });
    await until(() => !!client.snapshot);
    if (applicationAlive)
      heartbeats.push(
        setInterval(() => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "heartbeat" }));
        }, 2000),
      );
    return client;
  }
  const observer = await connect(adminToken);
  async function talking(
    client: Awaited<ReturnType<typeof connect>>,
    talk = groups,
  ) {
    client.ws.send(JSON.stringify({ type: "state", talk, listen: groups }));
    await until(() =>
      observer.snapshot!.peers.some(
        (p) =>
          p.id === client.snapshot!.self &&
          JSON.stringify(p.talk) === JSON.stringify(talk),
      ),
    );
    return client.snapshot!.self;
  }
  const missing = (id: string) =>
    !observer.snapshot!.peers.some((p) => p.id === id);
  async function admin(path: string, method: string, body?: unknown) {
    const response = await fetch(base + "/api/admin/" + path, {
      method,
      headers: {
        Cookie: "mars=" + adminToken,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, 200);
  }
  async function close() {
    heartbeats.forEach(clearInterval);
    for (const ws of sockets) ws.terminate();
    await signals.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
  }
  return {
    store,
    signals,
    user,
    token,
    groups,
    observer,
    connect,
    talking,
    missing,
    admin,
    close,
  };
}

for (const [name, groupCount] of [
  ["clean PTT disconnect", 1],
  ["latched single-group disconnect", 1],
  ["latched multi-group disconnect", 2],
] as const) {
  test(
    name +
      " removes presence and every talk/listen group from observer snapshots",
    async () => {
      const f = await fixture();
      try {
        const phone = await f.connect();
        const id = await f.talking(phone, f.groups.slice(0, groupCount));
        phone.ws.close(); // No final state/talking=false message.
        await until(() => f.missing(id));
        assert.equal(f.observer.ws.readyState, WebSocket.OPEN);
        assert(f.store.user(f.user.id)); // Persisted configuration survives.
      } finally {
        await f.close();
      }
    },
  );
}

test(
  "silent dead peer times out without close or final state; live same-user peer survives",
  { timeout: 12000 },
  async () => {
    const f = await fixture();
    try {
      const phone = await f.connect(f.token, false); // Real socket, no pong replies.
      const laptop = await f.connect(); // Same user AND same session token.
      const id = await f.talking(phone);
      const laptopId = await f.talking(laptop, [f.groups[1]]);
      const before = performance.now();
      assert.equal(phone.ws.readyState, WebSocket.OPEN);
      await until(
        () => f.missing(id),
        PEER_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS + 1000,
      );
      assert(
        performance.now() - before <
          PEER_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS + 1000,
      );
      const survivor = f.observer.snapshot!.peers.find(
        (p) => p.id === laptopId,
      )!;
      assert.deepEqual(survivor.talk, [f.groups[1]]);
      assert.deepEqual(survivor.listen, f.groups);
      assert.equal(laptop.ws.readyState, WebSocket.OPEN);
      const returned = await f.connect();
      await until(() =>
        f.observer.snapshot!.peers.some(
          (p) => p.id === returned.snapshot!.self,
        ),
      );
      assert.notEqual(returned.snapshot!.self, id);
      const fresh = f.observer.snapshot!.peers.find(
        (p) => p.id === returned.snapshot!.self,
      )!;
      assert.deepEqual(fresh.talk, []);
      assert.deepEqual(fresh.listen, []);
    } finally {
      await f.close();
    }
  },
);

test(
  "browser transport answering pings cannot keep a frozen application's latch alive",
  { timeout: 12000 },
  async () => {
    const f = await fixture();
    try {
      const phone = await f.connect(f.token, true, false);
      let pings = 0;
      phone.ws.on("ping", () => pings++);
      const id = await f.talking(phone);
      await until(
        () => f.missing(id),
        PEER_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS + 1000,
      );
      assert(
        pings >= 3,
        "Transport remained responsive during application silence",
      );
      assert.equal(f.observer.ws.readyState, WebSocket.OPEN);
    } finally {
      await f.close();
    }
  },
);

test("server rejection clears talk immediately even when close handshake stalls; late frames cannot revive it", async () => {
  const f = await fixture();
  try {
    const phone = await f.connect();
    const id = await f.talking(phone);
    phone.ws.pause(); // Cannot read/respond to the server close handshake.
    phone.ws.send(JSON.stringify({ type: "invalid" }));
    await until(() => f.missing(id), 750);
    phone.ws.send(
      JSON.stringify({ type: "state", talk: f.groups, listen: f.groups }),
    );
    phone.ws.send(
      JSON.stringify({
        type: "signal",
        to: f.observer.snapshot!.self,
        candidate: { candidate: "late" },
      }),
    );
    phone.ws.pong();
    await delay(100);
    assert(f.missing(id));
    assert(
      !f.observer.messages.some((m) => m.type === "signal" && m.from === id),
    );
  } finally {
    await f.close();
  }
});

for (const action of [
  "disable user",
  "delete user",
  "logout",
  "expire session",
  "remove membership",
  "disable group",
  "delete group",
] as const) {
  test(
    action + " invalidates active talk and broadcasts corrected authorization",
    async () => {
      const f = await fixture();
      try {
        const phone = await f.connect();
        const id = await f.talking(phone);
        if (action === "disable user")
          await f.admin("users/" + f.user.id, "PUT", {
            ...f.user,
            enabled: false,
          });
        if (action === "delete user")
          await f.admin("users/" + f.user.id, "DELETE");
        if (action === "remove membership")
          await f.admin("users/" + f.user.id, "PUT", {
            ...f.user,
            groups: [f.groups[1]],
          });
        if (action === "disable group") {
          const group = f.store.groups().find((g) => g.id === f.groups[0])!;
          await f.admin("groups/" + group.id, "PUT", {
            ...group,
            enabled: false,
          });
        }
        if (action === "delete group")
          await f.admin("groups/" + f.groups[0], "DELETE");
        if (action === "logout") {
          f.store.logout(f.token);
          f.signals.broadcast();
        }
        if (action === "expire session")
          f.store.db
            .prepare("UPDATE sessions SET expires=0 WHERE token=?")
            .run(f.token);
        if (
          ["remove membership", "disable group", "delete group"].includes(
            action,
          )
        ) {
          await until(() => {
            const peer = f.observer.snapshot!.peers.find((p) => p.id === id);
            return !!peer && peer.talk.length === 1 && peer.listen.length === 1;
          });
          const peer = f.observer.snapshot!.peers.find((p) => p.id === id)!;
          assert.deepEqual(peer.talk, [f.groups[1]]);
          assert.deepEqual(peer.listen, [f.groups[1]]);
          assert.equal(phone.ws.readyState, WebSocket.OPEN);
        } else await until(() => f.missing(id));
      } finally {
        await f.close();
      }
    },
  );
}
