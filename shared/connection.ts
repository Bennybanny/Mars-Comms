export type ConnectionInfo = {
  address: string;
  appUrl: string;
  setupUrl: string;
  mdnsUrl?: string;
};
export type ConnectionQR = ConnectionInfo & { appQR: string; setupQR: string };
export function connectionInfo(
  config: { address: string; port: number; setupPort: number },
  mdnsAvailable = false,
): ConnectionInfo {
  return {
    address: config.address,
    appUrl: `https://${config.address}:${config.port}`,
    setupUrl: `http://${config.address}:${config.setupPort}/setup`,
    ...(mdnsAvailable
      ? { mdnsUrl: `https://MarsComms.local:${config.port}` }
      : {}),
  };
}
