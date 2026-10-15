import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/desktop",
  outputDir: "./desktop-test-results",
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: "list",
});
