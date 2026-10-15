import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { isIPv4 } from "node:net";
import type { LauncherConfig, NetworkInterface } from "../shared/launcher.js";
export function listInterfaces(
  source: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): NetworkInterface[] {
  const seen = new Set<string>();
  const result = Object.entries(source)
    .filter(
      ([name]) =>
        !/loopback|vethernet|virtual|vmware|vbox|docker|wsl|vpn|nordlynx|tailscale|zerotier/i.test(
          name,
        ),
    )
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter(
          (entry) =>
            entry.family === "IPv4" &&
            !entry.internal &&
            isIPv4(entry.address) &&
            !entry.address.startsWith("169.254.") &&
            entry.address !== "0.0.0.0",
        )
        .map((entry) => ({ name, address: entry.address })),
    )
    .filter((entry) => {
      if (seen.has(entry.address)) return false;
      seen.add(entry.address);
      return true;
    });
  return [...result, { name: "Localhost / development", address: "127.0.0.1" }];
}
export function selectionAvailable(
  config: LauncherConfig,
  interfaces: NetworkInterface[],
) {
  return interfaces.some(
    (entry) =>
      entry.address === config.address && entry.name === config.interfaceName,
  );
}
