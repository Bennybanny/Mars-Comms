import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { z } from "zod";
import { Store } from "./store.js";
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
  z.object({
    type: z.literal("state"),
    talk: z.array(z.string()).max(100),
    listen: z.array(z.string()).max(100),
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
export function signaling(server: Server, store: Store) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const peers = new Map<
    string,
    { peer: Peer; ws: WebSocket; token: string; alive: boolean }
  >();
  let shuttingDown = false;
  server.on("upgrade", (req, socket, head) => {
    if (
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
        alive: true,
      };
      peers.set(id, entry);
      ws.on("pong", () => (entry.alive = true));
      ws.on("message", (raw) => {
        try {
          const m = messageSchema.parse(JSON.parse(raw.toString()));
          const current = store.session(token);
          if (!current) {
            ws.close(1008);
            return;
          }
          entry.peer.user = current;
          if (m.type === "state") {
            const talk = sanitizeState(current, store.groups(), m.talk),
              listen = sanitizeState(current, store.groups(), m.listen);
            const changed =
              JSON.stringify([talk, listen]) !==
              JSON.stringify([entry.peer.talk, entry.peer.listen]);
            entry.peer.talk = talk;
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
          ws.close(1008, "Invalid message");
        }
      });
      ws.on("close", () => {
        peers.delete(id);
        broadcast();
      });
      broadcast();
    });
  });
  function broadcast() {
    if (shuttingDown) return;
    for (const e of peers.values()) {
      // A client can reconnect before the old socket's close event runs.
      // Do not carry a closing socket or its latched talk into that snapshot.
      if (e.ws.readyState !== WebSocket.OPEN) {
        e.peer.talk = [];
        peers.delete(e.peer.id);
        continue;
      }
      const user = store.session(e.token);
      if (!user) {
        e.ws.close(1008);
        peers.delete(e.peer.id);
        continue;
      }
      e.peer.user = user;
      e.peer.talk = sanitizeState(user, store.groups(), e.peer.talk);
      e.peer.listen = sanitizeState(user, store.groups(), e.peer.listen);
    }
    for (const e of peers.values())
      if (e.ws.readyState === WebSocket.OPEN)
        e.ws.send(
          JSON.stringify({
            type: "snapshot",
            self: e.peer.id,
            user: e.peer.user,
            groups: allowedGroups(e.peer.user, store.groups()),
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
          }),
        );
  }
  const timer = setInterval(() => {
    for (const e of peers.values()) {
      if (!e.alive) {
        e.peer.talk = [];
        e.ws.terminate();
        continue;
      }
      e.alive = false;
      e.ws.ping();
    }
    broadcast();
  }, 5000);
  wss.on("close", () => clearInterval(timer));
  return {
    broadcast,
    close() {
      shuttingDown = true;
      clearInterval(timer);
      for (const e of peers.values()) {
        e.peer.talk = [];
      }
      for (const ws of wss.clients)
        ws.close(1001, "Mars Comms server stopping");
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          for (const ws of wss.clients) ws.terminate();
        }, 800);
        wss.close(() => {
          clearTimeout(timeout);
          peers.clear();
          resolve();
        });
      });
    },
  };
}
