import type {
  Capture,
  CaptureNode,
  ElementNode,
  ImageNode,
  PlaceholderNode,
} from "@repo/capture-schema";
// The hash module has no Zod, so this file can run in the page's isolated world.
import { sha256Hex } from "@repo/capture-schema/hash";

type Warning = Capture["warnings"][number];
type Layer = ElementNode["style"]["backgroundImages"][number];

export type Normalised = {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  downscaledFrom?: { w: number; h: number };
};

export type AssetResult = { capture: Capture; assets: Map<string, Uint8Array> };

export type AssetDeps = {
  /** Rejects when the image cannot be read (CORS, network, HTTP error, abort). */
  fetchBytes: (url: string, signal?: AbortSignal) => Promise<Blob>;
  /** `hint` is the display size of the first use, in CSS px; only SVG sources use it. */
  normalise: (blob: Blob, hint?: { w: number; h: number }) => Promise<Normalised>;
  /** Called as each image settles, so the caller can show it is still working. */
  onProgress?: () => void;
  /** Fetches in flight at once. Default 6. */
  concurrency?: number;
  /** Per-image limit for fetch plus decode. Default 15 s. */
  timeoutMs?: number;
  /** Stop collecting once the stored bytes would pass this. Default 200 MiB. */
  budgetBytes?: number;
};

export const MAX_IMAGE_SIDE = 4096;
export const ASSET_BUDGET_BYTES = 200 * 1024 * 1024;
const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;
const SHORT_URL = 200;

class Failure extends Error {
  constructor(
    readonly code: "image-blocked" | "image-failed" | "asset-limit",
    message: string
  ) {
    super(message);
  }
}

/** A data: URL can be megabytes; the capture keeps only its head. */
function shortUrl(url: string): string {
  if (!url.startsWith("data:") || url.length <= SHORT_URL) return url;
  return `${url.slice(0, 64)}…[${url.length} chars]`;
}

const URL_IN_CSS = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/;

/** The first url() in a computed `background-image` layer, or null (gradients, unparsable image-set). */
function urlOfLayer(css: string): string | null {
  const m = URL_IN_CSS.exec(css);
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  return raw ? raw.replace(/\\(.)/g, "$1") : null;
}

type Ref =
  | { kind: "image"; url: string; node: ImageNode; list: CaptureNode[]; index: number }
  | { kind: "background"; url: string | null; element: ElementNode; layer: Layer };

function gather(root: CaptureNode): Ref[] {
  const refs: Ref[] = [];
  const stack: CaptureNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as CaptureNode;
    if (node.kind === "element") {
      for (const layer of node.style.backgroundImages) {
        if (layer.type === "image" && !layer.assetHash) {
          refs.push({ kind: "background", url: urlOfLayer(layer.css), element: node, layer });
        }
      }
      node.children.forEach((child, index) => {
        if (child.kind === "image" && child.sourceUrl && !child.assetHash) {
          refs.push({
            kind: "image",
            url: child.sourceUrl,
            node: child,
            list: node.children,
            index,
          });
        }
      });
      for (let i = node.children.length - 1; i >= 0; i--)
        stack.push(node.children[i] as CaptureNode);
    }
    if ("sourceUrl" in node && typeof node.sourceUrl === "string") {
      node.sourceUrl = shortUrl(node.sourceUrl);
    }
  }
  return refs;
}

function toPlaceholder(node: ImageNode): PlaceholderNode {
  const { kind: _k, assetHash: _a, fit: _f, objectPosition: _o, sourceUrl, ...rest } = node;
  return {
    ...rest,
    kind: "placeholder",
    placeholderKind: "blocked-image",
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

type Loaded =
  | { ok: true; hash: string; n: Normalised }
  | { ok: false; code: Failure["code"]; detail: string };

/**
 * Fetches, normalises and hashes every image the capture refers to (`<img>` and
 * `background-image: url()`), fills `assetHash` and `capture.assets`, and returns the bytes by hash.
 * An image that cannot be read becomes a sized `blocked-image` placeholder with its URL; a blocked
 * background image has no node to turn into a placeholder, so it is dropped. Both add a warning.
 * Mutates and returns `capture`.
 */
export async function collectAssets(capture: Capture, deps: AssetDeps): Promise<AssetResult> {
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const budget = deps.budgetBytes ?? ASSET_BUDGET_BYTES;
  const refs = gather(capture.root);

  const hints = new Map<string, { w: number; h: number } | undefined>();
  for (const ref of refs) {
    if (!ref.url || hints.has(ref.url)) continue;
    const b = ref.kind === "image" ? ref.node.box : ref.element.box;
    hints.set(ref.url, b.w > 0 && b.h > 0 ? { w: b.w, h: b.h } : undefined);
  }
  const urls = [...hints.keys()];

  const bytesByHash = new Map<string, Uint8Array>();
  let stored = 0;
  let limitHit = false;
  const loaded = new Map<string, Loaded>();

  async function load(url: string): Promise<Loaded> {
    if (limitHit) return { ok: false, code: "asset-limit", detail: "Asset limit reached" };
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = (async () => {
        let blob: Blob;
        try {
          blob = await deps.fetchBytes(url, abort.signal);
        } catch (e) {
          throw new Failure("image-blocked", e instanceof Error ? e.message : String(e));
        }
        if (blob.size > budget - stored) throw new Failure("asset-limit", "Image too large");
        try {
          return await deps.normalise(blob, hints.get(url));
        } catch (e) {
          throw new Failure("image-failed", e instanceof Error ? e.message : String(e));
        }
      })();
      work.catch(() => {}); // a late rejection after the timeout must not be unhandled
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Failure("image-failed", `Timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      });
      const n = await Promise.race([work, timeout]);
      const hash = sha256Hex(n.bytes);
      if (!bytesByHash.has(hash)) {
        if (stored + n.bytes.length > budget)
          throw new Failure("asset-limit", "Asset limit reached");
        stored += n.bytes.length;
        bytesByHash.set(hash, n.bytes);
      }
      return { ok: true, hash, n };
    } catch (e) {
      const f = e instanceof Failure ? e : new Failure("image-failed", String(e));
      if (f.code === "asset-limit") limitHit = true;
      return { ok: false, code: f.code, detail: f.message };
    } finally {
      clearTimeout(timer);
    }
  }

  let next = 0;
  const worker = async () => {
    for (let url = urls[next++]; url !== undefined; url = urls[next++]) {
      loaded.set(url, await load(url));
      deps.onProgress?.();
    }
  };
  deps.onProgress?.();
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  // ---------- Apply, in document order so the output is deterministic
  const warnings = new Map<string, { first: Warning; count: number }>();
  const warn = (code: string, nodeId: string, detail: string) => {
    const seen = warnings.get(code);
    if (seen) seen.count++;
    else warnings.set(code, { first: { code, nodeId, detail }, count: 1 });
  };
  const lost = (id: string, url: string | null, r: Extract<Loaded, { ok: false }>) => {
    const what = url ? shortUrl(url) : "an image-set";
    if (r.code === "asset-limit")
      warn("asset-limit", id, `The 200 MiB image limit was reached; ${what} was not captured`);
    else if (r.code === "image-blocked")
      warn("image-blocked", id, `Could not read ${what}: ${r.detail}`);
    else warn("image-failed", id, `Could not decode ${what}: ${r.detail}`);
  };

  const dropped = new Set<Layer>();
  for (const ref of refs) {
    const r = ref.url ? loaded.get(ref.url) : undefined;
    if (ref.kind === "image") {
      if (r?.ok) ref.node.assetHash = r.hash;
      else {
        ref.list[ref.index] = toPlaceholder(ref.node);
        if (r) lost(ref.node.id, ref.url, r);
      }
    } else if (r?.ok) {
      ref.layer.assetHash = r.hash;
    } else {
      dropped.add(ref.layer);
      if (r?.code === "asset-limit") lost(ref.element.id, ref.url, r);
      else {
        const why = r ? r.detail : "it has no usable URL";
        warn("background-image-dropped", ref.element.id, `A background image was left out: ${why}`);
      }
    }
  }
  // A dropped layer has no node to turn into a placeholder, so it is removed (and warned about above).
  if (dropped.size > 0) {
    const stack: CaptureNode[] = [capture.root];
    while (stack.length > 0) {
      const node = stack.pop() as CaptureNode;
      if (node.kind !== "element") continue;
      node.style.backgroundImages = node.style.backgroundImages.filter((l) => !dropped.has(l));
      stack.push(...node.children);
    }
  }

  const seen = new Set<string>();
  for (const url of urls) {
    const r = loaded.get(url);
    if (!r?.ok || seen.has(r.hash)) continue;
    seen.add(r.hash);
    capture.assets.push({
      hash: r.hash,
      mime: r.n.mime,
      width: r.n.width,
      height: r.n.height,
      sourceUrl: shortUrl(url),
      ...(r.n.downscaledFrom ? { downscaledFrom: r.n.downscaledFrom } : {}),
    });
  }
  for (const { first, count } of warnings.values()) {
    capture.warnings.push(
      count > 1 ? { ...first, detail: `${first.detail} (${count} times)` } : first
    );
  }

  const assets = new Map<string, Uint8Array>();
  for (const hash of seen) assets.set(hash, bytesByHash.get(hash) as Uint8Array);
  return { capture, assets };
}

// ---------- Browser implementations

/** Fetches in the page. Obeys the page's CORS rules; a blocked image rejects. */
export async function browserFetchBytes(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { credentials: "same-origin", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

type Kind = "png" | "jpeg" | "gif" | "svg" | "other";

function sniff(head: Uint8Array, type: string): Kind {
  const at = (i: number) => head[i] ?? 0;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "gif";
  const text = new TextDecoder().decode(head);
  if (type === "image/svg+xml" || /<svg[\s>]/i.test(text)) return "svg";
  return "other";
}

async function encodePng(source: CanvasImageSource, w: number, h: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  ctx.drawImage(source, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await out.arrayBuffer());
}

function fitWithin(w: number, h: number): { w: number; h: number; scaled: boolean } {
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(w, h));
  return {
    w: Math.max(1, Math.min(MAX_IMAGE_SIDE, Math.round(w * scale))),
    h: Math.max(1, Math.min(MAX_IMAGE_SIDE, Math.round(h * scale))),
    scaled: scale < 1,
  };
}

async function rasteriseSvg(blob: Blob, hint?: { w: number; h: number }): Promise<Normalised> {
  const url = URL.createObjectURL(new Blob([blob], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The SVG could not be decoded"));
      img.src = url;
    });
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    // Twice the display size, so it stays sharp when scaled up in Figma.
    let w: number;
    let h: number;
    if (hint && nw > 0 && nh > 0) {
      const s = 2 * Math.max(hint.w / nw, hint.h / nh);
      w = nw * s;
      h = nh * s;
    } else if (hint) {
      w = hint.w * 2;
      h = hint.h * 2;
    } else {
      w = nw || 300;
      h = nh || 150;
    }
    const size = fitWithin(w, h);
    const bytes = await encodePng(img, size.w, size.h);
    return { bytes, mime: "image/png", width: size.w, height: size.h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * PNG, JPEG and GIF keep their bytes (an animated GIF stays animated) unless a side exceeds
 * 4096. Anything else the browser can decode (WebP, AVIF, BMP, ...) becomes a PNG at its natural
 * size; SVG becomes a PNG at twice its display size. All are capped at 4096 per side.
 */
export async function browserNormalise(
  blob: Blob,
  hint?: { w: number; h: number }
): Promise<Normalised> {
  const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const kind = sniff(head, blob.type);
  if (kind === "svg") return rasteriseSvg(blob, hint);
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    if (
      (kind === "png" || kind === "jpeg" || kind === "gif") &&
      Math.max(width, height) <= MAX_IMAGE_SIDE
    ) {
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: `image/${kind}`,
        width,
        height,
      };
    }
    const size = fitWithin(width, height);
    const bytes = await encodePng(bitmap, size.w, size.h);
    return {
      bytes,
      mime: "image/png",
      width: size.w,
      height: size.h,
      ...(size.scaled ? { downscaledFrom: { w: width, h: height } } : {}),
    };
  } finally {
    bitmap.close();
  }
}
