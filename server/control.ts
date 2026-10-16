import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { Store } from "./store.js";
import { allowedGroups, sanitizeState } from "../shared/types.js";
import type {
  ControlServerMessage,
  ControlSnapshot,
} from "../shared/control.js";
const schema = z.discriminatedUnion("type", [
  z
    .object({
      v: z.literal(1),
      type: z.literal("authenticate"),
      token: z.string().max(128),
    })
    .strict(),
  z.object({ v: z.literal(1), type: z.literal("heartbeat") }).strict(),
  z
    .object({
      v: z.literal(1),
      type: z.enum(["ptt-start", "ptt-stop"]),
      groupId: z.string().min(1).max(100),
      requestId: z.string().max(100).optional(),
    })
    .strict(),
]);
type Session = {
  id: string;
  ws: WebSocket;
  credentialId?: string;
  holds: Set<string>;
  target?: string;
  lastActivity: number;
  lastPong: number;
};
export type ControlTarget = { id: string; userId: string; mediaReady: boolean };
export class ControlSessions {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private sessions = new Map<string, Session>();
  constructor(
    private store: Store,
    private targets: () => ControlTarget[],
    private changed: () => void,
  ) {}
  private send(session: Session, message: ControlServerMessage) {
    if (session.ws.readyState === WebSocket.OPEN)
      session.ws.send(JSON.stringify(message));
  }
  private remove(id: string, reason: string, notify = true) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.holds.clear();
    session.target = undefined;
    // Drop ownership first; do not depend on a close handshake completing.
    session.ws.close(1008, reason);
    const deadline = setTimeout(() => session.ws.terminate(), 800);
    deadline.unref();
    session.ws.once("close", () => clearTimeout(deadline));
    if (session.credentialId)
      console.info(`Control session removed: ${id} (${reason}); PTT cleared`);
    if (notify) this.changed();
  }
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const expected = `${"encrypted" in req.socket ? "https" : "http"}://${req.headers.host}`;
    if (
      this.sessions.size >= 64 ||
      (req.headers.origin && req.headers.origin !== expected)
    ) {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const session: Session = {
        id: randomUUID(),
        ws,
        holds: new Set(),
        lastActivity: performance.now(),
        lastPong: performance.now(),
      };
      this.sessions.set(session.id, session);
      ws.on("pong", () => {
        if (this.sessions.has(session.id)) session.lastPong = performance.now();
      });
      ws.on("close", () => this.remove(session.id, "connection closed"));
      ws.on("error", () => this.remove(session.id, "connection error"));
      ws.on("message", (raw) => {
        if (!this.sessions.has(session.id)) return;
        const parsed = schema.safeParse(
          (() => {
            try {
              return JSON.parse(raw.toString());
            } catch {
              return null;
            }
          })(),
        );
        if (!parsed.success) {
          this.send(session, {
            v: 1,
            type: "error",
            code: "invalid-message",
            message: "Invalid Control API v1 message",
          });
          this.remove(session.id, "invalid message");
          return;
        }
        const message = parsed.data;
        if (!session.credentialId) {
          const identity =
            message.type === "authenticate"
              ? this.store.authenticateControl(message.token)
              : undefined;
          if (!identity) {
            this.send(session, {
              v: 1,
              type: "error",
              code: "authentication-failed",
              message: "Control authentication failed",
            });
            this.remove(session.id, "authentication failed");
            return;
          }
          session.credentialId = identity.credential.id;
          session.lastActivity = performance.now();
          console.info(`Control session authenticated: ${session.id}`);
          this.send(session, {
            v: 1,
            type: "authenticated",
            sessionId: session.id,
          });
          this.changed();
          return;
        }
        if (!this.store.controlIdentity(session.credentialId)) {
          this.remove(session.id, "credential or user invalid");
          return;
        }
        session.lastActivity = performance.now();
        if (message.type === "authenticate") {
          this.remove(session.id, "repeated authentication");
          return;
        }
        if (message.type === "heartbeat") return;
        // Reuse the authoritative browser reconciliation before selecting media.
        this.changed();
        this.reconcile(performance.now());
        if (!this.sessions.has(session.id)) {
          this.changed();
          return;
        }
        const identity = this.store.controlIdentity(session.credentialId)!;
        const allowed = allowedGroups(identity.user, this.store.groups());
        const candidates = this.targets().filter(
          (p) => p.userId === identity.user.id && p.mediaReady,
        );
        if (
          !allowed.some((g) => g.id === message.groupId) ||
          (message.type === "ptt-start" && candidates.length !== 1)
        ) {
          this.send(session, {
            v: 1,
            type: "error",
            code: !allowed.some((g) => g.id === message.groupId)
              ? "forbidden-group"
              : candidates.length
                ? "ambiguous-media"
                : "no-media",
            message: !allowed.some((g) => g.id === message.groupId)
              ? "Group is not authorized"
              : candidates.length
                ? "More than one eligible media browser; leave exactly one enabled"
                : "No media browser available; enable its microphone",
            requestId: message.requestId,
          });
          this.changed();
          return;
        }
        if (message.type === "ptt-start") {
          session.target = candidates[0].id;
          session.holds.add(message.groupId);
        } else {
          session.holds.delete(message.groupId);
          if (!session.holds.size) session.target = undefined;
        }
        console.info(
          `Control PTT ${message.type === "ptt-start" ? "START" : "STOP"}: ${session.id} group ${message.groupId}`,
        );
        this.send(session, {
          v: 1,
          type: "ack",
          requestId: message.requestId,
          groupId: message.groupId,
          held: session.holds.has(message.groupId),
        });
        this.changed();
      });
    });
  }
  reconcile(now: number) {
    for (const session of this.sessions.values()) {
      if (
        session.ws.readyState !== WebSocket.OPEN ||
        now - session.lastActivity >= 5000 ||
        now - session.lastPong >= 5000
      ) {
        this.remove(session.id, "heartbeat timeout", false);
        continue;
      }
      if (!session.credentialId) continue;
      const identity = this.store.controlIdentity(session.credentialId);
      if (!identity) {
        this.remove(session.id, "credential or user invalid", false);
        continue;
      }
      const candidates = this.targets().filter(
        (p) => p.userId === identity.user.id && p.mediaReady,
      );
      if (candidates.length !== 1 || candidates[0].id !== session.target) {
        session.holds.clear();
        session.target = undefined;
      } else
        session.holds = new Set(
          sanitizeState(identity.user, this.store.groups(), [...session.holds]),
        );
      if (!session.holds.size) session.target = undefined;
    }
  }
  holdsFor(peerId: string) {
    return [
      ...new Set(
        [...this.sessions.values()]
          .filter((s) => s.target === peerId)
          .flatMap((s) => [...s.holds]),
      ),
    ];
  }
  removeTarget(peerId: string) {
    for (const session of this.sessions.values())
      if (session.target === peerId) {
        session.holds.clear();
        session.target = undefined;
      }
  }
  publish() {
    for (const session of this.sessions.values()) {
      if (!session.credentialId) continue;
      const identity = this.store.controlIdentity(session.credentialId);
      if (!identity) continue;
      const candidates = this.targets().filter(
        (p) => p.userId === identity.user.id && p.mediaReady,
      );
      const snapshot: ControlSnapshot = {
        v: 1,
        type: "snapshot",
        sessionId: session.id,
        operator: {
          id: identity.user.id,
          displayName: identity.user.displayName,
        },
        groups: allowedGroups(identity.user, this.store.groups()),
        holds: [...session.holds],
        targetPeerId: session.target ?? null,
        media:
          candidates.length === 1
            ? "ready"
            : candidates.length
              ? "ambiguous"
              : "unavailable",
      };
      this.send(session, snapshot);
    }
  }
  ping() {
    for (const session of this.sessions.values())
      session.ws.ping(undefined, undefined, (error) => {
        if (error) this.remove(session.id, "ping failed");
      });
  }
  async close() {
    for (const id of this.sessions.keys())
      this.remove(id, "server stopping", false);
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
