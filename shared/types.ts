export const GROUP_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_GROUP_COLOR = "#8b5cf6";
export function groupColor(value: unknown) {
  return typeof value === "string" && GROUP_COLOR_PATTERN.test(value)
    ? value
    : DEFAULT_GROUP_COLOR;
}
export type Group = {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
};
export type User = {
  id: string;
  username: string;
  displayName: string;
  admin: boolean;
  enabled: boolean;
  groups: string[];
  micGain: number;
  defaultPassword: boolean;
};
export type Peer = { id: string; user: User; talk: string[]; listen: string[] };
export type ClientMessage =
  | { type: "heartbeat" }
  | { type: "state"; talk: string[]; listen: string[]; mediaReady?: boolean }
  | {
      type: "signal";
      to: string;
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };
export type ServerMessage =
  | {
      type: "snapshot";
      self: string;
      user: User;
      groups: Group[];
      peers: Peer[];
      externalTalk?: string[];
    }
  | {
      type: "signal";
      from: string;
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };
export function allowedGroups(user: User, groups: Group[]) {
  return groups.filter((g) => g.enabled && user.groups.includes(g.id));
}
export function sanitizeState(user: User, groups: Group[], values: string[]) {
  const ids = new Set(allowedGroups(user, groups).map((g) => g.id));
  return [...new Set(values)].filter((x) => ids.has(x));
}
export function relevant(a: Peer, b: Peer) {
  return a.user.groups.some((x) => b.user.groups.includes(x));
}
export function routeVolume(talk: string[], listen: Record<string, number>) {
  return Math.max(0, ...talk.map((g) => listen[g] ?? 0));
}
