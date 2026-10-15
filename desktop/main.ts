import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, appendFileSync } from "node:fs";
import QRCode from "qrcode";
import { LauncherController } from "../launcher/controller.js";
import type { LauncherConfig } from "../shared/launcher.js";
import { dataDirectory as resolveDataDirectory } from "../launcher/paths.js";

app.setName("Mars Comms");
const dataDirectory = resolveDataDirectory({
  packaged: app.isPackaged,
  appData: app.getPath("appData"),
  home: app.getPath("home"),
  xdgDataHome: process.env.XDG_DATA_HOME,
  testOverride: process.env.MARS_COMMS_TEST_DATA_DIR,
});
app.setPath("userData", dataDirectory);
function log(message: string) {
  try {
    mkdirSync(join(dataDirectory, "logs"), { recursive: true, mode: 0o700 });
    appendFileSync(
      join(dataDirectory, "logs", "launcher.log"),
      `${new Date().toISOString()} [${process.pid}] ${message}\n`,
      { mode: 0o600 },
    );
  } catch {}
}
log(`Starting Mars Comms ${app.getVersion()}`);
let window: BrowserWindow | undefined;
let controller: LauncherController | undefined;
let quitting = false;
let closing = false;
let creatingWindow: Promise<void> | undefined;
const entry = join(__dirname, "index.html");
const ownURL = pathToFileURL(entry).href;
function authorize(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== ownURL
  )
    throw Error("Launcher action refused.");
}
function handle(name: string, action: (...args: any[]) => unknown) {
  ipcMain.handle("mars:" + name, async (event, ...args) => {
    authorize(event);
    return action(...args);
  });
}
async function createWindow() {
  window = new BrowserWindow({
    width: 600,
    height: 890,
    minWidth: 520,
    minHeight: 720,
    show: false,
    title: "Mars Comms",
    backgroundColor: "#131218",
    autoHideMenuBar: true,
    icon: join(__dirname, "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.removeMenu();
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      void shutdown();
    }
  });
  window.on("closed", () => {
    window = undefined;
  });
  window.webContents.on("render-process-gone", (_event, details) =>
    log(`Launcher renderer stopped: ${details.reason} (${details.exitCode})`),
  );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== ownURL) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  await window.loadFile(entry);
  window.show();
  log("Launcher window ready");
}
async function showLauncher() {
  if (closing) return;
  if (creatingWindow) await creatingWindow;
  if (!window || window.isDestroyed()) {
    if (!controller) return;
    creatingWindow = createWindow().finally(() => {
      creatingWindow = undefined;
    });
    await creatingWindow;
  }
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
}
async function shutdown() {
  if (closing) return;
  closing = true;
  log(`Shutdown requested; server ${controller?.state ?? "not initialized"}`);
  const deadline = setTimeout(() => {
    log("Shutdown deadline reached; terminating application");
    app.exit(1);
  }, 8000);
  deadline.unref();
  try {
    await controller?.dispose();
    quitting = true;
    clearTimeout(deadline);
    log("Shutdown complete");
    // All application services are already closed. Exit the GUI process
    // explicitly so a portable wrapper cannot be left waiting on Chromium.
    app.exit(0);
  } catch (error) {
    clearTimeout(deadline);
    closing = false;
    log("Shutdown postponed: " + (error as Error).message);
    const options: Electron.MessageBoxOptions = {
      type: "info",
      message: (error as Error).message,
      buttons: ["OK"],
    };
    if (window && !window.isDestroyed())
      await dialog.showMessageBox(window, options);
    else await dialog.showMessageBox(options);
  }
}
if (!app.requestSingleInstanceLock()) {
  log("Existing instance notified");
  app.exit(0);
} else {
  app.on("second-instance", () => {
    log("Show existing launcher requested");
    void showLauncher().catch((error) =>
      log("Could not restore launcher: " + String(error)),
    );
  });
  app
    .whenReady()
    .then(async () => {
      controller = new LauncherController({
        dataDirectory,
        staticRoot: join(app.getAppPath(), "dist"),
        version: app.getVersion(),
      });
      controller.on("change", (state) => {
        if (window && !window.isDestroyed())
          window.webContents.send("mars:changed", state);
      });
      controller.watch();
      handle("snapshot", () => controller!.snapshot());
      handle("configure", (config: LauncherConfig) =>
        controller!.configure(config),
      );
      handle("generate", () => controller!.generate());
      handle("start", () => controller!.start());
      handle("stop", () => controller!.stop());
      handle("open", async () => {
        const state = controller!.snapshot();
        if (state.state !== "Running" || !state.url)
          throw Error("Start the server before opening Mars Comms.");
        await shell.openExternal(state.url);
      });
      handle("qr", async () => {
        const state = controller!.snapshot();
        if (!state.setupUrl)
          throw Error("Start the server before showing the client setup QR.");
        return QRCode.toDataURL(state.setupUrl, {
          width: 300,
          margin: 3,
          errorCorrectionLevel: "M",
        });
      });
      handle("export", async () => {
        const result = await dialog.showSaveDialog(window!, {
          title: "Export public Mars Comms CA certificate",
          defaultPath: join(app.getPath("downloads"), "Mars-Comms-CA.crt"),
          filters: [{ name: "Public CA certificate", extensions: ["crt"] }],
        });
        if (result.canceled || !result.filePath) return false;
        controller!.certificates.exportPublicCA(result.filePath);
        return true;
      });
      handle("import", async () => {
        const result = await dialog.showOpenDialog(window!, {
          title: "Import existing Mars Comms database (source is preserved)",
          properties: ["openFile"],
          filters: [
            {
              name: "Mars Comms SQLite database",
              extensions: ["sqlite", "db"],
            },
          ],
        });
        if (result.canceled || !result.filePaths[0]) return false;
        await controller!.importDatabase(result.filePaths[0]);
        return true;
      });
      await showLauncher();
    })
    .catch(async (error) => {
      log("Startup failed: " + String(error));
      await dialog.showMessageBox({
        type: "error",
        title: "Mars Comms",
        message:
          "Mars Comms could not open its application data or launcher. Check folder permissions and restart.",
      });
      quitting = true;
      app.exit(1);
    });
  app.on("before-quit", (event) => {
    if (!quitting) {
      event.preventDefault();
      void shutdown();
    }
  });
  app.on("window-all-closed", () => {
    if (!quitting) void shutdown();
  });
  app.on("activate", () => {
    void showLauncher().catch((error) =>
      log("Could not restore launcher: " + String(error)),
    );
  });
}
