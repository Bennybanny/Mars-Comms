import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8190",
    browserName: "chromium",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    permissions: ["microphone"],
  },
  webServer: {
    command: "npx tsx tests/browser-server.ts",
    url: "http://127.0.0.1:8190",
    reuseExistingServer: false,
  },
  reporter: "list",
});
