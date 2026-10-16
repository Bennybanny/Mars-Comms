import type { Group } from "./types.js";
export type ChannelOrder = { groupIds: string[]; revision: number };
/** Stable-ID presentation only. Callers must filter authorization before sorting. */
export function orderedGroups(groups: Group[], groupIds: string[]): Group[] {
  const positions = new Map(groupIds.map((id, index) => [id, index]));
  return [...groups].sort(
    (a, b) =>
      (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity),
  );
}
