import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { type Capture, type CaptureNode, parseCapture } from "@repo/capture-schema";
import { mapCapture } from "@repo/figma-mapper";

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

async function runAssets(page: Page, file: string, setup?: () => void): Promise<Result> {
  await page.goto(`/${file}`);
  if (setup) await page.evaluate(setup);
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

function videos(c: Capture) {
  const out: CaptureNode[] = [];
  const go = (n: CaptureNode) => {
    if (n.semantic.tag === "video") out.push(n);
    if (n.kind === "element") for (const child of n.children) go(child);
  };
  go(c.root);
  return out;
}

test("a video with a poster becomes an image whose bytes are stored", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  const poster = videos(r.capture).find((n) => n.box.w === 120);
  expect(poster).toMatchObject({
    kind: "image",
    sourceUrl: "http://localhost:4173/assets/photo.png",
  });
  const hash = poster?.kind === "image" ? poster.assetHash : undefined;
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  // The poster is the same file as the local PNG, so it is stored once.
  expect(hash).toBe(findImage(r.capture, "local-png").assetHash);
  expect(JSON.stringify(r.capture)).not.toContain("poster=1");
});

test("a CORS-blocked poster becomes a blocked-image placeholder", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  const poster = videos(r.capture).find((n) => n.box.w === 90);
  expect(poster).toMatchObject({
    kind: "placeholder",
    placeholderKind: "blocked-image",
    sourceUrl: "http://localhost:4174/assets/photo.png",
  });
  expect(poster?.box.h).toBe(70);
  expect(JSON.stringify(r.capture)).not.toContain("poster=2");
  expect(parseCapture(r.capture).ok).toBe(true);
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

test("a JPEG with an EXIF rotation is re-encoded so its size matches how it is shown", async ({
  page,
}) => {
  const a = assetFor(await runAssets(page, "images.html"), "exif");
  expect(a.mime).toBe("image/jpeg");
  expect([a.width, a.height]).toEqual([20, 40]);
});

test("a shared 2 MB data URI background is not repeated in capture.json and is stored once", async ({
  page,
}) => {
  const r = await runAssets(page, "landing.html", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 700;
    canvas.height = 700;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const data = ctx.createImageData(700, 700);
    for (let i = 0; i < data.data.length; i += 65536) {
      crypto.getRandomValues(data.data.subarray(i, i + 65536));
    }
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255;
    ctx.putImageData(data, 0, 0);
    const url = canvas.toDataURL("image/png");
    if (url.length < 1_500_000) throw new Error(`data URL only ${url.length} chars`);
    for (let i = 0; i < 40; i++) {
      const d = document.createElement("div");
      d.style.cssText = `width:20px;height:20px;background-image:url("${url}")`;
      document.body.append(d);
    }
  });
  const json = JSON.stringify(r.capture);
  expect(json.length).toBeLessThan(2_000_000);
  expect(json).not.toContain("base64,AAAA");
  const layers = bgLayersAll(r.capture);
  expect(layers.length).toBe(40);
  expect(new Set(layers.map((l) => l.assetHash)).size).toBe(1);
  expect(layers[0]?.css.length).toBeLessThan(200);
  expect(r.capture.assets.length).toBe(1);
  expect(r.assets.size).toBe(1);
  expect(r.capture.assets[0]?.sourceUrl.length).toBeLessThan(200);
});

test("no query, fragment or userinfo reaches the capture or the plan, and fetches keep them", async ({
  page,
}) => {
  await page.goto("/secrets.html");
  await page.addScriptTag({ content: bundle });
  const out = await page.evaluate(async () => {
    const h = (globalThis as unknown as Hook).__frottageCapture;
    const capture = h.captureDocument(document, { now: () => "x", toolVersion: "test" });
    const walked = JSON.stringify(capture);
    const fetched: string[] = [];
    await h.collectAssets(capture, {
      fetchBytes: (url: string, signal?: AbortSignal) => {
        fetched.push(url);
        return (h.browserFetchBytes as (u: string, s?: AbortSignal) => Promise<Blob>)(url, signal);
      },
      normalise: h.browserNormalise,
    });
    return { walked, collected: JSON.stringify(capture), fetched };
  });
  const capture = JSON.parse(out.collected) as Capture;
  const plan = JSON.stringify(mapCapture(capture, [{ family: "Inter", style: "Regular" }]));
  for (const text of [out.walked, out.collected, plan]) {
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("sig=abc");
  }
  expect(parseCapture(capture).ok).toBe(true);
  expect(capture.source.url).toBe("http://localhost:4173/secrets.html");

  // The stored forms stay useful.
  const blocked = findNode(capture, "blocked");
  expect(blocked).toMatchObject({
    kind: "placeholder",
    sourceUrl: "http://localhost:4174/assets/logo.svg",
  });
  expect(findImage(capture, "ok").assetHash).toMatch(/^[0-9a-f]{64}$/);
  expect(capture.assets.every((a) => !a.sourceUrl.includes("?"))).toBe(true);
  const hrefs: string[] = [];
  const go = (n: CaptureNode) => {
    if (n.semantic.href) hrefs.push(n.semantic.href);
    if (n.kind === "element") n.children.forEach(go);
  };
  go(capture.root);
  expect(hrefs).toEqual([
    "http://localhost:4173/reset",
    "http://localhost:4173/account",
    "mailto:ada@example.com",
    "javascript:",
    "http://localhost:4173/reset",
    "http://cdn.test/x",
    "https://a.test/x,y",
    "https://a.test/(x)",
  ]);

  // Only the capture is cleaned: the page's own requests still carry their tokens.
  expect(out.fetched).toEqual(
    expect.arrayContaining([
      expect.stringContaining("token=SECRET-IMG-TOKEN"),
      expect.stringContaining("token=SECRET-BG-TOKEN"),
      expect.stringContaining("token=SECRET-SET-TOKEN"),
    ])
  );
});

test("a huge data: link is stored as a short form", async ({ page }) => {
  const r = await runAssets(page, "form.html", () => {
    const a = document.createElement("a");
    a.textContent = "Export";
    a.style.display = "block";
    a.href = `data:text/csv;base64,${"A".repeat(2_000_000)}`;
    document.body.append(a);
  });
  const json = JSON.stringify(r.capture);
  expect(json.length).toBeLessThan(200_000);
  expect(json).toContain("[2000021 chars]");
});

function bgLayersAll(c: Capture) {
  const out: Extract<CaptureNode, { kind: "element" }>["style"]["backgroundImages"] = [];
  const go = (n: CaptureNode) => {
    if (n.kind !== "element") return;
    out.push(...n.style.backgroundImages);
    for (const child of n.children) go(child);
  };
  go(c.root);
  return out;
}
