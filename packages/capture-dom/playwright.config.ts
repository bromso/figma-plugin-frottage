import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "{testDir}/__snapshots__/{arg}{ext}",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  },
  // serve.ts also opens :4174, the no-CORS image origin used by assets.spec.ts.
  webServer: {
    command: "bun fixtures/serve.ts",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
