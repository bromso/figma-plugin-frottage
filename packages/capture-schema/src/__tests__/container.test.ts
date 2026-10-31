import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { type Capture, FrottageFileError, LIMITS, packFrottage, unpackFrottage } from "../index";
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
});
