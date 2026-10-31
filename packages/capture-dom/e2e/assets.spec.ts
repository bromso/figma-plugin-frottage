import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { type Capture, type CaptureNode, parseCapture } from "@repo/capture-schema";

// The page bundle is built the same way as in walk.spec.ts and carries no Zod.
let bundle = "";
test.beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "frottage-assets-"));
  const out = join(dir, "bundle.js");
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

type Hook = {
  __frottageCapture: {
    captureDocument: (doc: Document, env: { now: () => string; toolVersion: string }) => Capture;
    collectAssets: (
      capture: Capture,
      deps: { fetchBytes: unknown; normalise: unknown; onProgress?: () => void }
    ) => Promise<{ capture: Capture; assets: Map<string, Uint8Array> }>;
    browserFetchBytes: unknown;
    browserNormalise: unknown;
  };
};

type Result = {
  capture: Capture;
  assets: Map<string, { length: number; head: string }>;
  progress: number;
};

async function runAssets(page: Page, file: string): Promise<Result> {
  await page.goto(`/${file}`);
  await page.addScriptTag({ content: bundle });
  const json = await page.evaluate(async () => {
    const h = (globalThis as unknown as Hook).__frottageCapture;
    const capture = h.captureDocument(document, {
      now: () => "2026-01-01T00:00:00.000Z",
      toolVersion: "test",
    });
    let progress = 0;
    const r = await h.collectAssets(capture, {
      fetchBytes: h.browserFetchBytes,
      normalise: h.browserNormalise,
      onProgress: () => progress++,
    });
    const assets = [...r.assets].map(([hash, b]) => [
      hash,
      b.length,
      [...b.subarray(0, 4)].map((x) => x.toString(16).padStart(2, "0")).join(""),
    ]);
    return JSON.stringify({ capture: r.capture, assets, progress });
  });
  const parsed = JSON.parse(json) as {
    capture: Capture;
    assets: [string, number, string][];
    progress: number;
  };
  return {
    capture: parsed.capture,
    progress: parsed.progress,
    assets: new Map(parsed.assets.map(([hash, length, head]) => [hash, { length, head }])),
  };
}

function findNode(c: Capture, alt: string): CaptureNode {
  let hit: CaptureNode | undefined;
  const go = (n: CaptureNode) => {
    if (!hit && n.semantic.alt === alt) hit = n;
    if (n.kind === "element") for (const child of n.children) go(child);
  };
  go(c.root);
  if (!hit) throw new Error(`no node with alt ${alt}`);
  return hit;
}
function findImage(c: Capture, alt: string) {
  const n = findNode(c, alt);
  if (n.kind !== "image") throw new Error(`${alt} is a ${n.kind}`);
  return n;
}
function assetFor(r: Result, alt: string) {
  const hash = findImage(r.capture, alt).assetHash;
  const a = r.capture.assets.find((x) => x.hash === hash);
  if (!a) throw new Error(`no asset for ${alt}`);
  return a;
}
function bgLayers(c: Capture, id: string) {
  const out: Extract<CaptureNode, { kind: "element" }>[] = [];
  const go = (n: CaptureNode) => {
    if (n.kind !== "element") return;
    if (
      n.style.backgroundImages.some((l) => l.css.includes(id)) ||
      n.style.backgroundImages.length > 0
    )
      out.push(n);
    for (const child of n.children) go(child);
  };
  go(c.root);
  return out;
}
const fixtureSize = (name: string) =>
  statSync(fileURLToPath(new URL(`../fixtures/assets/${name}`, import.meta.url))).size;

test("a same-origin PNG gets a hash and bytes", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  expect(r.assets.size).toBeGreaterThan(0);
  const hash = findImage(r.capture, "local-png").assetHash;
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  // PNG bytes pass through unchanged.
  expect(r.assets.get(hash as string)).toEqual({
    length: fixtureSize("photo.png"),
    head: "89504e47",
  });
  expect(r.progress).toBeGreaterThan(0);
});

test("WebP becomes PNG", async ({ page }) => {
  const a = assetFor(await runAssets(page, "images.html"), "local-webp");
  expect(a.mime).toBe("image/png");
  expect([a.width, a.height]).toEqual([120, 80]);
});

test("GIF keeps its bytes", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  expect(assetFor(r, "local-gif").mime).toBe("image/gif");
  expect(r.assets.get(findImage(r.capture, "local-gif").assetHash as string)?.length).toBe(
    fixtureSize("dot.gif")
  );
});

test("an SVG becomes a PNG at twice its display size", async ({ page }) => {
  const a = assetFor(await runAssets(page, "images.html"), "local-svg");
  expect(a.mime).toBe("image/png");
  expect([a.width, a.height]).toEqual([80, 80]);
});

test("a data: URI image is captured with a short source URL", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  expect(assetFor(r, "data-uri").mime).toBe("image/gif");
  expect(findImage(r.capture, "data-uri").sourceUrl?.length).toBeLessThan(200);
});

test("an oversized image is downscaled to 4096 and recorded", async ({ page }) => {
  const a = assetFor(await runAssets(page, "images.html"), "huge");
  expect(a.width).toBe(4096);
  expect(a.height).toBe(82);
  expect(a.mime).toBe("image/png");
  expect(a.downscaledFrom).toEqual({ w: 5000, h: 100 });
});

test("a CORS-blocked image becomes a sized placeholder with its URL", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  const n = findNode(r.capture, "blocked");
  expect(n).toMatchObject({
    kind: "placeholder",
    placeholderKind: "blocked-image",
    sourceUrl: expect.stringContaining(":4174/"),
  });
  expect(n.box.w).toBe(90);
  expect(n.box.h).toBe(60);
  expect(r.capture.warnings.some((w) => w.code === "image-blocked")).toBe(true);
});

test("the same image used twice is stored once", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  const a = findImage(r.capture, "dup-a").assetHash;
  expect(a).toBeDefined();
  expect(a).toBe(findImage(r.capture, "dup-b").assetHash);
  expect(a).toBe(findImage(r.capture, "local-png").assetHash);
  expect(r.capture.assets.filter((x) => x.hash === a).length).toBe(1);
});

test("background images get a hash; a blocked one is dropped with a warning", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  const layers = bgLayers(r.capture, "").flatMap((e) => e.style.backgroundImages);
  expect(layers.length).toBe(2);
  for (const l of layers) expect(l.assetHash).toMatch(/^[0-9a-f]{64}$/);
  expect(layers.map((l) => l.repeat).sort()).toEqual(["no-repeat", "repeat"]);
  expect(r.capture.warnings.some((w) => w.code === "background-image-dropped")).toBe(true);
});

test("every asset is listed once and the capture still parses", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  expect(parseCapture(r.capture).ok).toBe(true);
  expect(new Set(r.capture.assets.map((a) => a.hash)).size).toBe(r.capture.assets.length);
  expect([...r.assets.keys()].sort()).toEqual(r.capture.assets.map((a) => a.hash).sort());
});
