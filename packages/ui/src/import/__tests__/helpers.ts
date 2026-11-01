import { type Capture, type CaptureNode, packFrottage } from "@repo/capture-schema";
import { sha256Hex } from "@repo/capture-schema/hash";
import type { FontRef, ImportOptions, PlanOp, PlanTokens } from "@repo/figma-mapper";
import type { ImportPort } from "../import-flow";

const box = { x: 0, y: 0, w: 100, h: 50 };
const none = { r: 0, g: 0, b: 0, a: 0 };
const black = { r: 0, g: 0, b: 0, a: 1 };
const noBorder = { width: 0, color: none, style: "none" };
const common = {
  box,
  paintOrder: 0,
  visible: true,
  opacity: 1,
  blendMode: "normal",
  semantic: { tag: "div" },
};

function element(id: string, children: CaptureNode[]): CaptureNode {
  return {
    ...common,
    id,
    kind: "element",
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
    children,
  } as CaptureNode;
}

function text(id: string, family = "Inter"): CaptureNode {
  return {
    ...common,
    id,
    kind: "text",
    text: "Hi",
    lines: [box],
    runs: [
      {
        start: 0,
        end: 2,
        family,
        weight: 400,
        style: "normal",
        size: 16,
        lineHeight: null,
        letterSpacing: 0,
        color: black,
        decoration: "none",
        transform: "none",
        align: "start",
      },
    ],
  } as CaptureNode;
}

export function captureWithTexts(count: number, version = 1, family = "Inter"): Capture {
  return {
    schemaVersion: version,
    capturedAt: "2026-10-31T00:00:00.000Z",
    tool: { name: "frottage", version: "0.0.0" },
    source: {
      url: "https://example.com/",
      title: "Example",
      viewport: { w: 1280, h: 800 },
      scrollSize: { w: 1280, h: 2000 },
      devicePixelRatio: 2,
      colorScheme: "light",
    },
    tokens: { cssCustomProperties: {} },
    fonts: [],
    assets: [],
    warnings: [],
    root: element(
      "root",
      Array.from({ length: count }, (_, i) => text(`t${i}`, family))
    ),
  } as Capture;
}

/** A File of one text layer set in `family`, which the fake port may not list. */
export function fontFile(family: string, url = "https://example.com/"): File {
  const capture = captureWithTexts(1, 1, family);
  capture.source.url = url;
  return new File([packFrottage(capture, new Map()) as BlobPart], "page.frottage");
}

/** A File of a packed capture: the root frame plus `texts` text layers. */
export function frottageFile(texts: number, version = 1, name = "page.frottage"): File {
  const bytes = packFrottage(captureWithTexts(texts, version), new Map());
  return new File([bytes as BlobPart], name);
}

/** A File of `count` copies of one custom element, each holding a text layer. */
export function repeatedFile(count: number): File {
  const capture = captureWithTexts(0);
  const cards = Array.from({ length: count }, (_, i) => {
    const card = element(`c${i}`, [text(`t${i}`)]);
    return { ...card, semantic: { tag: "x-card" } } as CaptureNode;
  });
  capture.root = element("root", cards);
  return new File([packFrottage(capture, new Map()) as BlobPart], "page.frottage");
}

export type FakePort = ImportPort & {
  log: string[];
  batchSizes: number[];
  endResult: {
    rootId: string;
    failedOps: number;
    missingImages?: number;
    rewrappedTexts?: number;
    textDriftCount?: number;
    autoLayoutFrames?: number;
    fallbackFrames?: number;
    componentsCreated?: number;
    instancesCreated?: number;
    overrideFailures?: number;
    overrideFailuresInMains?: number;
    layoutFailures?: number;
    hoverVariants?: number;
    hoverFailures?: number;
    stylesCreated?: number;
    stylesReused?: number;
    variablesCreated?: number;
    variablesReused?: number;
    tokenFailures?: number;
  };
  failOn?: "batch" | "end";
  /** In-memory stand-in for figma.clientStorage. */
  prefs: Map<string, unknown>;
  tokensOptions?: ImportOptions;
  beginMeta?: Parameters<ImportPort["begin"]>[0];
  tokensSent?: PlanTokens;
};

export function fakePort(fonts: FontRef[] = [{ family: "Inter", style: "Regular" }]): FakePort {
  const port: FakePort = {
    log: [],
    prefs: new Map(),
    batchSizes: [],
    async getPrefs(key) {
      port.log.push(`getPrefs ${key}`);
      return port.prefs.get(key);
    },
    async setPrefs(key, value) {
      port.log.push(`setPrefs ${key}`);
      port.prefs.set(key, value);
    },
    endResult: { rootId: "1:2", failedOps: 0, missingImages: 0 },
    async listFonts() {
      port.log.push("listFonts");
      return fonts;
    },
    async begin(meta) {
      port.log.push("begin");
      port.beginMeta = meta;
    },
    async tokens(tokens, options) {
      port.log.push("tokens");
      port.tokensSent = tokens;
      port.tokensOptions = options;
    },
    async image() {
      port.log.push("image");
      return { ok: true };
    },
    async batch(ops: PlanOp[]) {
      port.log.push("batch");
      port.batchSizes.push(ops.length);
      if (port.failOn === "batch") throw new Error("boom");
    },
    async end() {
      port.log.push("end");
      if (port.failOn === "end") throw new Error("boom");
      return port.endResult;
    },
    async cancel() {
      port.log.push("cancel");
    },
  };
  return port;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A file with one image node; `keyFor` decides the asset's map key. */
export async function imageFile(good: boolean, edit?: (capture: Capture) => void): Promise<File> {
  const key = good ? sha256Hex(PNG) : "a".repeat(64);
  const capture = captureWithTexts(0);
  (capture.root as { children: CaptureNode[] }).children = [
    {
      ...common,
      id: "img",
      kind: "image",
      assetHash: key,
      fit: "cover",
      objectPosition: "50% 50%",
      borderRadius: [0, 0, 0, 0],
      borders: { top: noBorder, right: noBorder, bottom: noBorder, left: noBorder },
    } as CaptureNode,
  ];
  edit?.(capture);
  const bytes = packFrottage(capture, new Map([[key, PNG]]));
  return new File([bytes as BlobPart], "img.frottage");
}

/** A file whose one image was downscaled during capture. */
export function downscaledFile(): Promise<File> {
  return imageFile(true, (capture) => {
    capture.assets.push({
      hash: sha256Hex(PNG),
      mime: "image/png",
      width: 4096,
      height: 82,
      sourceUrl: "https://example.com/huge.png",
      downscaledFrom: { w: 5000, h: 100 },
    });
  });
}

/** A file of one text layer whose source title and URL are set by the test. */
export function namedFile(title: string, url: string): File {
  const capture = captureWithTexts(1);
  capture.source.title = title;
  capture.source.url = url;
  return new File([packFrottage(capture, new Map()) as BlobPart], "page.frottage");
}
