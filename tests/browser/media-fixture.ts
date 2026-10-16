import { expect, type Page } from "@playwright/test";
export function peerIdentity(page: Page) {
  return new Promise<string>((resolve) => {
    page.on("websocket", (socket) =>
      socket.on("framereceived", ({ payload }) => {
        const message = JSON.parse(payload.toString());
        if (message.type === "snapshot") resolve(message.self);
      }),
    );
  });
}
// Control the existing initial-offer timing without changing product negotiation:
// the first enabled peer is polite and accepts a later peer's offer, even if its
// own initial offer arrived before that peer acquired a microphone.
export async function enableInPeerOrder(
  peers: { page: Page; identity: Promise<string> }[],
) {
  const ordered = await Promise.all(
    peers.map(async ({ page, identity }) => ({ page, id: await identity })),
  );
  ordered.sort((a, b) => (a.id > b.id ? -1 : 1));
  for (const { page } of ordered) {
    await page
      .getByRole("button", { name: "Enable Microphone", exact: true })
      .click();
    await expect(page.locator(".audio-bar")).toHaveCount(0);
  }
}
