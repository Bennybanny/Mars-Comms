import { test, expect, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { peerIdentity, enableInPeerOrder } from "./media-fixture";
async function login(page: Page, username: string, password = "test-password") {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".connection")).toHaveText("● CONNECTED");
}
test("external PTT gates real browser RTP; browser latch, disconnect and revoke remain safe", async ({
  browser,
}) => {
  const a = await browser.newContext({ permissions: ["microphone"] });
  const b = await browser.newContext({ permissions: ["microphone"] });
  const admin = await browser.newContext();
  const controllerSockets: WebSocket[] = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let moduleClient: any;
  try {
    const p = await a.newPage(),
      q = await b.newPage(),
      management = await admin.newPage();
    const identities = [p, q].map((page) => ({
      page,
      identity: peerIdentity(page),
    }));
    await q.addInitScript(() => {
      const Original = window.RTCPeerConnection;
      (window as any).connections = [];
      window.RTCPeerConnection = class extends Original {
        constructor(config?: RTCConfiguration) {
          super(config);
          (window as any).connections.push(this);
        }
      };
    });
    await login(p, "camera");
    await login(q, "receiver");
    await enableInPeerOrder(identities);
    await login(management, "admin", "admin");
    await management
      .getByRole("button", { name: "Admin", exact: true })
      .click();
    const row = management.getByRole("row").filter({
      has: management.getByRole("cell", { name: "camera", exact: true }),
    });
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await management
      .getByLabel("Control credential name")
      .fill("Browser integration test");
    await management.getByRole("button", { name: "Generate New Key" }).click();
    const key = management.getByLabel("New control API key");
    await expect(key).toHaveValue(/^mc_[A-Za-z0-9_-]{43}$/);
    const token = await key.inputValue();
    await management
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(management.getByLabel("New control API key")).toHaveCount(0);
    await expect(
      management.getByText("Browser integration test · Active"),
    ).toBeVisible();
    const ws = new WebSocket("ws://127.0.0.1:8190/api/control/v1");
    controllerSockets.push(ws);
    let snapshot: any;
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "snapshot") snapshot = message;
    });
    await new Promise<void>((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ v: 1, type: "authenticate", token }));
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ v: 1, type: "heartbeat" }));
    }, 1000);
    await expect.poll(() => snapshot?.media).toBe("ready");
    const groupId = snapshot.groups.find((g: any) => g.name === "Camera").id;
    const send = (start: boolean) =>
      ws.send(
        JSON.stringify({
          v: 1,
          type: start ? "ptt-start" : "ptt-stop",
          groupId,
        }),
      );
    const command = (type: string) =>
      ws.send(
        JSON.stringify({
          v: 1,
          type,
          ...(type === "clear-my-talk" ? {} : { groupId }),
        }),
      );
    const energy = () =>
      q.evaluate(async () => {
        let total = 0;
        for (const pc of (window as any).connections) {
          const stats = await pc.getStats();
          stats.forEach((entry: any) => {
            if (entry.type === "inbound-rtp" && entry.kind === "audio")
              total += entry.totalAudioEnergy ?? 0;
          });
        }
        return total;
      });
    const receiving = q.locator(".speakers").first();
    const camera = p
      .locator("article")
      .filter({ has: p.getByRole("heading", { name: "Camera", exact: true }) });
    const initial = await energy();
    send(true);
    await expect(receiving).toHaveText("camera");
    await expect
      .poll(async () => (await energy()) - initial, { timeout: 20000 })
      .toBeGreaterThan(0.0001);
    await expect(camera.locator(".ptt")).toHaveClass(/active/);
    await expect(camera.locator(".latch")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await camera.locator(".latch").click();
    send(false);
    await expect.poll(() => snapshot.holds.length).toBe(0);
    await expect(receiving).toHaveText("camera");
    send(true);
    await camera.locator(".latch").click();
    await expect(receiving).toHaveText("camera");
    send(false);
    await expect(receiving).toHaveText("");
    await expect
      .poll(async () => {
        const before = await energy();
        await q.waitForTimeout(350);
        return (await energy()) - before;
      })
      .toBeLessThan(0.00001);
    if (process.env.MARS_COMPANION_MODULE_DIR) {
      const Module = await import(
        pathToFileURL(
          join(process.env.MARS_COMPANION_MODULE_DIR, "dist/client.js"),
        ).href
      );
      moduleClient = new Module.ControlClient(
        { host: "127.0.0.1", port: 8190, secure: false, ca: "" },
        { apiKey: token },
      );
      moduleClient.start();
      await expect.poll(() => moduleClient.snapshot?.media).toBe("ready");
      const before = await energy();
      expect(moduleClient.ptt(groupId, true)).toBe(true);
      await expect(receiving).toHaveText("camera");
      await expect
        .poll(async () => (await energy()) - before, { timeout: 15000 })
        .toBeGreaterThan(0.0001);
      moduleClient.ptt(groupId, false);
      await expect(receiving).toHaveText("");
      const Panel = await import(
        pathToFileURL(
          join(process.env.MARS_COMPANION_MODULE_DIR, "dist/panel.js"),
        ).href
      );
      const panel = new Panel.PanelControls(moduleClient);
      moduleClient.on("snapshot", (state: any) => panel.reconcile(state));
      panel.reconcile(moduleClient.snapshot);
      panel.smartDown(groupId, "smart-key");
      await p.waitForTimeout(100);
      expect(moduleClient.snapshot.holds).toEqual([]);
      panel.smartUp(groupId, "smart-key");
      await expect.poll(() => moduleClient.snapshot.latches).toEqual([groupId]);
      await expect(receiving).toHaveText("camera");
      panel.smartDown(groupId, "smart-key");
      await expect.poll(() => moduleClient.snapshot.holds).toEqual([groupId]);
      panel.smartUp(groupId, "smart-key");
      await expect.poll(() => moduleClient.snapshot.holds).toEqual([]);
      expect(moduleClient.snapshot.latches).toEqual([groupId]);
      await expect(receiving).toHaveText("camera");
      panel.clear();
      await expect(receiving).toHaveText("");
      panel.smartDown(groupId, "smart-key");
      await expect.poll(() => moduleClient.snapshot.holds).toEqual([groupId]);
      panel.smartUp(groupId, "smart-key");
      await expect(receiving).toHaveText("");
      moduleClient.command("latch-on", groupId);
      await expect(receiving).toHaveText("camera");
      moduleClient.stop();
      await expect(receiving).toHaveText("");
    }
    command("latch-toggle");
    await expect.poll(() => snapshot.latches).toEqual([groupId]);
    await expect(receiving).toHaveText("camera");
    send(true);
    send(false);
    await expect.poll(() => snapshot.holds).toEqual([]);
    expect(snapshot.latches).toEqual([groupId]);
    command("clear-my-talk");
    await expect(receiving).toHaveText("");
    // External Listen changes both actual playback and the browser's persisted toggle.
    await q.locator(".latch").first().click();
    await expect
      .poll(() =>
        p
          .locator("audio")
          .evaluateAll((els) =>
            els.some((el) => (el as HTMLAudioElement).volume > 0),
          ),
      )
      .toBe(true);
    command("listen-off");
    await expect(camera.locator(".listen")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect
      .poll(() =>
        p
          .locator("audio")
          .evaluateAll((els) =>
            els.every((el) => (el as HTMLAudioElement).volume === 0),
          ),
      )
      .toBe(true);
    await expect(q.locator(".listen").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    command("listen-toggle");
    await expect(camera.locator(".listen")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(() =>
        p
          .locator("audio")
          .evaluateAll((els) =>
            els.some((el) => (el as HTMLAudioElement).volume > 0),
          ),
      )
      .toBe(true);
    await camera.locator(".listen").click();
    await expect.poll(() => snapshot.listening.includes(groupId)).toBe(false);
    command("listen-on");
    await expect(camera.locator(".listen")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const slider = camera.getByRole("slider");
    await slider.fill("0");
    await expect.poll(() => snapshot.listening.includes(groupId)).toBe(false);
    command("listen-on");
    await expect.poll(() => snapshot.listening.includes(groupId)).toBe(true);
    await expect(slider).toHaveValue("1");
    await q.locator(".latch").first().click();
    send(true);
    await expect(receiving).toHaveText("camera");
    clearInterval(heartbeat);
    ws.terminate();
    await expect(receiving).toHaveText("");
    const returned = new WebSocket("ws://127.0.0.1:8190/api/control/v1");
    controllerSockets.push(returned);
    let fresh: any;
    returned.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "snapshot") fresh = m;
    });
    await new Promise<void>((resolve) => returned.once("open", resolve));
    returned.send(JSON.stringify({ v: 1, type: "authenticate", token }));
    await expect.poll(() => fresh?.holds).toEqual([]);
    returned.send(JSON.stringify({ v: 1, type: "ptt-start", groupId }));
    await expect(receiving).toHaveText("camera");
    await management
      .getByRole("button", { name: "Revoke", exact: true })
      .click();
    await expect(receiving).toHaveText("");
    await expect(
      management.getByRole("button", { name: "Revoke", exact: true }),
    ).toHaveCount(0);
  } finally {
    clearInterval(heartbeat);
    moduleClient?.stop();
    controllerSockets.forEach((ws) => ws.terminate());
    await Promise.all([a.close(), b.close(), admin.close()]);
  }
});
