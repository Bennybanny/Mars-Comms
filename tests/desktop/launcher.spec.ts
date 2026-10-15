import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { request } from "node:https";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function launch(dataDirectory: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MARS_COMMS_TEST_DATA_DIR: dataDirectory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.MARS_COMMS_EXECUTABLE;
  return electron.launch({
    ...(executablePath ? { cwd: tmpdir() } : {}),
    ...(executablePath
      ? { executablePath, args: [] }
      : { args: [resolve(".")] }),
    env: env as Record<string, string>,
    timeout: 30000,
  });
}

test("native launcher generates certificates, exports only public CA, runs HTTPS/setup, shows QR and stops on close", async ({
  browser,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "mars-native-"));
  let app: ElectronApplication | undefined;
  const port = await freePort(),
    setupPort = await freePort();
  try {
    app = await launch(join(directory, "app"));
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(
      Boolean(process.env.MARS_COMMS_EXECUTABLE),
    );
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(
      page.getByRole("heading", { name: "MARS COMMS" }),
    ).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    expect(await page.evaluate(() => typeof (window as any).process)).toBe(
      "undefined",
    );
    await page.getByLabel("Network interface").selectOption("127.0.0.1");
    await page.getByLabel("HTTPS port", { exact: true }).fill(String(port));
    await page.getByLabel("HTTPS port", { exact: true }).press("Tab");
    await expect(page.getByLabel("Client setup port · HTTP")).toBeEnabled();
    await page.getByLabel("Client setup port · HTTP").fill(String(setupPort));
    await page.getByLabel("Client setup port · HTTP").press("Tab");
    await page
      .getByRole("button", { name: "Generate Certificate", exact: true })
      .click();
    await expect(page.locator("#certStatus")).toHaveText("Certificate ready");
    const snapshot = await page.evaluate(() =>
      (window as any).marsLauncher.snapshot(),
    );
    const fingerprint = snapshot.certificate.fingerprint;
    expect(snapshot.certificate.names).toContain("127.0.0.1");
    // The real native save dialog is substituted only in this test, so the export
    // runs through the same narrow IPC and public-certificate method as production.
    const exported = join(directory, "Mars-Comms-CA.crt");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, exported);
    await page
      .getByRole("button", { name: "Export Client CA", exact: true })
      .click();
    await expect
      .poll(() => {
        try {
          return readFileSync(exported, "utf8");
        } catch {
          return "";
        }
      })
      .toContain("BEGIN CERTIFICATE");
    expect(readFileSync(exported, "utf8")).not.toContain("PRIVATE KEY");
    await page
      .getByRole("button", { name: "START SERVER", exact: true })
      .click();
    await expect(page.locator("#serverStatus")).toHaveText("● Running");
    await expect(page.locator("#mdns")).not.toHaveText("Starting", {
      timeout: 8000,
    });
    await expect(page.locator("#url")).toHaveText(`https://127.0.0.1:${port}`);
    const ca = readFileSync(exported, "utf8");
    const login = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = request(
          `https://127.0.0.1:${port}/api/login`,
          {
            ca,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: `https://127.0.0.1:${port}`,
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode!, body }));
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify({ username: "admin", password: "admin" }));
      },
    );
    expect(login.status).toBe(200);
    expect(JSON.parse(login.body).username).toBe("admin");
    // Exercise the actual browser frontend served by the packaged application,
    // not just its login API. The Node request above validates the certificate
    // chain; this isolated browser context does not alter the OS trust store.
    const client = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const intercom = await client.newPage();
      const clientErrors: string[] = [];
      intercom.on("pageerror", (error) => clientErrors.push(error.message));
      intercom.on("console", (message) => {
        if (
          /content security policy|refused to load|violates.*policy/i.test(
            message.text(),
          )
        )
          clientErrors.push(message.text());
      });
      await intercom.goto(`https://127.0.0.1:${port}`);
      await expect(
        intercom.getByRole("heading", { name: "Join the conversation." }),
      ).toBeVisible();
      await expect(intercom.locator("html")).toHaveCSS(
        "background-color",
        "rgb(17, 17, 22)",
      );
      await intercom.getByLabel("Username", { exact: true }).fill("admin");
      await intercom.getByLabel("Password", { exact: true }).fill("admin");
      await intercom.getByRole("button", { name: "Sign in" }).click();
      await expect(
        intercom.getByRole("heading", { name: "Your comms. Ready on cue." }),
      ).toBeVisible();
      await expect(intercom.locator(".connection")).toContainText("CONNECTED");
      expect(clientErrors).toEqual([]);
    } finally {
      await client.close();
    }
    const publicDownload = await fetch(
      `http://127.0.0.1:${setupPort}/certificate`,
    );
    expect(await publicDownload.text()).toBe(ca);
    expect((await fetch(`http://127.0.0.1:${setupPort}/api/me`)).status).toBe(
      404,
    );
    await page
      .getByRole("button", { name: "Show Client Setup QR", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#qr")).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );
    await expect(page.locator("#setupUrl")).toHaveText(
      `http://127.0.0.1:${setupPort}/setup`,
    );
    await expect(page.locator("#fingerprint")).toHaveText(fingerprint);
    await page.screenshot({ path: "desktop-test-results/native-setup-qr.png" });
    await page.getByRole("button", { name: "Close client setup" }).click();
    let opened = "";
    await app.evaluate(({ shell }) => {
      (globalThis as any).openedURL = "";
      shell.openExternal = async (url) => {
        (globalThis as any).openedURL = url;
      };
    });
    await page
      .getByRole("button", { name: "Open Mars Comms", exact: false })
      .click();
    opened = await app.evaluate(() => (globalThis as any).openedURL);
    expect(opened).toBe(`https://127.0.0.1:${port}`);
    await page.screenshot({ path: "desktop-test-results/native-launcher.png" });
    await page
      .getByRole("button", { name: "STOP SERVER", exact: true })
      .click();
    await expect(page.locator("#serverStatus")).toHaveText("● Stopped");
    await expect(
      page.getByRole("button", { name: "START SERVER", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("#addresses")).toBeHidden();
    await expect
      .poll(async () => {
        try {
          await fetch(`http://127.0.0.1:${setupPort}/setup`);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    await page
      .getByRole("button", { name: "Update Certificate", exact: true })
      .click();
    await expect(page.locator("#certStatus")).toHaveText("Certificate ready");
    expect(
      (await page.evaluate(() => (window as any).marsLauncher.snapshot()))
        .certificate.fingerprint,
    ).toBe(fingerprint);
    await page
      .getByRole("button", { name: "START SERVER", exact: true })
      .click();
    await expect(page.locator("#serverStatus")).toHaveText("● Running");
    expect(errors).toEqual([]);
    // Window close must stop the server and quit, rather than hide a background process.
    const exited = new Promise<void>((resolve) =>
      app!.process().once("exit", () => resolve()),
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await exited;
    app = undefined;
    await expect
      .poll(async () => {
        try {
          await fetch(`http://127.0.0.1:${setupPort}/setup`);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    app = await launch(join(directory, "app"));
    const restored = await app.firstWindow();
    await expect(restored.getByLabel("Network interface")).toHaveValue(
      "127.0.0.1",
    );
    await expect(
      restored.getByLabel("HTTPS port", { exact: true }),
    ).toHaveValue(String(port));
    await expect(restored.locator("#certStatus")).toHaveText(
      "Certificate ready",
    );
    await expect(restored.locator("#serverStatus")).toHaveText("● Stopped");
  } finally {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
