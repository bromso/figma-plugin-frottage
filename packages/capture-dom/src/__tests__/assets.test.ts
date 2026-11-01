import { describe, expect, test } from "bun:test";
import type { Capture, CaptureNode } from "@repo/capture-schema";
import { collectAssets, svgTargetSize } from "../assets";
import { rememberUrl } from "../urls";

const box = { x: 0, y: 0, w: 10, h: 10 };
const common = (id: string) => ({
  id,
  box,
  paintOrder: 0,
  visible: true,
  opacity: 1,
  blendMode: "normal",
  semantic: { tag: "img" },
});
const side = { width: 0, color: { r: 0, g: 0, b: 0, a: 0 }, style: "none" };
const img = (id: string, sourceUrl: string): CaptureNode => ({
  ...common(id),
  kind: "image",
  sourceUrl,
  fit: "fill",
  objectPosition: "50% 50%",
  borderRadius: [0, 0, 0, 0],
  borders: { top: side, right: side, bottom: side, left: side },
});
const el = (id: string, children: CaptureNode[], bgCss: string[] = []): CaptureNode =>
  ({
    ...common(id),
    kind: "element",
    style: {
      backgroundImages: bgCss.map((css) => ({ type: "image", css, size: "cover" })),
    },
    children,
  }) as unknown as CaptureNode;

const make = (children: CaptureNode[], bg: string[] = []): Capture =>
  ({ assets: [], warnings: [], root: el("root", children, bg) }) as unknown as Capture;
const kids = (c: Capture) => (c.root as Extract<CaptureNode, { kind: "element" }>).children;
const bgs = (c: Capture) =>
  (c.root as Extract<CaptureNode, { kind: "element" }>).style.backgroundImages;

const png = (n: number) => new Uint8Array([137, 80, 78, 71, n]);
const okNormalise = async (blob: Blob) => ({
  bytes: new Uint8Array(await blob.arrayBuffer()),
  mime: "image/png",
  width: 4,
  height: 3,
});
const blobOf = (bytes: Uint8Array) => new Blob([bytes as BlobPart]);

describe("collectAssets", () => {
  test("hashes an image, stores bytes once and fills assets", async () => {
    const c = make([img("a", "http://x/a.png"), img("b", "http://x/a.png")]);
    let fetches = 0;
    const r = await collectAssets(c, {
      fetchBytes: async () => {
        fetches++;
        return blobOf(png(1));
      },
      normalise: okNormalise,
    });
    const [a, b] = kids(r.capture) as Extract<CaptureNode, { kind: "image" }>[];
    expect(a?.assetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.assetHash).toBe(b?.assetHash);
    expect(fetches).toBe(1);
    expect(r.assets.size).toBe(1);
    expect(r.capture.assets).toEqual([
      {
        hash: a?.assetHash as string,
        mime: "image/png",
        width: 4,
        height: 3,
        sourceUrl: "http://x/a.png",
      },
    ]);
  });

  test("a URL held in memory is fetched in full and stored clean", async () => {
    const node = img("a", "http://x/a.png");
    rememberUrl(node, "http://x/a.png?token=abc#frag");
    const fetched: string[] = [];
    const r = await collectAssets(make([node]), {
      fetchBytes: async (url) => {
        fetched.push(url);
        return blobOf(png(1));
      },
      normalise: okNormalise,
    });
    expect(fetched).toEqual(["http://x/a.png?token=abc#frag"]);
    expect(r.capture.assets[0]?.sourceUrl).toBe("http://x/a.png");
    expect(JSON.stringify(r.capture)).not.toContain("token");
  });

  test("placeholders, assets, warnings and layers never keep a token", async () => {
    const c = make(
      [img("a", "https://u:p@x/a.png?token=abc"), img("b", "https://x/b.png?token=abc")],
      ['url("https://x/bg.png?token=abc")']
    );
    const r = await collectAssets(c, {
      fetchBytes: async (url) => {
        if (url.includes("/a.png")) throw new Error(`blocked ${url}`);
        if (url.includes("/bg.png")) throw new Error(`blocked ${url}`);
        return blobOf(png(1));
      },
      normalise: okNormalise,
    });
    const json = JSON.stringify(r.capture);
    expect(json).not.toContain("token");
    expect(json).not.toContain("u:p@");
    expect(kids(r.capture)[0]).toMatchObject({ sourceUrl: "https://x/a.png" });
    expect(r.capture.assets[0]?.sourceUrl).toBe("https://x/b.png");
  });

  test("two URLs with identical bytes share one asset", async () => {
    const c = make([img("a", "http://x/1.png"), img("b", "http://x/2.png")]);
    const r = await collectAssets(c, {
      fetchBytes: async () => blobOf(png(1)),
      normalise: okNormalise,
    });
    expect(r.assets.size).toBe(1);
    expect(r.capture.assets.length).toBe(1);
  });

  test("records downscaledFrom", async () => {
    const c = make([img("a", "http://x/a.png")]);
    const r = await collectAssets(c, {
      fetchBytes: async () => blobOf(png(1)),
      normalise: async (b) => ({ ...(await okNormalise(b)), downscaledFrom: { w: 5000, h: 100 } }),
    });
    expect(r.capture.assets[0]?.downscaledFrom).toEqual({ w: 5000, h: 100 });
  });

  test("a failed fetch becomes a sized placeholder with its URL and a warning", async () => {
    const c = make([img("a", "http://x/a.png")]);
    const r = await collectAssets(c, {
      fetchBytes: async () => {
        throw new TypeError("Failed to fetch");
      },
      normalise: okNormalise,
    });
    expect(kids(r.capture)[0]).toMatchObject({
      kind: "placeholder",
      placeholderKind: "blocked-image",
      sourceUrl: "http://x/a.png",
      box,
    });
    expect(r.capture.warnings.map((w) => w.code)).toEqual(["image-blocked"]);
    expect(r.assets.size).toBe(0);
  });

  test("a decode failure becomes a placeholder", async () => {
    const c = make([img("a", "http://x/a.png")]);
    const r = await collectAssets(c, {
      fetchBytes: async () => blobOf(png(1)),
      normalise: async () => {
        throw new Error("could not decode");
      },
    });
    expect(kids(r.capture)[0]?.kind).toBe("placeholder");
    expect(r.capture.warnings[0]?.code).toBe("image-failed");
  });

  test("a stalled image times out into a placeholder without hanging the rest", async () => {
    const c = make([img("a", "http://x/stall.png"), img("b", "http://x/ok.png")]);
    const r = await collectAssets(c, {
      fetchBytes: (url) =>
        url.includes("stall") ? new Promise<Blob>(() => {}) : Promise.resolve(blobOf(png(2))),
      normalise: okNormalise,
      timeoutMs: 30,
    });
    expect(kids(r.capture)[0]?.kind).toBe("placeholder");
    expect(kids(r.capture)[1]?.kind).toBe("image");
  });

  test("runs at most 6 fetches at once", async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `http://x/${i}.png`);
    const c = make(urls.map((u, i) => img(`i${i}`, u)));
    let live = 0;
    let max = 0;
    await collectAssets(c, {
      fetchBytes: async (u) => {
        live++;
        max = Math.max(max, live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return blobOf(png(u.length));
      },
      normalise: okNormalise,
    });
    expect(max).toBeLessThanOrEqual(6);
    expect(max).toBeGreaterThan(1);
  });

  test("stops at the asset budget, with one asset-limit warning", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `http://x/${i}.png`);
    const c = make(urls.map((u, i) => img(`i${i}`, u)));
    const r = await collectAssets(c, {
      fetchBytes: async (u) => blobOf(new Uint8Array(10).fill(Number(u.match(/(\d)\.png/)?.[1]))),
      normalise: okNormalise,
      budgetBytes: 25,
      concurrency: 1,
    });
    const kinds = kids(r.capture).map((n) => n.kind);
    expect(kinds).toEqual([
      "image",
      "image",
      "placeholder",
      "placeholder",
      "placeholder",
      "placeholder",
    ]);
    expect(r.capture.warnings.filter((w) => w.code === "asset-limit").length).toBe(1);
    expect(r.assets.size).toBe(2);
  });

  test("calls onProgress", async () => {
    const c = make([img("a", "http://x/a.png"), img("b", "http://x/b.png")]);
    let n = 0;
    await collectAssets(c, {
      fetchBytes: async (u) => blobOf(png(u.length)),
      normalise: okNormalise,
      onProgress: () => n++,
    });
    expect(n).toBeGreaterThanOrEqual(2);
  });

  test("fills a background image and drops a blocked one with a warning", async () => {
    const c = make([], ['url("http://x/ok.png")', 'url("http://x/bad.png")']);
    const r = await collectAssets(c, {
      fetchBytes: async (u) => {
        if (u.includes("bad")) throw new TypeError("blocked");
        return blobOf(png(3));
      },
      normalise: okNormalise,
    });
    expect(bgs(r.capture).length).toBe(1);
    expect(bgs(r.capture)[0]?.assetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.capture.warnings.map((w) => w.code)).toEqual(["background-image-dropped"]);
    expect(r.capture.assets[0]?.sourceUrl).toBe("http://x/ok.png");
  });

  test("a data URL is fetched whole but recorded short", async () => {
    const data = `data:image/png;base64,${"A".repeat(5000)}`;
    const c = make([img("a", data)]);
    let fetched = "";
    const r = await collectAssets(c, {
      fetchBytes: async (u) => {
        fetched = u;
        return blobOf(png(1));
      },
      normalise: okNormalise,
    });
    expect(fetched).toBe(data);
    expect((kids(r.capture)[0] as { sourceUrl: string }).sourceUrl.length).toBeLessThan(200);
    expect(r.capture.assets[0]?.sourceUrl.length).toBeLessThan(200);
  });
});

describe("svgTargetSize", () => {
  const natural = { w: 100, h: 100 };
  const hint = { w: 40, h: 40 };
  test("is twice the display size at a device pixel ratio of 1 or 2", () => {
    expect(svgTargetSize(natural, hint, 1)).toEqual({ w: 80, h: 80 });
    expect(svgTargetSize(natural, hint, 2)).toEqual({ w: 80, h: 80 });
  });
  test("follows a higher device pixel ratio", () => {
    const t = svgTargetSize(natural, hint, 3);
    expect(t.w).toBeCloseTo(120, 6);
    expect(t.h).toBeCloseTo(120, 6);
  });
  test("keeps the natural size without a display size", () => {
    expect(svgTargetSize({ w: 30, h: 20 }, undefined, 3)).toEqual({ w: 30, h: 20 });
  });
  test("ignores a device pixel ratio that is not a number", () => {
    expect(svgTargetSize(natural, hint, Number.NaN)).toEqual({ w: 80, h: 80 });
  });
});
