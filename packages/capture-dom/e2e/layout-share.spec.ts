import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Capture } from "@repo/capture-schema";
import { mapCapture } from "@repo/figma-mapper";

// Real captures through the real mapper, so no stored capture can go stale. Floors are frames in
// auto layout (including grid) over all frames; never lower one to make a change pass.
const FLOORS: Record<string, number> = {
  shadow: 0.7,
  landing: 48 / 52,
  article: 67 / 68,
  dashboard: 26 / 64,
};

let bundle = "";
test.beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "frottage-share-"));
  const out = join(dir, "walk.js");
  execFileSync(
    "bun",
    [
      "build",
      fileURLToPath(new URL("./entry.ts", import.meta.url)),
      "--target=browser",
      "--format=iife",
      `--outfile=${out}`,
    ],
    { stdio: "pipe" }
  );
  bundle = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
});

for (const [fixture, floor] of Object.entries(FLOORS)) {
  test(`${fixture} keeps its share of auto layout frames`, async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto(`/${fixture}.html`);
    await page.addScriptTag({ content: bundle });
    const json = await page.evaluate(() =>
      JSON.stringify(
        (
          globalThis as unknown as {
            __frottageCapture: {
              captureDocument: (d: Document, e: object) => Capture;
            };
          }
        ).__frottageCapture.captureDocument(document, {
          now: () => "2026-01-01T00:00:00.000Z",
          toolVersion: "test",
        })
      )
    );
    const { ops } = mapCapture(JSON.parse(json) as Capture, [
      { family: "Inter", style: "Regular" },
    ]);
    const frames = ops.filter((op) => op.op === "frame");
    const auto = frames.filter((op) => op.layout.mode !== "NONE");
    expect(frames.length).toBeGreaterThan(0);
    expect(auto.length / frames.length).toBeGreaterThanOrEqual(floor);
  });
}
