import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("CONNECTED", { exact: false }).first(),
  ).toBeVisible();
}
const card = (page: Page, name: string) =>
  page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
test("two browsers exchange real RTP audio; PTT, latch, listen, gain and reconnect safety", async ({
  browser,
}) => {
  const a = await browser.newContext({ permissions: ["microphone"] }),
    b = await browser.newContext({ permissions: ["microphone"] }),
    c = await browser.newContext({ permissions: ["microphone"] }),
    administrator = await browser.newContext();
  const p = await a.newPage(),
    q = await b.newPage(),
    r = await c.newPage();
  for (const page of [p, q, r])
    await page.addInitScript(() => {
      const Original = window.RTCPeerConnection;
      (window as any).connections = [];
      window.RTCPeerConnection = class extends Original {
        constructor(config?: RTCConfiguration) {
          super(config);
          (window as any).connections.push(this);
        }
      };
      const OriginalAudio = window.AudioContext;
      window.AudioContext = class extends OriginalAudio {
        constructor() {
          super();
          (window as any).audioContext = this;
        }
      };
    });
  try {
    await login(p, "camera");
    await login(q, "receiver");
    await login(r, "tech");
    await p
      .getByRole("button", { name: "Enable Microphone", exact: true })
      .click();
    await q
      .getByRole("button", { name: "Enable Microphone", exact: true })
      .click();
    await r
      .getByRole("button", { name: "Enable Microphone", exact: true })
      .click();
    await expect
      .poll(() =>
        p.evaluate(() =>
          (window as any).connections.some(
            (pc: RTCPeerConnection) => pc.connectionState === "connected",
          ),
        ),
      )
      .toBe(true);
    const camera = card(p, "Camera"),
      receiver = card(q, "Camera");
    await camera.getByRole("button", { name: "Latch to talk" }).click();
    await expect(receiver.locator(".speakers")).toContainText("camera");
    await expect
      .poll(
        async () =>
          q.evaluate(async () => {
            let energy = 0;
            for (const pc of (window as any).connections) {
              const stats = await pc.getStats();
              stats.forEach((r: any) => {
                if (r.type === "inbound-rtp" && r.kind === "audio")
                  energy += r.totalAudioEnergy ?? 0;
              });
            }
            return energy;
          }),
        { timeout: 20000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        q
          .locator("audio")
          .evaluateAll((els) =>
            (els as HTMLAudioElement[]).some((e) => e.volume === 1),
          ),
      )
      .toBe(true);
    await receiver.getByRole("slider").fill("0.35");
    await expect
      .poll(() =>
        q
          .locator("audio")
          .evaluateAll((els) =>
            (els as HTMLAudioElement[]).some(
              (e) => Math.abs(e.volume - 0.35) < 0.01,
            ),
          ),
      )
      .toBe(true);
    await receiver.getByRole("button", { name: /Listen/ }).click();
    await expect
      .poll(() =>
        q
          .locator("audio")
          .evaluateAll((els) =>
            (els as HTMLAudioElement[]).every((e) => e.volume === 0),
          ),
      )
      .toBe(true);
    await receiver.getByRole("button", { name: /Listen/ }).click();
    // Digital admin gain must change actual received media, not only a label.
    await administrator.request.post("/api/login", {
      data: { username: "admin", password: "admin" },
    });
    const users = await administrator.request
      .get("/api/admin/users")
      .then((res) => res.json());
    const cameraUser = users.find((user: any) => user.username === "camera");
    await administrator.request.put("/api/admin/users/" + cameraUser.id, {
      data: { ...cameraUser, micGain: 0 },
    });
    const energy = () =>
      q.evaluate(async () => {
        let value = 0;
        for (const pc of (window as any).connections) {
          const stats = await pc.getStats();
          stats.forEach((entry: any) => {
            if (entry.type === "inbound-rtp" && entry.kind === "audio")
              value += entry.totalAudioEnergy ?? 0;
          });
        }
        return value;
      });
    await expect
      .poll(async () => {
        const before = await energy();
        await q.waitForTimeout(350);
        return (await energy()) - before;
      })
      .toBeLessThan(0.00001);
    const mutedEnergy = await energy();
    await administrator.request.put("/api/admin/users/" + cameraUser.id, {
      data: { ...cameraUser, micGain: 1 },
    });
    await expect
      .poll(async () => (await energy()) - mutedEnergy, { timeout: 15000 })
      .toBeGreaterThan(0.0001);
    // Browser interruptions must clear transmission and expose a working recovery.
    await p.evaluate(() => (window as any).audioContext.suspend());
    await expect(p.getByRole("alert")).toContainText("Audio interrupted");
    await expect(
      camera.getByRole("button", { name: /PUSH TO TALK/ }),
    ).toBeDisabled();
    await expect(receiver.locator(".speakers")).toHaveText("");
    await p.getByRole("button", { name: "Resume audio", exact: true }).click();
    await expect(
      camera.getByRole("button", { name: /PUSH TO TALK/ }),
    ).toBeEnabled();
    await expect(
      camera.getByRole("button", { name: "Latch to talk" }),
    ).toHaveAttribute("aria-pressed", "false");
    const interruptedEnergy = await energy();
    await camera.getByRole("button", { name: "Latch to talk" }).click();
    await expect
      .poll(async () => (await energy()) - interruptedEnergy, {
        timeout: 15000,
      })
      .toBeGreaterThan(0.0001);
    // Pointer release leaves an already active Camera latch intact.
    const tech = card(p, "Tech").getByRole("button", { name: /PUSH TO TALK/ });
    const bounds = (await tech.boundingBox())!;
    await p.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await p.mouse.down();
    await expect(card(p, "Tech").locator(".tag")).toHaveText("TRANSMITTING");
    await expect(card(r, "Tech").locator(".speakers")).toContainText("camera");
    await expect(receiver.locator(".speakers")).toContainText("camera");
    await p.mouse.up();
    await expect(card(p, "Tech").locator(".tag")).toHaveText("STANDBY");
    await expect(card(r, "Tech").locator(".speakers")).toHaveText("");
    await expect(
      camera.getByRole("button", { name: "Latch to talk" }),
    ).toHaveAttribute("aria-pressed", "true");
    await a.setOffline(true);
    await expect(
      camera.getByRole("button", { name: "Latch to talk" }),
    ).toHaveAttribute("aria-pressed", "false", { timeout: 15000 });
    await a.setOffline(false);
    await expect(p.locator(".connection")).toContainText("CONNECTED", {
      timeout: 15000,
    });
    await expect(
      camera.getByRole("button", { name: "Latch to talk" }),
    ).toHaveAttribute("aria-pressed", "false");
  } finally {
    await a.close();
    await b.close();
    await c.close();
    await administrator.close();
  }
});
test("admin can create and edit users/groups through the interface", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("admin");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("Default admin password is still active.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "+ Add group", exact: true }).click();
  await page.getByLabel("Group name").fill("Stage");
  await page.getByRole("button", { name: "Save group" }).click();
  await expect(
    page.locator(".group-row").filter({ hasText: "Stage" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  await page.getByLabel("Display name").fill("Stage manager");
  await page.getByLabel("Username", { exact: true }).fill("stage");
  await page.getByLabel("Password", { exact: true }).fill("crew-password");
  await page.getByLabel("Stage", { exact: true }).check();
  await page.getByRole("button", { name: "Save user" }).click();
  const row = page.getByRole("row").filter({ hasText: "Stage manager" });
  await expect(row).toContainText("Stage");
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Mic level", { exact: false }).fill("1.25");
  await page.getByRole("button", { name: "Save user" }).click();
  await expect(row).toContainText("125%");
});
test("membership isolation and responsive layouts", async ({ page }) => {
  await login(page, "tech");
  await expect(card(page, "Tech")).toHaveCount(1);
  await expect(card(page, "Camera")).toHaveCount(0);
  const denied = await page.request.get("/api/admin/users");
  expect(denied.status()).toBe(403);
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [390, 844],
    [412, 915],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(
      page.getByRole("heading", { name: "Tech", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const box = await card(page, "Tech")
      .getByRole("button", { name: /PUSH TO TALK/ })
      .boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(140);
    await page.screenshot({
      path: `test-results/layout-${width}.png`,
      fullPage: true,
    });
  }
});
