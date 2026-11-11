import {
  type Capture,
  type CaptureNode,
  packFrottage,
  packFrottageSet,
} from "@repo/capture-schema";
import { sha256Hex } from "@repo/capture-schema/hash";
import type {
  FontRef,
  ImportOptions,
  PlanOp,
  PlanTokens,
  PlanVersionTokens,
} from "@repo/figma-mapper";
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
export function repeatedFile(count: number, language?: Capture["language"]): File {
  const capture = captureWithTexts(0);
  if (language) capture.language = language;
  const cards = Array.from({ length: count }, (_, i) => {
    const card = element(`c${i}`, [text(`t${i}`)]);
    return { ...card, semantic: { tag: "x-card" } } as CaptureNode;
  });
  capture.root = element("root", cards);
  return new File([packFrottage(capture, new Map()) as BlobPart], "page.frottage");
}

/**
 * A File of a page with `tokens` and one frame per entry of `fills`: a hex color, or one with the
 * custom property the frame's background was authored as.
 */
export function themedFile(
  tokens: Capture["tokens"],
  fills: (string | [string, string])[] = []
): File {
  const capture = captureWithTexts(1);
  capture.tokens = tokens;
  const frames = fills.map((fill, i) => {
    const [hex, ref] = typeof fill === "string" ? [fill, undefined] : fill;
    const n = Number.parseInt(hex.slice(1), 16);
    const frame = element(`f${i}`, []) as CaptureNode & {
      style: { backgroundColor: unknown };
      tokenRefs?: Record<string, string>;
    };
    frame.style.backgroundColor = {
      r: (n >> 16) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255,
      a: 1,
    };
    if (ref) frame.tokenRefs = { background: ref };
    return frame;
  });
  const root = capture.root as { children: CaptureNode[] };
  capture.root = element("root", [...root.children, ...frames]);
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
    resizedFallbacks?: number;
    paintFailures?: number;
    stylesCreated?: number;
    stylesReused?: number;
    variablesCreated?: number;
    variablesReused?: number;
    tokenFailures?: number;
    layers?: { variablesRenamed: number; modesDropped: string[]; legacyCollections?: boolean };
  };
  /** What `endSet` gives, on top of zero counts. */
  setResult: Partial<Awaited<ReturnType<ImportPort["endSet"]>>>;
  failOn?: "batch" | "end" | "beginSet" | "endSet";
  /** The batch or the begin, by version index, that throws. */
  failVersion?: number;
  /** In-memory stand-in for figma.clientStorage. */
  prefs: Map<string, unknown>;
  tokensOptions?: ImportOptions;
  beginMeta?: Parameters<ImportPort["begin"]>[0];
  tokensSent?: PlanTokens;
  /** Every begin, in order. */
  begins: Parameters<ImportPort["begin"]>[0][];
  batches: PlanOp[][];
  modesSent?: PlanVersionTokens;
  droppedVersions: number[];
  /** What `beginDeviceSet` was given, last. */
  deviceSetMeta?: Parameters<ImportPort["beginDeviceSet"]>[0];
  /** Every `tokens` call, in order. */
  tokensCalls: PlanTokens[];
  /** What `getModeLimit` gives. */
  modeLimit: number | null;
};

export function fakePort(fonts: FontRef[] = [{ family: "Inter", style: "Regular" }]): FakePort {
  const port: FakePort = {
    log: [],
    prefs: new Map(),
    batchSizes: [],
    begins: [],
    batches: [],
    droppedVersions: [],
    tokensCalls: [],
    modeLimit: null,
    setResult: {},
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
    async beginSet() {
      port.log.push("beginSet");
      if (port.failOn === "beginSet") throw new Error("boom");
    },
    async beginDeviceSet(meta) {
      port.log.push("beginDeviceSet");
      port.deviceSetMeta = meta;
      if (port.failOn === "beginSet") throw new Error("boom");
    },
    async getModeLimit() {
      return port.modeLimit;
    },
    async begin(meta) {
      port.log.push("begin");
      port.beginMeta = meta;
      port.begins.push(meta);
    },
    async importModes(tokens) {
      port.log.push("modes");
      port.modesSent = tokens;
      return { droppedVersions: port.droppedVersions };
    },
    async tokens(tokens, options) {
      port.log.push("tokens");
      port.tokensSent = tokens;
      port.tokensCalls.push(tokens);
      port.tokensOptions = options;
    },
    async image() {
      port.log.push("image");
      return { ok: true };
    },
    async batch(ops: PlanOp[]) {
      port.log.push("batch");
      port.batchSizes.push(ops.length);
      port.batches.push(ops);
      if (port.failOn === "batch") throw new Error("boom");
      const failing = port.failVersion !== undefined;
      if (failing && port.failVersion === port.beginMeta?.version?.index) throw new Error("boom");
    },
    async end() {
      port.log.push("end");
      if (port.failOn === "end") throw new Error("boom");
      return port.endResult;
    },
    async endSet() {
      port.log.push("endSet");
      if (port.failOn === "endSet") throw new Error("boom");
      return {
        rootIds: ["1:2"],
        layoutFailures: 0,
        plainVersions: [],
        stylesCreated: 0,
        stylesReused: 0,
        variablesCreated: 0,
        variablesReused: 0,
        tokenFailures: 0,
        modes: 0,
        modesDropped: 0,
        // A device set's collections, every mode made, as the sandbox reports them.
        ...(port.deviceSetMeta
          ? {
              layers: {
                modesDropped: [],
                modes: port.deviceSetMeta.layers.collections.map((c) => ({
                  kind: c.kind,
                  collection: c.name,
                  created: [...c.modes],
                  added: [],
                })),
              },
            }
          : {}),
        ...port.setResult,
      };
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

/** A File of one page version: its URL, client width, and label and kind when it has them. */
export function versionFile(opts: {
  name: string;
  url?: string;
  width?: number;
  label?: string;
  kind?: "viewport" | "theme" | "language";
  family?: string;
  /** Text layers, when not one. */
  texts?: number;
}): File {
  const capture = captureWithTexts(1, 1, opts.family);
  capture.source.url = opts.url ?? "https://example.com/";
  capture.source.viewport = { w: opts.width ?? 1280, h: 800 };
  if (opts.texts !== undefined) {
    capture.root = captureWithTexts(opts.texts, 1, opts.family).root;
  }
  if (opts.label) capture.version = { label: opts.label, kind: opts.kind ?? "viewport" };
  return new File([packFrottage(capture, new Map()) as BlobPart], opts.name);
}

/** A File holding one capture per width, of one page, each labelled by its width. */
export function setFile(opts: {
  name?: string;
  widths: number[];
  url?: string;
  title?: string;
  /** Packed beside the captures, shared by all. */
  assets?: Map<string, Uint8Array>;
  edit?: (capture: Capture, index: number) => void;
}): File {
  const captures = opts.widths.map((w, i) => {
    const capture = captureWithTexts(1);
    capture.source.url = opts.url ?? "https://example.com/";
    capture.source.title = opts.title ?? "Home | Volvo Group";
    capture.source.viewport = { w, h: 800 };
    capture.version = { label: String(w), kind: "viewport" };
    opts.edit?.(capture, i);
    return capture;
  });
  const bytes = packFrottageSet(captures, opts.assets ?? new Map());
  return new File([bytes as BlobPart], opts.name ?? "set.frottage");
}

/** A set file whose every capture shows one image, which is packed once. */
export function setFileWithImage(widths: number[], good = true, name = "set.frottage"): File {
  const key = good ? sha256Hex(PNG) : "a".repeat(64);
  return setFile({
    name,
    widths,
    assets: new Map([[key, PNG]]),
    edit: (capture) => {
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
    },
  });
}

/** Two buttons the page's code names `Button`, each with a label, added to the capture's root. */
export function addButtons(capture: Capture): void {
  if (capture.root.kind !== "element") return;
  for (const n of [1, 2]) {
    const button = element(`button${n}`, [text(`label${n}`)]) as Extract<
      CaptureNode,
      { kind: "element" }
    >;
    button.semantic = { tag: "button" };
    button.component = { source: "react", name: "Button", props: {} };
    capture.root.children.push(button);
  }
}

/**
 * A File of one page captured on devices, plus extra captures for breakpoint ranges no device
 * covers. Every capture records the page's breakpoint boundaries.
 */
export function deviceSetFile(opts: {
  name?: string;
  url?: string;
  devices: { name: string; width: number; height?: number }[];
  extras?: { breakpoint: string; width: number }[];
  breakpoints?: number[];
  /** A scrollbar's width, taken off each client width; the laid-out width is recorded. */
  scrollbar?: number;
  /** Changes every capture before it is packed, to give them tokens or a theme choice. */
  edit?: (capture: Capture) => void;
}): File {
  const make = (width: number) => {
    const capture = captureWithTexts(1);
    capture.source.url = opts.url ?? "https://example.com/";
    capture.source.title = "Example";
    capture.source.viewport = { w: width - (opts.scrollbar ?? 0), h: 800 };
    if (opts.breakpoints) capture.breakpoints = { widths: opts.breakpoints, unreadable: 0 };
    opts.edit?.(capture);
    return capture;
  };
  const devices = opts.devices.map(({ name, width, height }) => {
    const capture = make(width);
    const id = name.toLowerCase().replace(/\s+/g, "-");
    capture.version = {
      label: name,
      kind: "viewport",
      device: { id, name, height: height ?? 800 },
      ...(opts.scrollbar !== undefined ? { width } : {}),
    };
    return capture;
  });
  const extras = (opts.extras ?? []).map(({ breakpoint, width }) => {
    const capture = make(width);
    capture.version = {
      label: String(width),
      kind: "viewport",
      breakpoint,
      ...(opts.scrollbar !== undefined ? { width } : {}),
    };
    return capture;
  });
  // Extras first, so the import has to put them after the devices.
  const bytes = packFrottageSet([...extras, ...devices], new Map());
  return new File([bytes as BlobPart], opts.name ?? "devices.frottage");
}

/**
 * A File of one page captured in English and Svenska on a Laptop and a Phone. The Svenska Phone
 * page holds `phoneTexts` texts against English's 3, so with fewer it pairs under 80%. Without
 * `phone`, the Laptop alone.
 */
export function languageSetFile(phoneTexts = 0, phone = true): File {
  const make = (device: string, width: number, code: string, texts: number) => {
    const capture = captureWithTexts(texts);
    // One page's address for all, so the import groups them as one page.
    capture.source.url = "https://example.com/";
    capture.source.viewport = { w: width, h: 800 };
    const id = device.toLowerCase();
    capture.version = {
      label: device,
      kind: "viewport",
      device: { id, name: device, height: 800 },
    };
    const name = code === "en" ? "English" : "Svenska";
    const url = `https://example.com/${code}/`;
    capture.language = { code, name, url, current: code === "en" };
    return capture;
  };
  const bytes = packFrottageSet(
    [
      make("Laptop", 1512, "en", 3),
      ...(phone ? [make("Phone", 390, "en", 3)] : []),
      make("Laptop", 1512, "sv", 3),
      ...(phone ? [make("Phone", 390, "sv", phoneTexts)] : []),
    ],
    new Map()
  );
  return new File([bytes as BlobPart], "languages.frottage");
}

/** Three buttons the page's code names `Button`, which differ by `variant` and by their look. */
export function addVariantButtons(capture: Capture): void {
  const { root } = capture;
  if (root.kind !== "element") return;
  const looks = [
    ["outline", { r: 1, g: 1, b: 1, a: 1 }],
    ["default", { r: 0, g: 0, b: 0, a: 1 }],
    ["ghost", { r: 1, g: 0, b: 0, a: 1 }],
  ] as const;
  looks.forEach(([variant, color], n) => {
    const button = element(`variant${n}`, [text(`variantlabel${n}`)]) as Extract<
      CaptureNode,
      { kind: "element" }
    >;
    button.semantic = { tag: "button" };
    button.style.backgroundColor = color;
    button.component = { source: "react", name: "Button", props: { variant } };
    root.children.push(button);
  });
}
