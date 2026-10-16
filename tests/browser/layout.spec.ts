import { test, expect, type Page } from "@playwright/test";
import { peerIdentity, enableInPeerOrder } from "./media-fixture";
async function login(page: Page, username = "beltpack") {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".connection")).toHaveText("● CONNECTED");
}
async function captureContext(page: Page) {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor() {
        super();
        (window as any).testAudioContext = this;
      }
    };
  });
}
async function enable(page: Page) {
  await page
    .getByRole("button", { name: "Enable Microphone", exact: true })
    .click();
  await expect(page.locator(".audio-bar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Resume audio", exact: true }),
  ).toHaveCount(0);
}

for (const [width, height] of [
  [1920, 1080],
  [1366, 768],
  [390, 844],
  [412, 915],
]) {
  test(`compact intercom and three complete channels at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await captureContext(page);
    await login(page);
    await expect(page.locator("article.card")).toHaveCount(3);
    const configured = [
      "rgb(37, 99, 235)",
      "rgb(139, 92, 246)",
      "rgb(220, 38, 38)",
    ];
    for (let i = 0; i < 3; i++) {
      const channel = page.locator("article.card").nth(i);
      await expect(channel.locator(".channel-color-bar")).toHaveCSS(
        "background-color",
        configured[i],
      );
      await expect(channel.locator("h2 .dot")).toHaveCount(0);
      const bar = (await channel.locator(".channel-color-bar").boundingBox())!;
      const bounds = (await channel.boundingBox())!;
      expect(bar.height).toBe(5);
      expect(bar.width).toBeGreaterThanOrEqual(bounds.width - 2);
      expect(bar.y - bounds.y).toBeLessThanOrEqual(1);
    }
    await expect(
      page.getByText("LIVE PRODUCTION / INTERCOM", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Your comms. Ready on cue.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Listen in. Hold to talk. Stay connected.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator("header .crew-count")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect Device QR" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enable Microphone", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/ui-${width}-${height}-before.png`,
      fullPage: true,
    });
    await enable(page);
    const measurements = await page.evaluate(() => ({
      header: document.querySelector("header")!.getBoundingClientRect().height,
      bottom: [...document.querySelectorAll("article.card")]
        .at(-1)!
        .getBoundingClientRect().bottom,
      pageHeight: document.documentElement.scrollHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
      ptt: [...document.querySelectorAll(".ptt")].map(
        (e) => e.getBoundingClientRect().height,
      ),
    }));
    expect(measurements.overflow).toBe(false);
    if (width <= 600) {
      expect(measurements.header).toBeLessThanOrEqual(68);
      expect(measurements.bottom).toBeLessThanOrEqual(height);
      expect(measurements.pageHeight).toBeLessThanOrEqual(height);
      expect(measurements.ptt.every((value) => value >= 72)).toBe(true);
      for (const control of [
        ".ptt",
        ".latch",
        ".listen",
        'input[type="range"]',
      ]) {
        const boxes = await page
          .locator("article")
          .locator(control)
          .evaluateAll((elements) =>
            elements.map((e) => ({
              top: e.getBoundingClientRect().top,
              bottom: e.getBoundingClientRect().bottom,
              height: e.getBoundingClientRect().height,
            })),
          );
        expect(boxes).toHaveLength(3);
        expect(
          boxes.every(
            (b) =>
              b.top >= measurements.header &&
              b.bottom <= height &&
              b.height >= 44,
          ),
        ).toBe(true);
      }
    } else expect(measurements.ptt.every((value) => value >= 154)).toBe(true);
    await page.screenshot({
      path: `test-results/ui-${width}-${height}-after.png`,
      fullPage: true,
    });
    console.log(
      `Viewport ${width}x${height}: header ${measurements.header}px; third card bottom ${measurements.bottom}px`,
    );
    if (width !== 390 || height !== 844) return;
    // Exercise reduced Safari viewport height and landscape without creating
    // extra login attempts against the production login rate limiter.
    for (const size of [
      { width: 390, height: 700 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (size.width === 390) {
        const third = (await page.locator("article").nth(2).boundingBox())!;
        expect(third.y + third.height).toBeLessThanOrEqual(size.height);
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight),
        ).toBeLessThanOrEqual(size.height);
      } else {
        await page
          .locator("article")
          .last()
          .locator(".ptt")
          .scrollIntoViewIfNeeded();
        await expect(
          page.locator("article").last().locator(".ptt"),
        ).toBeInViewport();
      }
      await page.screenshot({
        path: `test-results/ui-${size.width}-${size.height}-after.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    const latch = page.locator(".card").first().locator(".latch");
    await latch.click();
    await expect(latch).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".card").first()).toHaveClass(/transmitting/);
    await expect(page.locator(".card").first().locator(".ptt")).toHaveClass(
      /active/,
    );
    await expect(
      page.locator(".card").first().locator(".channel-color-bar"),
    ).toHaveCSS("background-color", "rgb(37, 99, 235)");
    await page.screenshot({ path: "test-results/ui-mobile-latch.png" });
    await page.evaluate(() => (window as any).testAudioContext.suspend());
    await expect(page.locator("header .resume-audio")).toBeVisible();
    await expect(page.locator(".audio-bar")).toHaveCount(0);
    await page.screenshot({ path: "test-results/ui-mobile-resume.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => (window as any).testAudioContext.resume());
    await expect(page.locator("header .resume-audio")).toHaveCount(0);
    await expect(latch).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => (window as any).testAudioContext.suspend());
    await expect(page.locator("header .resume-audio")).toBeVisible();
    await page
      .getByRole("button", { name: "Resume audio", exact: true })
      .click();
    await expect(page.locator("header .resume-audio")).toHaveCount(0);
  });
}

test("QR workflows use configured addresses, copy links and preserve channel state", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await enable(page);
  const first = page.locator("article").first();
  await first.locator(".latch").click();
  await first.getByRole("slider").fill("0.65");
  await first.locator(".listen").click();
  await page.getByRole("button", { name: "Connect Device QR" }).click();
  const modal = page.getByRole("dialog", { name: "Connect Device" });
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("img", { name: "New Device Setup QR code" }),
  ).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(modal.locator(".connect-link")).toHaveAttribute(
    "href",
    "http://192.0.2.25:8802/setup",
  );
  await modal.getByRole("button", { name: "Copy Link" }).click();
  await expect(
    modal.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "http://192.0.2.25:8802/setup",
  );
  await page.screenshot({ path: "test-results/ui-mobile-qr-setup.png" });
  await modal
    .getByRole("button", { name: "Open Mars Comms", exact: true })
    .click();
  await expect(
    modal.getByRole("img", { name: "Open Mars Comms QR code" }),
  ).toBeVisible();
  await expect(modal.locator(".connect-link")).toHaveAttribute(
    "href",
    "https://192.0.2.25:8443",
  );
  await modal.getByRole("button", { name: "Copy Link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "https://192.0.2.25:8443",
  );
  const bounds = (await modal.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "test-results/ui-mobile-qr-app.png" });
  await modal.getByRole("button", { name: "Close Connect Device" }).click();
  await expect(modal).toHaveCount(0);
  await expect(first.locator(".latch")).toHaveAttribute("aria-pressed", "true");
  await expect(first.locator(".listen")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(first.getByRole("slider")).toHaveValue("0.65");
  await expect(
    page.getByRole("button", { name: "Connect Device QR" }),
  ).toBeFocused();
});

test("mobile talker indication and blocked playback recovery stay compact", async ({
  browser,
}) => {
  const a = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["microphone"],
  });
  const b = await browser.newContext({ permissions: ["microphone"] });
  try {
    const page = await a.newPage(),
      peer = await b.newPage();
    const identities = [page, peer].map((page) => ({
      page,
      identity: peerIdentity(page),
    }));
    await page.addInitScript(() => {
      (window as any).blockPlayback = true;
      const play = HTMLMediaElement.prototype.play;
      const Original = window.RTCPeerConnection;
      (window as any).testConnections = [];
      window.RTCPeerConnection = class extends Original {
        constructor(config?: RTCConfiguration) {
          super(config);
          (window as any).testConnections.push(this);
        }
      };
      HTMLMediaElement.prototype.play = function () {
        if ((window as any).blockPlayback && this.srcObject) {
          this.autoplay = false;
          this.pause();
          return Promise.reject(
            new DOMException("Playback blocked", "NotAllowedError"),
          );
        }
        return play.call(this);
      };
    });
    await login(page);
    await login(peer, "receiver");
    await enableInPeerOrder(identities);
    await expect(page.locator("header .resume-audio")).toBeVisible({
      timeout: 15000,
    });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as any).testConnections.some(
              (pc: RTCPeerConnection) => pc.connectionState === "connected",
            ),
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    await page.evaluate(() => {
      (window as any).blockPlayback = false;
    });
    await page
      .getByRole("button", { name: "Resume audio", exact: true })
      .click();
    await expect(page.locator("header .resume-audio")).toHaveCount(0);
    await peer.locator(".latch").first().click();
    await expect(page.locator(".speakers").first()).toHaveText("receiver");
    await expect(page.locator(".card").first()).toHaveClass(/receiving/);
    await expect(page.locator("header .crew-count")).toHaveAttribute(
      "aria-label",
      "2 crew online",
    );
    await page.screenshot({ path: "test-results/ui-mobile-talker.png" });
    await page
      .locator("audio")
      .first()
      .evaluate((audio: HTMLAudioElement) => audio.pause());
    await expect(page.locator("header .resume-audio")).toBeVisible();
    await b.close();
    await expect(page.locator("header .crew-count")).toHaveAttribute(
      "aria-label",
      "1 crew online",
    );
    await expect(page.locator("header .resume-audio")).toHaveCount(0);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test("invalid and missing group colors fall back to the existing accent", async ({
  page,
}) => {
  await page.routeWebSocket("**/signal", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "snapshot") {
        message.groups[0].color = "not-a-color";
        delete message.groups[1].color;
      }
      socket.send(JSON.stringify(message));
    });
  });
  await login(page);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (let index = 0; index < 2; index++)
      await expect(
        page.locator("article").nth(index).locator(".channel-color-bar"),
      ).toHaveCSS("background-color", "rgb(139, 92, 246)");
  }
});

test("four channels remain available and scroll normally on phones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await login(page, "allchannels");
  await enable(page);
  await expect(page.locator("article")).toHaveCount(4);
  await page.locator("article").last().locator(".ptt").scrollIntoViewIfNeeded();
  await expect(page.locator("article").last().locator(".ptt")).toBeInViewport();
  await expect(page.locator("header")).toBeInViewport();
});
