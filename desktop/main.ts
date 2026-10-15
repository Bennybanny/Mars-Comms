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
let window: BrowserWindow | undefined;
let controller: LauncherController | undefined;
let quitting = false;
let closing = false;
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
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== ownURL) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  await window.loadFile(entry);
  window.show();
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      void shutdown();
    }
  });
  window.on("closed", () => {
    window = undefined;
  });
}
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    await controller?.dispose();
    quitting = true;
    app.quit();
  } catch (error) {
    closing = false;
    await dialog.showMessageBox(window!, {
      type: "info",
      message: (error as Error).message,
      buttons: ["OK"],
    });
  }
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
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
      await createWindow();
    })
    .catch(async () => {
      await dialog.showMessageBox({
        type: "error",
        title: "Mars Comms",
        message:
          "Mars Comms could not open its application data or launcher. Check folder permissions and restart.",
      });
      quitting = true;
      app.quit();
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
    window?.show();
  });
}
