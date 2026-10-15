import { isAbsolute, join, resolve } from "node:path";
export function dataDirectory(options: {
  packaged: boolean;
  appData: string;
  home: string;
  platform?: NodeJS.Platform;
  xdgDataHome?: string;
  developmentRoot?: string;
  testOverride?: string;
}) {
  if (options.testOverride) return resolve(options.testOverride);
  if (!options.packaged)
    return resolve(options.developmentRoot ?? process.cwd(), "data");
  if ((options.platform ?? process.platform) === "linux")
    return join(
      options.xdgDataHome && isAbsolute(options.xdgDataHome)
        ? options.xdgDataHome
        : join(options.home, ".local", "share"),
      "Mars Comms",
    );
  return join(options.appData, "Mars Comms");
}
