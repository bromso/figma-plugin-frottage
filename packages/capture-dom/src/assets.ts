import type {
  Capture,
  CaptureNode,
  ElementNode,
  ImageNode,
  PlaceholderNode,
} from "@repo/capture-schema";
// The hash module has no Zod, so this file can run in the page's isolated world.
import { sha256Hex } from "@repo/capture-schema/hash";
import { cleanCss, cleanText, cleanUrl, firstUrlInCss, fullUrlOf, resetUrls } from "./urls";

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
  /** Stop collecting once the stored bytes would pass this. Default 180 MiB. */
  budgetBytes?: number;
};

export const MAX_IMAGE_SIDE = 4096;
/**
 * Image bytes kept under the 256 MiB import limit with room for capture.json (up to 64 MiB):
 * 180 + 64 < 256. The extension's run-side cap uses the same figure.
 */
export const ASSET_BUDGET_BYTES = 180 * 1024 * 1024;
const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;

class Failure extends Error {
  constructor(
    readonly code: "image-blocked" | "image-failed" | "asset-limit",
    message: string
  ) {
    super(message);
  }
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
          const url = fullUrlOf(layer) ?? firstUrlInCss(layer.css);
          layer.css = cleanCss(layer.css);
          refs.push({ kind: "background", url, element: node, layer });
        }
      }
      node.children.forEach((child, index) => {
        if (child.kind === "image" && child.sourceUrl && !child.assetHash) {
          refs.push({
            kind: "image",
            url: fullUrlOf(child) ?? child.sourceUrl,
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
      node.sourceUrl = cleanUrl(node.sourceUrl);
    }
  }
  return refs;
}

function toPlaceholder(node: ImageNode): PlaceholderNode {
  const {
    kind: _k,
    assetHash: _a,
    fit: _f,
    objectPosition: _o,
    borders: _b,
    borderRadius: _r,
    sourceUrl,
    ...rest
  } = node;
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
  try {
    return await collect(capture, deps);
  } finally {
    resetUrls();
  }
}

async function collect(capture: Capture, deps: AssetDeps): Promise<AssetResult> {
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
    const what = url ? cleanUrl(url) : "an image-set";
    if (r.code === "asset-limit")
      warn(
        "asset-limit",
        id,
        `The ${Math.floor(budget / 1048576)} MiB image limit was reached; ${what} was not captured`
      );
    else if (r.code === "image-blocked")
      warn("image-blocked", id, `Could not read ${what}: ${cleanText(r.detail)}`);
    else warn("image-failed", id, `Could not decode ${what}: ${cleanText(r.detail)}`);
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
        const why = r ? cleanText(r.detail) : "it has no usable URL";
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
      sourceUrl: cleanUrl(url),
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

export type Kind = "png" | "jpeg" | "gif" | "webp" | "svg" | "other";

/** Bytes read from the start of an image to find its size and orientation. */
const HEAD_BYTES = 256 * 1024;
/** Above this many pixels an image is refused: its decode alone could crash the tab. */
export const MAX_PIXELS = 100_000_000;

export function sniff(head: Uint8Array, type: string): Kind {
  const at = (i: number) => head[i] ?? 0;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "gif";
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 && // RIFF
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50 // WEBP
  ) {
    return "webp";
  }
  const text = new TextDecoder().decode(head.subarray(0, 512));
  if (type === "image/svg+xml" || /<svg[\s>]/i.test(text)) return "svg";
  return "other";
}

export type Header = { w: number; h: number; orientation: number };

/** Size (and, for JPEG, EXIF orientation 1-8) from the file header alone; null when unreadable. */
export function readHeader(head: Uint8Array, kind: Kind): Header | null {
  const at = (i: number) => head[i] ?? 0;
  const be16 = (i: number) => (at(i) << 8) | at(i + 1);
  const le16 = (i: number) => at(i) | (at(i + 1) << 8);
  const be32 = (i: number) =>
    ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  const ok = (w: number, h: number, orientation = 1): Header | null =>
    w > 0 && h > 0 ? { w, h, orientation } : null;

  if (kind === "png") return head.length >= 24 ? ok(be32(16), be32(20)) : null;
  if (kind === "gif") return head.length >= 10 ? ok(le16(6), le16(8)) : null;
  if (kind === "webp") {
    // RIFF chunks from byte 12: VP8X (canvas size) comes first when present; otherwise walk past
    // ALPH, ICCP and the like to the image chunk. The loop is bounded by the head we hold.
    let off = 12;
    for (let n = 0; n < 64 && off + 8 <= head.length; n++) {
      const fourcc = String.fromCharCode(at(off), at(off + 1), at(off + 2), at(off + 3));
      const size =
        (at(off + 4) | (at(off + 5) << 8) | (at(off + 6) << 16) | (at(off + 7) << 24)) >>> 0;
      const d = off + 8;
      if (fourcc === "VP8X" && d + 10 <= head.length) {
        const w = 1 + (at(d + 4) | (at(d + 5) << 8) | (at(d + 6) << 16));
        return ok(w, 1 + (at(d + 7) | (at(d + 8) << 8) | (at(d + 9) << 16)));
      }
      if (fourcc === "VP8L" && d + 5 <= head.length && at(d) === 0x2f) {
        const bits = (at(d + 1) | (at(d + 2) << 8) | (at(d + 3) << 16) | (at(d + 4) << 24)) >>> 0;
        return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (
        fourcc === "VP8 " &&
        d + 10 <= head.length &&
        at(d + 3) === 0x9d &&
        at(d + 4) === 0x01 &&
        at(d + 5) === 0x2a
      ) {
        return ok(le16(d + 6) & 0x3fff, le16(d + 8) & 0x3fff);
      }
      off = d + size + (size & 1);
    }
    return null;
  }
  if (kind === "jpeg") {
    let orientation = 1;
    let i = 2;
    while (i + 4 <= head.length) {
      if (at(i) !== 0xff) return null;
      const marker = at(i + 1);
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = be16(i + 2);
      if (marker === 0xe1 && at(i + 4) === 0x45 && at(i + 5) === 0x78) {
        orientation = exifOrientation(head, i + 10, i + 2 + len) ?? orientation;
      }
      const sof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return ok(be16(i + 7), be16(i + 5), orientation);
      if (marker === 0xda) return null;
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** Orientation tag (0x0112) from a TIFF block starting at `tiff`, or null. */
function exifOrientation(head: Uint8Array, tiff: number, end: number): number | null {
  const at = (i: number) => head[i] ?? 0;
  const little = at(tiff) === 0x49;
  const u16 = (i: number) => (little ? at(i) | (at(i + 1) << 8) : (at(i) << 8) | at(i + 1));
  const u32 = (i: number) =>
    little
      ? (at(i) | (at(i + 1) << 8) | (at(i + 2) << 16) | (at(i + 3) << 24)) >>> 0
      : ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
  if (u16(tiff + 2) !== 0x2a) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      const v = u16(entry + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

async function encode(
  source: CanvasImageSource,
  w: number,
  h: number,
  type: "image/png" | "image/jpeg" = "image/png"
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  ctx.drawImage(source, 0, 0, w, h);
  const out = await canvas.convertToBlob(
    type === "image/jpeg" ? { type, quality: 0.95 } : { type }
  );
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

/**
 * Pixel size an SVG is drawn at. With a display size (`hint`) the scale is at least 2 and follows
 * the device pixel ratio, so it stays sharp on a high-density screen and when scaled up in Figma.
 * Without one the SVG's natural size is used.
 */
export function svgTargetSize(
  natural: { w: number; h: number },
  hint: { w: number; h: number } | undefined,
  devicePixelRatio: number
): { w: number; h: number } {
  const density = Math.max(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
  if (hint && natural.w > 0 && natural.h > 0) {
    const s = density * Math.max(hint.w / natural.w, hint.h / natural.h);
    return { w: natural.w * s, h: natural.h * s };
  }
  if (hint) return { w: hint.w * density, h: hint.h * density };
  return { w: natural.w || 300, h: natural.h || 150 };
}

async function rasteriseSvg(
  blob: Blob,
  hint: { w: number; h: number } | undefined,
  devicePixelRatio: number
): Promise<Normalised> {
  const url = URL.createObjectURL(new Blob([blob], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The SVG could not be decoded"));
      img.src = url;
    });
    const target = svgTargetSize(
      { w: img.naturalWidth, h: img.naturalHeight },
      hint,
      devicePixelRatio
    );
    const size = fitWithin(target.w, target.h);
    const bytes = await encode(img, size.w, size.h);
    return { bytes, mime: "image/png", width: size.w, height: size.h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * PNG, JPEG and GIF keep their bytes (an animated GIF stays animated) unless a side exceeds
 * 4096 or a JPEG carries an EXIF rotation. Anything else the browser can decode (WebP, AVIF, BMP,
 * ...) becomes a PNG at its natural size; SVG becomes a PNG at its display size times the larger of 2 and the device pixel ratio. All are
 * capped at 4096 per side.
 *
 * The header is read first: above 100 megapixels the image is refused, and for sides over 4096 the
 * decode is asked for the reduced size, so a 20000 x 20000 image is never decoded in full. An
 * unreadable header falls back to a plain decode.
 *
 * A JPEG whose EXIF orientation is not 1 is re-encoded (JPEG, quality 0.95) from the oriented
 * bitmap, so the stored size and pixels agree with how Figma and browsers display it. The cost is
 * one lossy generation; a PNG would avoid that but is several times larger for photos.
 */
export async function browserNormalise(
  blob: Blob,
  hint?: { w: number; h: number },
  decode: (blob: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap> = (b, o) =>
    createImageBitmap(b, o),
  devicePixelRatio: number = globalThis.devicePixelRatio ?? 1
): Promise<Normalised> {
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  const kind = sniff(head, blob.type);
  if (kind === "svg") return rasteriseSvg(blob, hint, devicePixelRatio);
  const header = readHeader(head, kind);
  let natural: { w: number; h: number } | null = null;
  let rotated = false;
  if (header) {
    if (header.w * header.h > MAX_PIXELS) {
      throw new Error(`Image is ${header.w} x ${header.h}, over ${MAX_PIXELS / 1e6} megapixels`);
    }
    rotated = kind === "jpeg" && header.orientation > 1;
    natural =
      rotated && header.orientation >= 5
        ? { w: header.h, h: header.w }
        : { w: header.w, h: header.h };
  }
  const target = natural ? fitWithin(natural.w, natural.h) : null;
  const bitmap = await decode(
    blob,
    target?.scaled
      ? { resizeWidth: target.w, resizeHeight: target.h, resizeQuality: "high" }
      : undefined
  );
  try {
    // The 100 MP cap is best-effort protection for honest large images (the page already
    // rendered them), not a security boundary. An unknown header skips the check above and relies
    // on this one, after the decode.
    if (bitmap.width * bitmap.height > MAX_PIXELS) {
      throw new Error(
        `Image is ${bitmap.width} x ${bitmap.height}, over ${MAX_PIXELS / 1e6} megapixels`
      );
    }
    // Without a header, or if resizing was not honoured, size comes from the bitmap itself.
    const from = natural ?? { w: bitmap.width, h: bitmap.height };
    const size = fitWithin(bitmap.width, bitmap.height);
    const scaled = target?.scaled === true || size.scaled;
    const passthrough =
      (kind === "png" || kind === "jpeg" || kind === "gif") && !scaled && !rotated;
    if (passthrough) {
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: `image/${kind}`,
        width: bitmap.width,
        height: bitmap.height,
      };
    }
    const type = rotated ? "image/jpeg" : "image/png";
    const bytes = await encode(bitmap, size.w, size.h, type);
    return {
      bytes,
      mime: type,
      width: size.w,
      height: size.h,
      ...(scaled ? { downscaledFrom: { w: from.w, h: from.h } } : {}),
    };
  } finally {
    bitmap.close();
  }
}
