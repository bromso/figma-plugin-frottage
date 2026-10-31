import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from "fflate";
import { countNodes, parseCapture } from "./parse";
import type { Capture, CaptureNode } from "./schema";

export const LIMITS = {
  totalBytes: 268_435_456,
  captureJsonBytes: 67_108_864,
  nodes: 20_000,
};

export type FrottageErrorCode =
  | "not-a-frottage-file"
  | "too-large"
  | "too-many-nodes"
  | "invalid-capture"
  | "newer-version"
  | "missing-asset";

export class FrottageFileError extends Error {
  code: FrottageErrorCode;
  constructor(code: FrottageErrorCode, message: string) {
    super(message);
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
 * actually come out of the decompressor, never from ZIP header fields, and we
 * throw the moment a running count passes a limit.
 */
function readEntries(
  bytes: Uint8Array,
  limits: typeof LIMITS
): { capture: Uint8Array | undefined; assets: Map<string, Uint8Array> } {
  let total = 0;
  let capture: Uint8Array | undefined;
  const assets = new Map<string, Uint8Array>();
  const pending: Array<() => boolean> = [];
  // fflate catches an error thrown from ondata and calls ondata again with it,
  // so keep the first failure and rethrow that once push() returns.
  let failure: FrottageFileError | undefined;

  const unzip = new Unzip((file) => {
    const isCapture = file.name === CAPTURE_ENTRY;
    const assetMatch = isCapture ? null : ASSET_ENTRY.exec(file.name);
    if (!isCapture && !assetMatch) return;

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
        file.terminate();
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
    unzip.push(bytes, true);
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

export function unpackFrottage(
  bytes: Uint8Array,
  limits: typeof LIMITS = LIMITS
): { capture: Capture; assets: Map<string, Uint8Array> } {
  const { capture: captureBytes, assets } = readEntries(bytes, limits);
  if (!captureBytes) throw notFrottage("The file has no capture.json");

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(captureBytes));
  } catch {
    throw new FrottageFileError("invalid-capture", "capture.json is not valid JSON");
  }

  const parsed = parseCapture(json);
  if (!parsed.ok) {
    throw new FrottageFileError(
      parsed.reason === "newer-version" ? "newer-version" : "invalid-capture",
      parsed.detail
    );
  }
  const { capture } = parsed;

  if (countNodes(capture.root) > limits.nodes) {
    throw new FrottageFileError("too-many-nodes", "The capture has too many nodes");
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
}
