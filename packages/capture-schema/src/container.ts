import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from "fflate";
import { LIMITS, parseCapture } from "./parse";
import type { Capture, CaptureNode } from "./schema";

export { LIMITS };

/** Compressed bytes handed to fflate per push; bounds how much one step can inflate. */
const PUSH_SLICE_BYTES = 16_384;

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
      failure = new FrottageFileError("not-a-frottage-file", "The file repeats an entry");
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
        failure = new FrottageFileError("not-a-frottage-file");
        throw failure;
      }
      size += chunk.length;
      total += chunk.length;
      if (total > limits.totalBytes || (isCapture && size > limits.captureJsonBytes)) {
        failure = new FrottageFileError("too-large");
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
    throw failure ?? new FrottageFileError("not-a-frottage-file");
  }
  if (failure) throw failure;
  if (!pending.every((isDone) => isDone()))
    throw new FrottageFileError("not-a-frottage-file", "The .frottage file is truncated");
  return { capture, assets };
}

function collectAssetHashes(root: CaptureNode, into: Set<string>): void {
  const stack: CaptureNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.kind === "image" || node.kind === "placeholder") {
      if (node.assetHash) into.add(node.assetHash);
    } else if (node.kind === "element") {
      for (const bg of node.style.backgroundImages) {
        if (bg.assetHash) into.add(bg.assetHash);
      }
      for (const child of node.children) stack.push(child);
    }
  }
}

function isStackOverflow(e: unknown): boolean {
  return e instanceof RangeError && /call stack/i.test(e.message);
}

export function unpackFrottage(
  bytes: Uint8Array,
  limits: typeof LIMITS = LIMITS
): { capture: Capture; assets: Map<string, Uint8Array> } {
  const { capture: captureBytes, assets } = readEntries(bytes, limits);
  if (!captureBytes) {
    throw new FrottageFileError("not-a-frottage-file", "The file has no capture.json");
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(captureBytes));
  } catch (e) {
    if (isStackOverflow(e)) throw new FrottageFileError("too-deep");
    throw new FrottageFileError("invalid-capture", "capture.json is not valid JSON");
  }

  let parsed: ReturnType<typeof parseCapture>;
  try {
    parsed = parseCapture(json, limits);
  } catch (e) {
    if (isStackOverflow(e)) throw new FrottageFileError("too-deep");
    throw new FrottageFileError("invalid-capture");
  }
  if (!parsed.ok) {
    const code = {
      invalid: "invalid-capture",
      "newer-version": "newer-version",
      "too-many-nodes": "too-many-nodes",
      "too-deep": "too-deep",
    } as const;
    throw new FrottageFileError(code[parsed.reason], parsed.detail);
  }
  const { capture } = parsed;

  try {
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
  } catch (e) {
    if (isStackOverflow(e)) throw new FrottageFileError("too-deep");
    throw e;
  }
  return { capture, assets };
}
