import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, username = "beltpack") {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".connection")).toHaveText("● CONNECTED");
}
const names = (page: Page) =>
  page.locator("article h2 .channel-name").allTextContents();
async function reset(page: Page) {
  const ids = await page
    .locator("article")
    .evaluateAll((els) =>
      ["Camera", "Tech", "Show"].map((name) =>
        els
          .find((el) => el.querySelector("h2")!.textContent === name)!
          .getAttribute("data-channel-id"),
      ),
    );
  await page.request.put("/api/me/channel-order", { data: { groupIds: ids } });
  await expect.poll(() => names(page)).toEqual(["Camera", "Tech", "Show"]);
}
for (const [width, height] of [
  [1920, 1080],
  [1366, 768],
  [390, 844],
  [412, 915],
]) {
  test(`color-bar reorder, safe controls and layout at ${width}x${height}`, async ({
    browser,
  }) => {
    const mobile = width < 600,
      context = await browser.newContext({
        viewport: { width, height },
        hasTouch: mobile,
        isMobile: mobile,
        permissions: ["microphone"],
      });
    const page = await context.newPage();
    let otherContext:
        Awaited<ReturnType<typeof browser.newContext>> | undefined,
      observerContext:
        Awaited<ReturnType<typeof browser.newContext>> | undefined,
      other: Page | undefined,
      observer: Page | undefined;
    try {
      await login(page);
      await reset(page);
      await page
        .getByRole("button", { name: "Enable Microphone", exact: true })
        .click();
      await expect(page.locator(".audio-bar")).toHaveCount(0);
      if (width === 1920) {
        otherContext = await browser.newContext();
        other = await otherContext.newPage();
        await login(other);
        observerContext = await browser.newContext();
        observer = await observerContext.newPage();
        await login(observer, "allchannels");
        await page.bringToFront();
      }
      let saves = 0;
      page.on("request", (r) => {
        if (r.method() === "PUT" && r.url().endsWith("/api/me/channel-order"))
          saves++;
      });
      const first = page.locator("article").first();
      await first.locator(".latch").click();
      const handle = page.getByRole("button", {
          name: "Reorder Show",
          exact: true,
        }),
        target = page.getByRole("button", {
          name: "Reorder Camera",
          exact: true,
        });
      const start = (await handle.boundingBox())!,
        destination = (await target.boundingBox())!;
      if (mobile) {
        const cdp = await context.newCDPSession(page);
        const touch = (
          type: "touchStart" | "touchMove" | "touchEnd",
          x: number,
          y: number,
        ) =>
          cdp.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
          });
        const x = start.x + start.width / 2,
          y = start.y + 8;
        await touch("touchStart", x, y);
        await page.waitForTimeout(60);
        await touch("touchEnd", x, y);
        await expect
          .poll(() => names(page))
          .toEqual(["Camera", "Tech", "Show"]);
        expect(saves).toBe(0);
        await touch("touchStart", x, y);
        await page.waitForTimeout(320);
        for (let i = 1; i <= 12; i++)
          await touch(
            "touchMove",
            x + ((destination.x + destination.width / 2 - x) * i) / 12,
            y + ((destination.y + 8 - y) * i) / 12,
          );
        await expect(page.locator(".dragging")).toHaveCount(1);
        await expect(page.locator(".drop-before")).toHaveCount(1);
        await page.screenshot({
          path: `test-results/order-${width}-${height}-dragging.png`,
          fullPage: true,
        });
        await touch(
          "touchEnd",
          destination.x + destination.width / 2,
          destination.y + 8,
        );
        await cdp.detach();
      } else {
        await page.mouse.move(start.x + start.width / 2, start.y + 8);
        await page.mouse.down();
        await page.mouse.move(
          destination.x + destination.width / 2,
          destination.y + 8,
          { steps: 16 },
        );
        await expect(page.locator(".dragging")).toHaveCount(1);
        await expect(page.locator(".drop-before")).toHaveCount(1);
        await page.screenshot({
          path: `test-results/order-${width}-${height}-dragging.png`,
          fullPage: true,
        });
        await page.mouse.up();
      }
      await expect.poll(() => names(page)).toEqual(["Show", "Camera", "Tech"]);
      await expect.poll(() => saves).toBe(1);
      await expect(handle).toBeEnabled();
      const camera = page.locator("article").filter({
        has: page.getByRole("heading", { name: "Camera", exact: true }),
      });
      await expect(camera.locator(".latch")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.locator(".latch[aria-pressed=true]")).toHaveCount(1);
      await expect(page.locator(".listen[aria-pressed=true]")).toHaveCount(3);
      expect(
        await page
          .locator("input[type=range]")
          .evaluateAll((els) =>
            els.every((el) => (el as HTMLInputElement).value === "1"),
          ),
      ).toBe(true);
      await camera.locator(".latch").click();
      await expect(page.locator(".ptt.active")).toHaveCount(0);
      if (width === 1920) {
        await expect
          .poll(() => names(other!))
          .toEqual(["Show", "Camera", "Tech"]);
        await expect
          .poll(() => names(observer!))
          .toEqual(["Camera", "Tech", "Show", "Audio"]);
        const fresh = await context.newPage();
        await fresh.goto("/");
        await expect
          .poll(() => names(fresh))
          .toEqual(["Show", "Camera", "Tech"]);
        await fresh.close();
        await page.bringToFront();
        // Keyboard sorting uses the same bar and persists exactly once.
        await handle.focus();
        await page.keyboard.press("Space");
        await expect(page.locator(".dragging")).toHaveCount(1);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await page.keyboard.press("ArrowRight");
        await expect(page.locator(".drop-after")).toHaveCount(1);
        await page.keyboard.press("Space");
        await expect
          .poll(() => names(page))
          .toEqual(["Camera", "Show", "Tech"]);
        await expect.poll(() => saves).toBe(2);
        await expect
          .poll(() => names(other!))
          .toEqual(["Camera", "Show", "Tech"]);
        const ptt = page.locator(".ptt").first(),
          bounds = (await ptt.boundingBox())!;
        await page.mouse.move(bounds.x + 20, bounds.y + 20);
        await page.mouse.down();
        await expect(page.locator(".ptt.active")).toHaveCount(1);
        await expect(page.locator(".channel-drag-handle:disabled")).toHaveCount(
          3,
        );
        await page.mouse.up();
        await expect(page.locator(".ptt.active")).toHaveCount(0);
        await expect(page.locator(".dragging")).toHaveCount(0);
      }
      await page.screenshot({
        path: `test-results/order-${width}-${height}-after.png`,
        fullPage: true,
      });
      const measurements = await page.evaluate(() => ({
        bottom: [...document.querySelectorAll("article")]
          .at(-1)!
          .getBoundingClientRect().bottom,
        overflow: document.documentElement.scrollWidth > innerWidth,
        height: document.documentElement.scrollHeight,
        bars: [...document.querySelectorAll(".channel-color-bar")].map(
          (e) => e.getBoundingClientRect().height,
        ),
      }));
      expect(measurements.overflow).toBe(false);
      expect(measurements.bars).toEqual([5, 5, 5]);
      if (mobile) {
        expect(measurements.bottom).toBeLessThanOrEqual(height);
        expect(measurements.height).toBeLessThanOrEqual(height);
      }
      console.log(
        `Reordered ${width}x${height}: third bottom ${measurements.bottom}`,
      );
      await page.reload();
      await expect
        .poll(() => names(page))
        .toEqual(
          width === 1920
            ? ["Camera", "Show", "Tech"]
            : ["Show", "Camera", "Tech"],
        );
      if (width === 390) {
        await page
          .getByRole("button", { name: "Application menu", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Sign out", exact: true })
          .click();
        await login(page);
        await expect
          .poll(() => names(page))
          .toEqual(["Show", "Camera", "Tech"]);
      }
    } finally {
      await otherContext?.close();
      await observerContext?.close();
      await context.close();
    }
  });
}

test("touch swipe scrolls before drag activation; cancel and save failure remain safe", async ({
  browser,
}) => {
  const context = await browser.newContext({
      viewport: { width: 390, height: 700 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage();
  try {
    await login(page, "allchannels");
    await page
      .getByRole("button", { name: "Enable Microphone", exact: true })
      .click();
    const before = await names(page),
      cdp = await context.newCDPSession(page);
    const handle = (await page
      .locator(".channel-drag-handle")
      .nth(2)
      .boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: handle.x + 50, y: handle.y + 8, id: 1 }],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: handle.x + 50, y: handle.y + 8 - i * 20, id: 1 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(40);
    expect(await names(page)).toEqual(before);
    await expect(page.locator(".dragging")).toHaveCount(0);
    await page.evaluate(() => scrollTo(0, 0));
    const first = page.locator(".channel-drag-handle").first();
    const firstBounds = (await first.boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: firstBounds.x + 50, y: firstBounds.y + 8, id: 1 }],
    });
    await page.waitForTimeout(320);
    await expect(page.locator(".dragging")).toHaveCount(1);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(page.locator(".dragging")).toHaveCount(0);
    expect(await names(page)).toEqual(before);
    await first.focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".dragging")).toHaveCount(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".drop-after")).toHaveCount(1);
    await page.keyboard.press("Escape");
    expect(await names(page)).toEqual(before);
    await page.route("**/api/me/channel-order", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 500, json: { error: "Test failure" } })
        : route.continue(),
    );
    await first.focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".dragging")).toHaveCount(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".drop-after")).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(page.getByRole("alert")).toContainText(
      "Channel order could not be saved",
    );
    await expect.poll(() => names(page)).toEqual(before);
    await expect(first).toBeEnabled();
    await cdp.detach();
  } finally {
    await context.close();
  }
});
