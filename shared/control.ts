import type { Group } from "./types.js";
export const CONTROL_PATH = "/api/control/v1";
export type ControlCredential = {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};
export type ControlClientMessage =
  | { v: 1; type: "authenticate"; token: string }
  | { v: 1; type: "heartbeat" }
  | {
      v: 1;
      type:
        | "ptt-start"
        | "ptt-stop"
        | "latch-toggle"
        | "latch-on"
        | "latch-off"
        | "listen-toggle"
        | "listen-on"
        | "listen-off";
      groupId: string;
      requestId?: string;
    }
  | { v: 1; type: "clear-my-talk"; requestId?: string };
export type ControlSnapshot = {
  v: 1;
  type: "snapshot";
  sessionId: string;
  operator: { id: string; displayName: string };
  groups: Group[];
  holds: string[];
  latches: string[];
  listening: string[];
  targetPeerId: string | null;
  mediaPeerId: string | null;
  media: "ready" | "unavailable" | "ambiguous";
};
export type ControlServerMessage =
  | ControlSnapshot
  | { v: 1; type: "authenticated"; sessionId: string }
  | { v: 1; type: "ack"; requestId?: string; groupId?: string; held: boolean }
  | { v: 1; type: "error"; code: string; message: string; requestId?: string };
