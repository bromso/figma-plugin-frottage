import { describe, expect, test } from "bun:test";
import { strToU8, Unzip, unzipSync, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import {
  type Capture,
  captureSchema,
  type FrottageErrorCode,
  FrottageFileError,
  LIMITS,
  packFrottage,
  packFrottageSet,
  parseCapture,
  unpackFrottage,
  unpackFrottageSet,
} from "../index";
import { elementNode, imageStyle, minimalCapture, textNode, treeOfThree } from "./fixtures";

const SLICE = 16 * 1024;
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
    ...imageStyle,
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
    expectCode(() => unpackFrottage(out, { ...LIMITS, captureJsonBytes: 100 }), "too-large");
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
    expect(Math.max(...sizes)).toBeLessThanOrEqual(SLICE);
    // The bomb's compressed bytes fit in the first slice or two; the 200 kB of
    // trailing bytes must never be pushed once the limit has fired.
    expect(failedAt).toBeLessThan(Math.ceil(big.length / SLICE));
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

  test("FrottageFileError caps long messages", () => {
    expect(new FrottageFileError("invalid-capture", "x".repeat(5000)).message.length).toBe(500);
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

/** Exactly `n` element levels, the deepest a leaf with no children. */
function chainJson(n: number): string {
  return chainWithChildren(n - 1, JSON.stringify(elementNode("leaf")));
}

function repeatJoin(item: string, count: number): string {
  return `${`${item},`.repeat(count - 1)}${item}`;
}

/** Element chain `depth` levels deep, then `body` as the children of the deepest. */
function chainWithChildren(depth: number, body: string): string {
  const proto = JSON.stringify(elementNode("n"));
  const i = proto.lastIndexOf('"children":[]');
  const pre = `${proto.slice(0, i)}"children":[`;
  const post = `]${proto.slice(i + 13)}`;
  return `${pre.repeat(depth)}${body}${post.repeat(depth)}`;
}

function withRoot(rootJson: string, patch?: (json: string) => string): Uint8Array {
  const json = JSON.stringify({ ...minimalCapture(), root: "@@" }).replace('"@@"', rootJson);
  return zipWithRaw(patch ? patch(json) : json);
}

function timed(fn: () => unknown, code: FrottageErrorCode) {
  const start = performance.now();
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  const ms = performance.now() - start;
  expect(caught).toBeInstanceOf(FrottageFileError);
  expect((caught as FrottageFileError).code).toBe(code);
  expect((caught as FrottageFileError).message.length).toBeLessThanOrEqual(500);
  expect(ms).toBeLessThan(2000);
}

describe("depth boundary", () => {
  test("accepts 256 levels and rejects 257", () => {
    expect(() => unpackFrottage(withRoot(chainJson(256)))).not.toThrow();
    expectCode(() => unpackFrottage(withRoot(chainJson(257))), "too-deep");
  });

  test("honours a smaller depth limit exactly", () => {
    const limits = { ...LIMITS, depth: 5 };
    expect(() => unpackFrottage(withRoot(chainJson(5)), limits)).not.toThrow();
    expectCode(() => unpackFrottage(withRoot(chainJson(6)), limits), "too-deep");
  });

  test("honours the node limit exactly", () => {
    const three = JSON.stringify(treeOfThree());
    expect(() => unpackFrottage(withRoot(three), { ...LIMITS, nodes: 3 })).not.toThrow();
    expectCode(() => unpackFrottage(withRoot(three), { ...LIMITS, nodes: 2 }), "too-many-nodes");
  });
});

describe("hostile captures fail fast with a coded error", () => {
  test("a 1 MiB fonts array of {}", () => {
    const fonts = `[${repeatJoin("{}", Math.floor((1024 * 1024) / 3))}]`;
    const zip = withRoot(JSON.stringify(elementNode("r")), (j) =>
      j.replace('"fonts":[]', `"fonts":${fonts}`)
    );
    timed(() => unpackFrottage(zip), "invalid-capture");
  });

  test("children made of scalars", () => {
    const zip = withRoot(chainWithChildren(1, repeatJoin("1", 500_000)));
    timed(() => unpackFrottage(zip), "invalid-capture");
  });

  test("a single text node with a huge runs array of {}", () => {
    const text = JSON.stringify(textNode("t")).replace(
      /"runs":\[.*\]\}$/,
      `"runs":[${repeatJoin("{}", 300_000)}]}`
    );
    timed(() => unpackFrottage(withRoot(text)), "invalid-capture");
  });

  test("19,700 invalid leaves under a legal 255-level chain", () => {
    const zip = withRoot(chainWithChildren(255, repeatJoin('{"kind":"element"}', 19_700)));
    timed(() => unpackFrottage(zip), "invalid-capture");
  });

  test("a huge filters array of numbers", () => {
    const el = JSON.stringify(elementNode("e")).replace(
      '"filters":[]',
      `"filters":[${repeatJoin("1", 500_000)}]`
    );
    timed(() => unpackFrottage(withRoot(el)), "invalid-capture");
  });
});

describe("parseCapture", () => {
  test("agrees with captureSchema on a full valid capture", () => {
    const color = { r: 0.1, g: 0.2, b: 0.3, a: 1 };
    const el = elementNode("e") as unknown as {
      style: { backgroundImages: unknown[]; boxShadows: unknown[]; filters: string[] };
    };
    el.style.backgroundImages = [
      {
        type: "linear-gradient",
        css: "x",
        angle: 90,
        stops: [
          { color, position: 0 },
          { color, position: 1 },
        ],
      },
      { type: "image", css: "url(a)", assetHash: "abc" },
    ];
    el.style.boxShadows = [{ inset: false, x: 1, y: 2, blur: 3, spread: 4, color }];
    el.style.filters = ["blur(2px)"];
    const base = textNode("t") as unknown as Record<string, unknown>;
    const image = {
      ...base,
      ...imageStyle,
      id: "i",
      kind: "image",
      fit: "cover",
      objectPosition: "0 0",
      assetHash: "abc",
      extra: 1,
    };
    const svg = { ...base, id: "s", kind: "svg", markup: "<svg/>" };
    const ph = { ...base, id: "p", kind: "placeholder", placeholderKind: "canvas" };
    const full = {
      ...minimalCapture(),
      unknownTopLevel: true,
      tokens: { cssCustomProperties: { "--a": "1", "--b": "2" } },
      fonts: [{ family: "Inter", weight: 400, style: "normal", loadedAsWebFont: false }],
      assets: [
        {
          hash: "abc",
          mime: "image/png",
          width: 1,
          height: 2,
          sourceUrl: "u",
          downscaledFrom: { w: 4, h: 4 },
        },
      ],
      warnings: [{ code: "w", nodeId: "t", detail: "d" }],
      root: elementNode("root", [
        el as never,
        textNode("t"),
        image as never,
        svg as never,
        ph as never,
      ]),
    };
    const viaSchema = captureSchema.parse(full);
    const result = parseCapture(full);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capture).toEqual(viaSchema);
  });

  test("is safe to call directly on hostile input", () => {
    const root = JSON.parse(chainWithChildren(1, repeatJoin("1", 100_000)));
    const result = parseCapture({ ...minimalCapture(), root });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (!result.ok) expect(result.detail.length).toBeLessThanOrEqual(500);
  });
});

/** An array whose item reads are counted: a whole-array check reads them all. */
function countedArray(length: number, item: () => unknown) {
  let reads = 0;
  const target = Array.from({ length }, item);
  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) reads++;
      return Reflect.get(t, prop, receiver);
    },
  });
  return { proxy, reads: () => reads };
}

function elementWith(style: Record<string, unknown>) {
  const el = elementNode("e") as unknown as { style: Record<string, unknown> };
  Object.assign(el.style, style);
  return el;
}

describe("bounded validation reads a hostile list only up to the first failure", () => {
  const N = 5000;
  const color = { r: 0, g: 0, b: 0, a: 1 };
  const cases: Array<[string, (list: unknown) => Record<string, unknown>, () => unknown]> = [
    ["fonts", (list) => ({ ...minimalCapture(), fonts: list }), () => ({})],
    ["assets", (list) => ({ ...minimalCapture(), assets: list }), () => ({})],
    ["warnings", (list) => ({ ...minimalCapture(), warnings: list }), () => ({})],
    [
      "boxShadows",
      (list) => ({ ...minimalCapture(), root: elementWith({ boxShadows: list }) }),
      () => ({}),
    ],
    ["filters", (list) => ({ ...minimalCapture(), root: elementWith({ filters: list }) }), () => 1],
    [
      "backgroundImages",
      (list) => ({ ...minimalCapture(), root: elementWith({ backgroundImages: list }) }),
      () => ({}),
    ],
    [
      "stops",
      (list) => ({
        ...minimalCapture(),
        root: elementWith({
          backgroundImages: [{ type: "linear-gradient", css: "x", stops: list }],
        }),
      }),
      () => ({ color: 1 }),
    ],
    [
      "lines",
      (list) => ({ ...minimalCapture(), root: { ...textNode("t"), lines: list } }),
      () => ({}),
    ],
    [
      "runs",
      (list) => ({ ...minimalCapture(), root: { ...textNode("t"), runs: list } }),
      () => ({}),
    ],
  ];

  for (const [name, build, item] of cases) {
    test(`${name}: stops at the first bad item with a short detail`, () => {
      const { proxy, reads } = countedArray(N, item);
      const result = parseCapture(build(proxy));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid");
        expect(result.detail.length).toBeLessThanOrEqual(300);
      }
      expect(reads()).toBeLessThanOrEqual(3);
    });
  }

  test("tokens: stops at the first bad entry", () => {
    let reads = 0;
    const target: Record<string, unknown> = {};
    for (let i = 0; i < N; i++) target[`--v${i}`] = 1;
    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        if (typeof prop === "string" && prop.startsWith("--v")) reads++;
        return Reflect.get(t, prop, receiver);
      },
    });
    const result = parseCapture({ ...minimalCapture(), tokens: { cssCustomProperties: proxy } });
    expect(result.ok).toBe(false);
    expect(reads).toBeLessThanOrEqual(3);
  });

  test("a gradient may hold 256 stops and no more", () => {
    const withStops = (n: number) => ({
      ...minimalCapture(),
      root: elementWith({
        backgroundImages: [
          {
            type: "linear-gradient",
            css: "x",
            stops: Array.from({ length: n }, (_, i) => ({ color, position: i / n })),
          },
        ],
      }),
    });
    expect(parseCapture(withStops(256)).ok).toBe(true);
    expect(parseCapture(withStops(257))).toMatchObject({ ok: false, reason: "invalid" });
    expect(captureSchema.safeParse(withStops(257)).success).toBe(false);
  });

  test("a valid stops list still round-trips", () => {
    const stops = [
      { color, position: 0 },
      { color, position: 1 },
    ];
    const input = {
      ...minimalCapture(),
      root: elementWith({ backgroundImages: [{ type: "linear-gradient", css: "x", stops }] }),
    };
    const result = parseCapture(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capture).toEqual(captureSchema.parse(input));
  });
});

describe("own __proto__ keys from JSON.parse", () => {
  const cap = minimalCapture();
  const shellFields = {
    schemaVersion: cap.schemaVersion,
    capturedAt: cap.capturedAt,
    tool: cap.tool,
    source: cap.source,
  };
  const json = (s: string): Record<string, unknown> => JSON.parse(s);

  function expectRejected(value: unknown) {
    const result = parseCapture(value);
    expect(result.ok).toBe(false);
    // The two paths must agree about whether the object is acceptable.
    expect(result.ok).toBe(captureSchema.safeParse(value).success);
  }

  test("required shell fields supplied only through __proto__", () => {
    const value = json(
      `{"__proto__":${JSON.stringify(shellFields)},"tokens":{"cssCustomProperties":{}},"fonts":[],"assets":[],"warnings":[],"root":${JSON.stringify(elementNode("r"))}}`
    );
    expectRejected(value);
  });

  test("required text fields supplied only through __proto__", () => {
    const node = JSON.stringify({ ...textNode("t"), text: undefined }).slice(1);
    const root = json(`{"__proto__":{"text":"hi"},${node}`);
    expectRejected({ ...cap, root });
  });

  test("required style fields supplied only through __proto__", () => {
    const el = elementNode("e") as unknown as { style: Record<string, unknown> };
    const { overflow: _o, ...style } = el.style;
    const styleJson = json(`{"__proto__":{"overflow":"visible"},${JSON.stringify(style).slice(1)}`);
    expectRejected({ ...cap, root: { ...el, style: styleJson } });
  });

  test("required background fields supplied only through __proto__", () => {
    const bg = json('{"__proto__":{"css":"x"},"type":"image"}');
    expectRejected({ ...cap, root: elementWith({ backgroundImages: [bg] }) });
  });

  test("a __proto__ key inside tokens is skipped like z.record does", () => {
    const value = {
      ...cap,
      tokens: json('{"cssCustomProperties":{"__proto__":"x","b":"y"}}'),
    };
    const result = parseCapture(value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capture).toEqual(captureSchema.parse(value));
      expect(Object.keys(result.capture.tokens.cssCustomProperties)).toEqual(["b"]);
    }
  });

  test("a non-string __proto__ token value does not reject", () => {
    const value = { ...cap, tokens: json('{"cssCustomProperties":{"__proto__":1}}') };
    expect(parseCapture(value).ok).toBe(captureSchema.safeParse(value).success);
  });
});

describe("unexpected failures stay coded", () => {
  const badId = { ...minimalCapture(), root: { ...elementNode("r"), id: { toString: 1 } } };

  test("an object id does not throw an uncoded TypeError", () => {
    expect(parseCapture(badId)).toMatchObject({ ok: false, reason: "invalid" });
    expectCode(() => unpackFrottage(zipWithRaw(JSON.stringify(badId))), "invalid-capture");
  });

  test("a RangeError that is not a stack overflow is invalid, a stack overflow is too-deep", () => {
    const other = {
      get schemaVersion(): never {
        throw new RangeError("Invalid array length");
      },
    };
    expect(parseCapture(other)).toMatchObject({ ok: false, reason: "invalid" });
    const stack = {
      get schemaVersion(): never {
        throw new RangeError("Maximum call stack size exceeded.");
      },
    };
    expect(parseCapture(stack)).toMatchObject({ ok: false, reason: "too-deep" });
  });
});

describe("frottage sets", () => {
  const enc = (c: unknown) => strToU8(JSON.stringify(c));
  const named = (title: string): Capture => ({ ...sample, source: { ...sample.source, title } });

  test("round trips three captures that share assets, each asset stored once", () => {
    const shared = captureUsingAsset("abc123");
    const captures = ["a", "b", "c"].map((t) => ({
      ...shared,
      source: { ...shared.source, title: t },
    }));
    const bytes = packFrottageSet(captures, new Map([["abc123", png]]));
    const out = unpackFrottageSet(bytes);
    expect(out.captures.map((c) => c.source.title)).toEqual(["a", "b", "c"]);
    expect(out.assets.size).toBe(1);
    const names = Object.keys(unzipSync(bytes));
    expect(names.filter((n) => n.startsWith("assets/")).length).toBe(1);
  });

  test("reads an old file with capture.json as a set of one", () => {
    const out = unpackFrottageSet(packFrottage(sample, new Map()));
    expect(out.captures).toEqual([unpackFrottage(packFrottage(sample, new Map())).capture]);
    expect(out.captures[0]?.source.title).toBe(sample.source.title);
  });

  test("refuses a file with both capture.json and captures/", () => {
    const bytes = zipSync({ "capture.json": enc(sample), "captures/0.json": enc(sample) });
    expectCode(() => unpackFrottageSet(bytes), "not-a-frottage-file");
  });

  test("refuses a gap in the numbering", () => {
    const bytes = zipSync({ "captures/0.json": enc(sample), "captures/2.json": enc(sample) });
    expectCode(() => unpackFrottageSet(bytes), "not-a-frottage-file");
  });

  test("refuses a non-numeric capture entry", () => {
    const bytes = zipSync({ "captures/a.json": enc(sample) });
    expectCode(() => unpackFrottageSet(bytes), "not-a-frottage-file");
  });

  test("refuses an empty captures list", () => {
    expectCode(() => unpackFrottageSet(zipSync({ "other.txt": enc("x") })), "not-a-frottage-file");
  });

  test("applies captureJsonBytes per capture and totalBytes to the whole file", () => {
    const one = enc(sample).length;
    const limits = { ...LIMITS, captureJsonBytes: one, totalBytes: Math.floor(one * 2.5) };
    const two = packFrottageSet([sample, sample], new Map());
    expect(unpackFrottageSet(two, limits).captures.length).toBe(2);
    const three = packFrottageSet([sample, sample, sample], new Map());
    expectCode(() => unpackFrottageSet(three, limits), "too-large");
  });

  test("checks every capture's assets", () => {
    const bytes = packFrottageSet(
      [captureUsingAsset("abc123"), captureUsingAsset("def456")],
      new Map([["abc123", png]])
    );
    expectCode(() => unpackFrottageSet(bytes), "missing-asset");
  });

  test("packFrottageSet with no captures throws", () => {
    expect(() => packFrottageSet([], new Map())).toThrow();
  });

  test("unpackFrottage refuses a file of several captures", () => {
    const bytes = packFrottageSet([named("a"), named("b")], new Map());
    expectCode(() => unpackFrottage(bytes), "not-a-frottage-file");
  });
});
