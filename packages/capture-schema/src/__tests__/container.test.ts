import { describe, expect, test } from "bun:test";
import { strToU8, Unzip, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import {
  type Capture,
  type FrottageErrorCode,
  FrottageFileError,
  LIMITS,
  PUSH_SLICE_BYTES,
  packFrottage,
  unpackFrottage,
} from "../index";
import { elementNode, minimalCapture, textNode, treeOfThree } from "./fixtures";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const sample: Capture = { ...minimalCapture(), root: treeOfThree() };

function expectCode(fn: () => unknown, code: FrottageErrorCode) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(FrottageFileError);
  expect((caught as FrottageFileError).code).toBe(code);
}

function packRaw(json: unknown): Uint8Array {
  return zipSync({ "capture.json": strToU8(JSON.stringify(json)) });
}

function captureUsingAsset(hash: string): Capture {
  const image = {
    ...textNode("img"),
    kind: "image",
    fit: "cover",
    objectPosition: "50% 50%",
    assetHash: hash,
  };
  return { ...minimalCapture(), root: elementNode("root", [image as never]) };
}

function captureUsingBackgroundAsset(hash: string): Capture {
  const base = elementNode("bg") as unknown as { style: { backgroundImages: unknown[] } };
  base.style.backgroundImages = [{ type: "image", css: "url(x)", assetHash: hash }];
  return { ...minimalCapture(), root: elementNode("root", [base as never]) };
}

/** Rewrite the uncompressed-size field in every local and central header. */
function withFalseUncompressedSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  let patched = 0;
  for (let i = 0; i + 4 <= out.length; i++) {
    if (view.getUint32(i, true) === 0x04034b50) {
      view.setUint32(i + 22, size, true);
      patched++;
    } else if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, size, true);
      patched++;
    }
  }
  expect(patched).toBeGreaterThanOrEqual(2);
  return out;
}

describe("unpackFrottage", () => {
  test("round-trips a capture and its assets", () => {
    const { capture, assets } = unpackFrottage(packFrottage(sample, new Map([["abc", png]])));
    expect(capture).toEqual(sample);
    expect(assets.get("abc")).toEqual(png);
  });

  test("rejects bytes that are not a ZIP", () => {
    expectCode(() => unpackFrottage(new Uint8Array([1, 2, 3])), "not-a-frottage-file");
  });

  test("rejects a truncated ZIP", () => {
    const zip = packFrottage(sample, new Map([["abc", png]]));
    expectCode(() => unpackFrottage(zip.slice(0, 40)), "not-a-frottage-file");
  });

  test("rejects a ZIP with no capture.json", () => {
    expectCode(() => unpackFrottage(zipSync({ "x.txt": strToU8("hi") })), "not-a-frottage-file");
  });

  test("stops at the limit when an entry inflates past it", () => {
    const bomb = zipSync({ "capture.json": new Uint8Array(4096) });
    expectCode(() => unpackFrottage(bomb, { ...LIMITS, captureJsonBytes: 1024 }), "too-large");
  });

  test("stops at the limit when ZIP headers understate the size", () => {
    const bomb = zipSync({ "capture.json": new Uint8Array(4096) });
    const lying = withFalseUncompressedSize(bomb, 10);
    expectCode(() => unpackFrottage(lying, { ...LIMITS, captureJsonBytes: 1024 }), "too-large");
  });

  test("counts stored entries too", () => {
    const stored = zipSync({ "capture.json": [new Uint8Array(4096), { level: 0 }] });
    expectCode(() => unpackFrottage(stored, { ...LIMITS, captureJsonBytes: 1024 }), "too-large");
    const lying = withFalseUncompressedSize(stored, 10);
    expectCode(() => unpackFrottage(lying, { ...LIMITS, captureJsonBytes: 1024 }), "too-large");
  });

  test("enforces the total byte limit across assets", () => {
    const zip = packFrottage(
      sample,
      new Map([
        ["a", png],
        ["b", png],
      ])
    );
    expectCode(() => unpackFrottage(zip, { ...LIMITS, totalBytes: 100 }), "too-large");
  });

  test("rejects too many nodes", () => {
    expectCode(
      () => unpackFrottage(packFrottage(sample, new Map()), { ...LIMITS, nodes: 1 }),
      "too-many-nodes"
    );
  });

  test("reports a newer version", () => {
    expectCode(() => unpackFrottage(packRaw({ schemaVersion: 2 })), "newer-version");
  });

  test("rejects invalid JSON and invalid captures", () => {
    expectCode(
      () => unpackFrottage(zipSync({ "capture.json": strToU8("{nope") })),
      "invalid-capture"
    );
    expectCode(() => unpackFrottage(packRaw({ schemaVersion: 1 })), "invalid-capture");
  });

  test("rejects a capture that names a missing asset", () => {
    expectCode(
      () => unpackFrottage(packFrottage(captureUsingAsset("abc"), new Map())),
      "missing-asset"
    );
  });

  test("rejects a missing background-image asset", () => {
    expectCode(
      () => unpackFrottage(packFrottage(captureUsingBackgroundAsset("bgh"), new Map())),
      "missing-asset"
    );
    const ok = unpackFrottage(
      packFrottage(captureUsingBackgroundAsset("bgh"), new Map([["bgh", png]]))
    );
    expect(ok.assets.has("bgh")).toBe(true);
  });

  test("ignores unexpected entries and never treats names as paths", () => {
    const zip = zipSync({
      "capture.json": strToU8(JSON.stringify(sample)),
      "../../evil.txt": strToU8("x"),
      "assets/../../evil.png": png,
      "assets/abc.exe": png,
      "assets/ok.png": [png, { level: 0 }],
    });
    const { assets } = unpackFrottage(zip);
    expect([...assets.keys()]).toEqual(["ok"]);
  });

  test("reads data-descriptor entries across slices", () => {
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      parts.push(chunk);
    });
    const json = new ZipDeflate("capture.json", { level: 6 });
    zip.add(json);
    json.push(strToU8(JSON.stringify(sample)), true);
    const asset = new ZipPassThrough("assets/abc.png");
    zip.add(asset);
    const bigAsset = new Uint8Array(100_000).map((_, i) => (i * 31) % 251);
    bigAsset.set(png);
    asset.push(bigAsset, true);
    zip.end();
    const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of parts) {
      out.set(c, off);
      off += c.length;
    }
    const result = unpackFrottage(out);
    expect(result.capture).toEqual(sample);
    expect(result.assets.get("abc")).toEqual(bigAsset);
    expect(() => unpackFrottage(out, { ...LIMITS, captureJsonBytes: 100 })).toThrow();
  });

  test("pushes small slices and stops pushing after a failure", () => {
    const bomb = zipSync({ "capture.json": new Uint8Array(8 * 1024 * 1024) });
    const big = new Uint8Array(bomb.length + 200_000);
    big.set(bomb);
    const original = Unzip.prototype.push;
    const sizes: number[] = [];
    let failedAt = -1;
    Unzip.prototype.push = function (this: Unzip, chunk: Uint8Array, final?: boolean) {
      sizes.push(chunk.length);
      return original.call(this, chunk, final);
    };
    try {
      expectCode(() => unpackFrottage(big, { ...LIMITS, captureJsonBytes: 1024 }), "too-large");
      failedAt = sizes.length;
    } finally {
      Unzip.prototype.push = original;
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(PUSH_SLICE_BYTES);
    // The bomb's compressed bytes fit in the first slice or two; the 200 kB of
    // trailing bytes must never be pushed once the limit has fired.
    expect(failedAt).toBeLessThan(Math.ceil(big.length / PUSH_SLICE_BYTES));
  });

  test("rejects a 5,000-deep capture as too-deep", () => {
    expectCode(() => unpackFrottage(zipWithRaw(deepJson(5000))), "too-deep");
  });

  test("accepts a capture 200 levels deep", () => {
    const { capture } = unpackFrottage(zipWithRaw(deepJson(200)));
    let depth = 0;
    let node = capture.root;
    while (node.kind === "element" && node.children[0]) {
      depth++;
      node = node.children[0];
    }
    expect(depth).toBe(200);
  });

  test("rejects too many nodes before the full parse", () => {
    const wide = JSON.stringify({
      ...minimalCapture(),
      root: { ...elementNode("r"), children: Array.from({ length: 50 }, () => ({ junk: true })) },
    });
    expectCode(() => unpackFrottage(zipWithRaw(wide), { ...LIMITS, nodes: 10 }), "too-many-nodes");
  });

  test("rejects a repeated capture.json", () => {
    const body = strToU8(JSON.stringify(sample));
    const zip = zipSync({ "capture.json": body, captureXjson: body });
    const marker = strToU8("captureXjson");
    const target = strToU8("capture.json");
    for (let i = 0; i + marker.length <= zip.length; i++) {
      if (marker.every((b, j) => zip[i + j] === b)) zip.set(target, i);
    }
    expectCode(() => unpackFrottage(zip), "not-a-frottage-file");
  });

  test("rejects a repeated asset hash with different extensions", () => {
    const zip = zipSync({
      "capture.json": strToU8(JSON.stringify(sample)),
      "assets/a.png": png,
      "assets/a.jpg": png,
    });
    expectCode(() => unpackFrottage(zip), "not-a-frottage-file");
  });

  test("caps the message of an invalid capture", () => {
    const bad = { ...minimalCapture(), fonts: Array.from({ length: 2000 }, () => ({ family: 1 })) };
    let caught: unknown;
    try {
      unpackFrottage(packRaw(bad));
    } catch (e) {
      caught = e;
    }
    expect((caught as FrottageFileError).code).toBe("invalid-capture");
    expect((caught as FrottageFileError).message.length).toBeLessThanOrEqual(500);
  });

  test("FrottageFileError has a default message per code", () => {
    expect(new FrottageFileError("too-large").message.length).toBeGreaterThan(0);
  });
});

function zipWithRaw(json: string): Uint8Array {
  return zipSync({ "capture.json": strToU8(json) });
}

/** A capture whose root is an element chain `levels` deep, built as a string. */
function deepJson(levels: number): string {
  const proto = JSON.stringify(elementNode("n"));
  const i = proto.lastIndexOf('"children":[]');
  const pre = `${proto.slice(0, i)}"children":[`;
  const post = `]${proto.slice(i + 13)}`;
  const inner =
    pre.repeat(levels - 1) + JSON.stringify(elementNode("leaf")) + post.repeat(levels - 1);
  const wrapped = `${pre}${inner}${post}`;
  return JSON.stringify({ ...minimalCapture(), root: "@@" }).replace('"@@"', wrapped);
}
