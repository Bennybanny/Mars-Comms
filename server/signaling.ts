import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { z } from "zod";
import { Store } from "./store.js";
import { ControlSessions } from "./control.js";
import { CONTROL_PATH } from "../shared/control.js";
import {
  allowedGroups,
  relevant,
  sanitizeState,
  type Peer,
} from "../shared/types.js";
export function cookieToken(cookie = "") {
  return (
    cookie
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("mars="))
      ?.slice(5) ?? ""
  );
}
export const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat") }),
  z.object({
    type: z.literal("state"),
    talk: z.array(z.string()).max(100),
    listen: z.array(z.string()).max(100),
    mediaReady: z.boolean().optional().default(false),
  }),
  z.object({
    type: z.literal("signal"),
    to: z.string(),
    description: z
      .object({
        type: z.enum(["offer", "answer"]),
        sdp: z.string().max(100000),
      })
      .optional(),
    candidate: z
      .object({
        candidate: z.string().max(4000).optional(),
        sdpMid: z.string().nullable().optional(),
        sdpMLineIndex: z.number().nullable().optional(),
        usernameFragment: z.string().nullable().optional(),
      })
      .optional(),
  }),
]);
export const HEARTBEAT_INTERVAL_MS = 1000;
export const PEER_TIMEOUT_MS = 5000;
export function signaling(server: Server, store: Store) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const peers = new Map<
    string,
    {
      peer: Peer;
      ws: WebSocket;
      token: string;
      lastPong: number;
      lastActivity: number;
      browserTalk: string[];
      mediaReady: boolean;
    }
  >();
  let shuttingDown = false;
  const controls = new ControlSessions(
    store,
    () =>
      [...peers.values()].map((entry) => ({
        id: entry.peer.id,
        userId: entry.peer.user.id,
        mediaReady: entry.mediaReady,
      })),
    () => broadcast(),
  );
  // Remove runtime ownership before touching the transport. A close handshake
  // can stall, and late message/pong/close events must not resurrect this peer.
  function removePeer(
    id: string,
    reason: string,
    transport: "close" | "terminate" | "none" = "close",
    notify = true,
  ) {
    const entry = peers.get(id);
    if (!entry) return;
    peers.delete(id);
    controls.removeTarget(id);
    entry.peer.talk = [];
    entry.peer.listen = [];
    if (transport === "terminate") entry.ws.terminate();
    else if (transport === "close") entry.ws.close(1008, reason);
    if (notify) broadcast();
  }
  server.on("upgrade", (req, socket, head) => {
    if (!shuttingDown && req.url === CONTROL_PATH) {
      controls.upgrade(req, socket, head);
      return;
    }
    if (
      shuttingDown ||
      req.url !== "/signal" ||
      req.headers.origin !==
        `${"encrypted" in req.socket ? "https" : "http"}://${req.headers.host}`
    ) {
      socket.destroy();
      return;
    }
    const token = cookieToken(req.headers.cookie);
    const user = store.session(token);
    if (!user) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const id = randomUUID();
      const entry = {
        peer: { id, user, talk: [], listen: [] } as Peer,
        ws,
        token,
        lastPong: performance.now(),
        lastActivity: performance.now(),
        browserTalk: [] as string[],
        mediaReady: false,
      };
      peers.set(id, entry);
      ws.on("pong", () => {
        if (peers.get(id) === entry) entry.lastPong = performance.now();
      });
      ws.on("message", (raw) => {
        if (peers.get(id) !== entry) return;
        try {
          const m = messageSchema.parse(JSON.parse(raw.toString()));
          const current = store.session(token);
          if (!current) {
            removePeer(id, "Session invalid");
            return;
          }
          entry.peer.user = current;
          entry.lastActivity = performance.now();
          if (m.type === "heartbeat") return;
          if (m.type === "state") {
            const talk = sanitizeState(current, store.groups(), m.talk),
              listen = sanitizeState(current, store.groups(), m.listen);
            const changed =
              JSON.stringify([talk, listen]) !==
                JSON.stringify([entry.browserTalk, entry.peer.listen]) ||
              entry.mediaReady !== m.mediaReady;
            entry.browserTalk = talk;
            entry.mediaReady = m.mediaReady;
            if (!entry.mediaReady) controls.removeTarget(id);
            entry.peer.listen = listen;
            if (changed) broadcast();
          } else {
            const target = peers.get(m.to);
            if (
              target &&
              target.ws.readyState === WebSocket.OPEN &&
              relevant(entry.peer, target.peer)
            )
              target.ws.send(JSON.stringify({ ...m, from: id, to: undefined }));
          }
        } catch {
          removePeer(id, "Invalid message");
        }
      });
      ws.on("close", () => {
        removePeer(id, "Connection closed", "none");
      });
      ws.on("error", () => removePeer(id, "Connection error", "terminate"));
      broadcast();
    });
  });
  function broadcast() {
    if (shuttingDown) return;
    const now = performance.now();
    const groups = store.groups();
    for (const e of peers.values()) {
      // A client can reconnect before the old socket's close event runs.
      // Do not carry a closing socket or its latched talk into that snapshot.
      if (e.ws.readyState !== WebSocket.OPEN) {
        removePeer(e.peer.id, "Connection closing", "none", false);
        continue;
      }
      if (
        now - e.lastPong >= PEER_TIMEOUT_MS ||
        now - e.lastActivity >= PEER_TIMEOUT_MS
      ) {
        removePeer(e.peer.id, "Heartbeat timeout", "terminate", false);
        continue;
      }
      const user = store.session(e.token);
      if (!user) {
        removePeer(e.peer.id, "Session invalid", "close", false);
        continue;
      }
      e.peer.user = user;
      e.browserTalk = sanitizeState(user, groups, e.browserTalk);
      e.peer.listen = sanitizeState(user, groups, e.peer.listen);
    }
    controls.reconcile(now);
    for (const e of peers.values())
      e.peer.talk = sanitizeState(e.peer.user, groups, [
        ...e.browserTalk,
        ...controls.holdsFor(e.peer.id),
      ]);
    for (const e of peers.values())
      if (e.ws.readyState === WebSocket.OPEN)
        e.ws.send(
          JSON.stringify({
            type: "snapshot",
            self: e.peer.id,
            user: e.peer.user,
            groups: allowedGroups(e.peer.user, groups),
            peers: [...peers.values()]
              .map((x) => x.peer)
              .filter((p) => p.id !== e.peer.id && relevant(e.peer, p))
              .map((p) => ({
                ...p,
                user: {
                  ...p.user,
                  username: "",
                  admin: false,
                  groups: p.user.groups.filter((g) =>
                    e.peer.user.groups.includes(g),
                  ),
                },
                talk: p.talk.filter((g) => e.peer.user.groups.includes(g)),
                listen: p.listen.filter((g) => e.peer.user.groups.includes(g)),
              })),
            externalTalk: controls.holdsFor(e.peer.id),
          }),
        );
    controls.publish();
  }
  const timer = setInterval(() => {
    // Reconcile and publish removals in this tick, without waiting for close.
    broadcast();
    controls.ping();
    for (const e of peers.values()) {
      e.ws.ping(undefined, undefined, (error) => {
        if (error) removePeer(e.peer.id, "Ping failed", "terminate");
      });
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on("close", () => clearInterval(timer));
  return {
    broadcast,
    close() {
      shuttingDown = true;
      clearInterval(timer);
      const controlsClosed = controls.close();
      for (const id of peers.keys())
        removePeer(id, "Server stopping", "none", false);
      for (const ws of wss.clients)
        ws.close(1001, "Mars Comms server stopping");
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          for (const ws of wss.clients) ws.terminate();
        }, 800);
        wss.close(() => {
          clearTimeout(timeout);
          peers.clear();
          void controlsClosed.then(resolve);
        });
      });
    },
  };
}
