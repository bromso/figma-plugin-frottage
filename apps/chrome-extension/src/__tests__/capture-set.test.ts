import { describe, expect, test } from "bun:test";
import { type Capture, unpackFrottageSet } from "@repo/capture-schema";
import { CaptureSet } from "../capture-set";

const hash = (c: string) => c.repeat(64);
const none = { r: 0, g: 0, b: 0, a: 0 };
const noBorder = { width: 0, color: none, style: "none" };
const root = {
  id: "root",
  kind: "element",
  box: { x: 0, y: 0, w: 100, h: 50 },
  paintOrder: 0,
  visible: true,
  opacity: 1,
  blendMode: "normal",
  semantic: { tag: "div" },
  style: {
    backgroundColor: none,
    backgroundImages: [],
    borders: { top: noBorder, right: noBorder, bottom: noBorder, left: noBorder },
    borderRadius: [0, 0, 0, 0],
    boxShadows: [],
    filters: [],
    overflow: "visible",
  },
  layout: {
    display: "block",
    position: "static",
    padding: [0, 0, 0, 0],
    margin: [0, 0, 0, 0],
    order: 0,
    grow: 0,
    shrink: 1,
  },
  children: [],
} as unknown as Capture["root"];

const capture = (assets: string[] = [], pad = ""): Capture => ({
  schemaVersion: 1,
  capturedAt: "2026-10-31T00:00:00.000Z",
  tool: { name: "frottage", version: "0.0.0" },
  source: {
    url: "https://example.com/",
    title: pad,
    viewport: { w: 1280, h: 800 },
    scrollSize: { w: 1280, h: 2000 },
    devicePixelRatio: 2,
    colorScheme: "light",
  },
  tokens: { cssCustomProperties: {} },
  fonts: [],
  assets: assets.map((hash) => ({ hash, mime: "image/png", width: 1, height: 1, sourceUrl: "" })),
  warnings: [],
  root,
});
const bytes = (n: number) => {
  const b = new Uint8Array(n).fill(7);
  b.set([0x89, 0x50, 0x4e, 0x47]);
  return b;
};

describe("CaptureSet", () => {
  test("an image in every capture counts once", () => {
    const set = new CaptureSet({ totalBytes: 1_000_000, assetBytes: 15 });
    const a = hash("a");
    for (let i = 0; i < 3; i++) {
      expect(set.add(capture([a]), new Map([[a, bytes(10)]]))).toBe(true);
    }
    expect(set.size).toBe(3);
  });

  test("a capture past either limit is refused and leaves the set as it was", () => {
    const set = new CaptureSet({ totalBytes: 1_000_000, assetBytes: 15 });
    const [a, b] = [hash("a"), hash("b")];
    expect(set.add(capture([a]), new Map([[a, bytes(10)]]))).toBe(true);
    expect(set.add(capture([b]), new Map([[b, bytes(10)]]))).toBe(false);
    expect(set.size).toBe(1);
    const tight = new CaptureSet({ totalBytes: 600, assetBytes: 1_000_000 });
    expect(tight.add(capture([], "x".repeat(1000)), new Map())).toBe(false);
    expect(tight.size).toBe(0);
    const unpacked = unpackFrottageSet(set.pack());
    expect(unpacked.captures).toHaveLength(1);
    expect([...unpacked.assets.keys()]).toEqual([a]);
  });

  test("JSON counts towards the total", () => {
    const json = new TextEncoder().encode(JSON.stringify(capture())).length;
    const set = new CaptureSet({ totalBytes: json * 2 - 1, assetBytes: 1_000_000 });
    expect(set.add(capture(), new Map())).toBe(true);
    expect(set.add(capture(), new Map())).toBe(false);
    expect(set.size).toBe(1);
  });
});
