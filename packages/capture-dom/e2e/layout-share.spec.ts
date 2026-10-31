import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { Capture } from "@repo/capture-schema";
import { isReadableName, mapCapture } from "@repo/figma-mapper";

// Real captures through the real mapper, so no stored capture can go stale. Floors are frames in
// auto layout (including grid) over all frames; never lower one to make a change pass.
const FLOORS: Record<string, number> = {
  shadow: 0.7,
  landing: 48 / 52,
  article: 67 / 68,
  dashboard: 26 / 64,
};

// Share of layers whose name a person could read (not `Div`, `Span`, `Frame`, `div.flex`). The
// target on real pages is 80%; never lower a floor to make a change pass.
const NAME_FLOORS: Record<string, number> = {
  landing: 0.8,
  shadow: 0.8,
  article: 0.8,
  dashboard: 0.8,
  form: 0.8,
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

async function mapFixture(page: Page, fixture: string) {
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
  return mapCapture(JSON.parse(json) as Capture, [{ family: "Inter", style: "Regular" }]);
}

for (const [fixture, floor] of Object.entries(FLOORS)) {
  test(`${fixture} keeps its share of auto layout frames`, async ({ page }) => {
    const { ops } = await mapFixture(page, fixture);
    const frames = ops.filter((op) => op.op === "frame");
    const auto = frames.filter((op) => op.layout.mode !== "NONE");
    expect(frames.length).toBeGreaterThan(0);
    expect(auto.length / frames.length).toBeGreaterThanOrEqual(floor);
  });
}

for (const [fixture, floor] of Object.entries(NAME_FLOORS)) {
  test(`${fixture} keeps its share of readable layer names`, async ({ page }) => {
    const { ops } = await mapFixture(page, fixture);
    const bad = ops.filter((op) => !isReadableName(op.name));
    // biome-ignore lint/suspicious/noConsole: the unreadable names are the useful failure output
    console.log(
      `${fixture}: ${ops.length - bad.length}/${ops.length}`,
      bad.map((o) => o.name)
    );
    expect(ops.length).toBeGreaterThan(0);
    expect((ops.length - bad.length) / ops.length).toBeGreaterThanOrEqual(floor);
    // Text layers name themselves, so frames alone are the harder measure.
    const frames = ops.filter((op) => op.op === "frame");
    const bareFrames = frames.filter((op) => !isReadableName(op.name));
    if (process.env.DUMP_NAMES) console.log(fixture, ops.map((o) => o.name).join(" | "));
    expect((frames.length - bareFrames.length) / frames.length).toBeGreaterThanOrEqual(floor);
  });
}
