import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from "fflate";
import { countNodes, parseCapture } from "./parse";
import type { Capture, CaptureNode } from "./schema";

export const LIMITS = {
  totalBytes: 268_435_456,
  captureJsonBytes: 67_108_864,
  nodes: 20_000,
  depth: 256,
};

/** Compressed bytes handed to fflate per push; bounds how much one step can inflate. */
export const PUSH_SLICE_BYTES = 16_384;

export type FrottageErrorCode =
  | "not-a-frottage-file"
  | "too-large"
  | "too-many-nodes"
  | "invalid-capture"
  | "newer-version"
  | "missing-asset"
  | "too-deep";

const DEFAULT_MESSAGES: Record<FrottageErrorCode, string> = {
  "not-a-frottage-file": "This is not a .frottage file",
  "too-large": "The .frottage file is too large to open",
  "too-many-nodes": "The capture has too many nodes",
  "invalid-capture": "The capture is not valid",
  "newer-version": "The capture was made by a newer version of Frottage",
  "missing-asset": "The capture references a missing asset",
  "too-deep": "The capture is nested too deeply",
};

const MAX_MESSAGE_CHARS = 500;

export class FrottageFileError extends Error {
  code: FrottageErrorCode;
  constructor(code: FrottageErrorCode, message: string = DEFAULT_MESSAGES[code]) {
    super(message.slice(0, MAX_MESSAGE_CHARS));
    this.name = "FrottageFileError";
    this.code = code;
  }
}

const CAPTURE_ENTRY = "capture.json";
const ASSET_ENTRY = /^assets\/([A-Za-z0-9]+)\.(?:png|jpg|gif)$/;
const HASH = /^[A-Za-z0-9]+$/;

function extensionFor(bytes: Uint8Array): "png" | "jpg" | "gif" {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return "gif";
  throw new Error("Asset is not a PNG, JPEG or GIF");
}

export function packFrottage(capture: Capture, assets: Map<string, Uint8Array>): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    [CAPTURE_ENTRY]: new TextEncoder().encode(JSON.stringify(capture)),
  };
  for (const [hash, bytes] of assets) {
    if (!HASH.test(hash)) throw new Error(`Invalid asset hash: ${hash}`);
    files[`assets/${hash}.${extensionFor(bytes)}`] = [bytes, { level: 0 }];
  }
  return zipSync(files);
}

function tooLarge(): FrottageFileError {
  return new FrottageFileError("too-large", "The .frottage file is too large to open");
}

function notFrottage(detail = "This is not a .frottage file"): FrottageFileError {
  return new FrottageFileError("not-a-frottage-file", detail);
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Inflate the entries we care about. Sizes are counted from the bytes that
 * actually come out of the decompressor, never from ZIP header fields.
 *
 * fflate's decoders have no terminate and inflate whatever they are handed, so
 * the input goes in as small slices and the loop stops once `failure` is set.
 * fflate also catches an error thrown from ondata and calls ondata again with
 * it, so the first failure is kept and rethrown after the loop.
 */
function readEntries(
  bytes: Uint8Array,
  limits: typeof LIMITS
): { capture: Uint8Array | undefined; assets: Map<string, Uint8Array> } {
  let total = 0;
  let capture: Uint8Array | undefined;
  const assets = new Map<string, Uint8Array>();
  const pending: Array<() => boolean> = [];
  const seen = new Set<string>();
  let failure: FrottageFileError | undefined;

  const unzip = new Unzip((file) => {
    if (failure) return;
    const isCapture = file.name === CAPTURE_ENTRY;
    const assetMatch = isCapture ? null : ASSET_ENTRY.exec(file.name);
    if (!isCapture && !assetMatch) return;
    const key = isCapture ? CAPTURE_ENTRY : (assetMatch?.[1] ?? "");
    if (seen.has(key)) {
      failure = notFrottage("The file repeats an entry");
      return;
    }
    seen.add(key);

    const chunks: Uint8Array[] = [];
    let size = 0;
    let done = false;
    pending.push(() => done);

    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = notFrottage();
        throw failure;
      }
      size += chunk.length;
      total += chunk.length;
      if (total > limits.totalBytes || (isCapture && size > limits.captureJsonBytes)) {
        failure = tooLarge();
        throw failure;
      }
      chunks.push(chunk);
      if (final) {
        done = true;
        const data = concat(chunks, size);
        if (isCapture) capture = data;
        else if (assetMatch?.[1]) assets.set(assetMatch[1], data);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  try {
    for (let i = 0; i < bytes.length && !failure; i += PUSH_SLICE_BYTES) {
      const end = Math.min(i + PUSH_SLICE_BYTES, bytes.length);
      unzip.push(bytes.subarray(i, end), end >= bytes.length);
    }
  } catch {
    throw failure ?? notFrottage();
  }
  if (failure) throw failure;
  if (!pending.every((isDone) => isDone())) throw notFrottage("The .frottage file is truncated");
  return { capture, assets };
}

function collectAssetHashes(node: CaptureNode, into: Set<string>): void {
  if (node.kind === "image" || node.kind === "placeholder") {
    if (node.assetHash) into.add(node.assetHash);
  } else if (node.kind === "element") {
    for (const bg of node.style.backgroundImages) {
      if (bg.assetHash) into.add(bg.assetHash);
    }
    for (const child of node.children) collectAssetHashes(child, into);
  }
}

/**
 * Walk the parsed JSON iteratively, before Zod sees it, so a deep or huge tree
 * is rejected without recursion. Only follows `children` arrays of objects.
 */
function checkShape(root: unknown, limits: typeof LIMITS): void {
  if (typeof root !== "object" || root === null) return;
  const top = (root as { root?: unknown }).root;
  if (typeof top !== "object" || top === null) return;
  const stack: Array<{ node: unknown; depth: number }> = [{ node: top, depth: 1 }];
  let nodes = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    if (typeof item.node !== "object" || item.node === null) continue;
    if (item.depth > limits.depth) {
      throw new FrottageFileError("too-deep");
    }
    nodes++;
    if (nodes > limits.nodes) {
      throw new FrottageFileError("too-many-nodes");
    }
    const children = (item.node as { children?: unknown }).children;
    if (Array.isArray(children)) {
      for (const child of children) stack.push({ node: child, depth: item.depth + 1 });
    }
  }
}

export function unpackFrottage(
  bytes: Uint8Array,
  limits: typeof LIMITS = LIMITS
): { capture: Capture; assets: Map<string, Uint8Array> } {
  const { capture: captureBytes, assets } = readEntries(bytes, limits);
  if (!captureBytes) throw notFrottage("The file has no capture.json");

  try {
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(captureBytes));
    } catch (e) {
      if (e instanceof RangeError) throw e;
      throw new FrottageFileError("invalid-capture", "capture.json is not valid JSON");
    }

    checkShape(json, limits);

    const parsed = parseCapture(json);
    if (!parsed.ok) {
      throw new FrottageFileError(
        parsed.reason === "newer-version" ? "newer-version" : "invalid-capture",
        parsed.detail
      );
    }
    const { capture } = parsed;

    if (countNodes(capture.root) > limits.nodes) {
      throw new FrottageFileError("too-many-nodes");
    }

    const referenced = new Set<string>();
    collectAssetHashes(capture.root, referenced);
    for (const hash of referenced) {
      if (!assets.has(hash)) {
        throw new FrottageFileError(
          "missing-asset",
          `The capture references a missing asset: ${hash}`
        );
      }
    }
    return { capture, assets };
  } catch (e) {
    if (e instanceof RangeError) throw new FrottageFileError("too-deep");
    throw e;
  }
}
