import { Bonjour } from "bonjour-service";
import type { LauncherSnapshot } from "../shared/launcher.js";
export type Discovery = (
  address: string,
  port: number,
  onState: (state: LauncherSnapshot["mdns"]) => void,
) => () => Promise<void>;
export const advertise: Discovery = (address, port, onState) => {
  let closed = false;
  const bonjour = new Bonjour({}, () => {
    if (!closed) onState("Error");
  });
  const service = bonjour.publish({
    name: "Mars Comms",
    type: "https",
    host: "MarsComms.local",
    port,
    probe: true,
    disableIPv6: true,
  });
  const records = service.records.bind(service);
  service.records = () => [
    ...records().filter(
      (record) => record.type !== "A" && record.type !== "AAAA",
    ),
    { name: service.host, type: "A", ttl: 120, data: address },
  ];
  service.on("up", () => {
    if (!closed) {
      clearTimeout(timer);
      onState("Available");
    }
  });
  service.on("error", () => {
    if (!closed) {
      clearTimeout(timer);
      onState("Error");
    }
  });
  const timer = setTimeout(() => {
    if (!closed && !service.published) onState("Unavailable");
  }, 5000);
  timer.unref();
  return () =>
    new Promise<void>((resolve) => {
      closed = true;
      clearTimeout(timer);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        bonjour.destroy();
        resolve();
      };
      const timeout = setTimeout(finish, 800);
      try {
        bonjour.unpublishAll(finish);
      } catch {
        finish();
      }
    });
};
