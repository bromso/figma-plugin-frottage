/** Largest serialised chunk message, in bytes. Runtime messages fail at 64 MiB (Phase 0). */
export const CHUNK_BYTES = 16 * 1024 * 1024;

/** One piece of a payload on its way from the page script to the offscreen document. */
export type ChunkMessage = {
  type: "chunk";
  kind: "capture" | "asset";
  key: string;
  index: number;
  total: number;
  data: string;
};

/** Room in a chunk message for the JSON around `data`. */
const ENVELOPE_BYTES = 1024;

/** Worst-case JSON-serialised UTF-8 size of one UTF-16 unit (a lone surrogate or control char is `\\uXXXX`). */
function wireCost(code: number): number {
  if (code < 0x20) return 6;
  if (code === 0x22 || code === 0x5c) return 2;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return 3;
}

/**
 * Splits `text` so that each chunk, once JSON-serialised into a message, stays within
 * `size` bytes (the default leaves room for the envelope). `String.length` is not enough:
 * "中" is one unit and three bytes on the wire. A surrogate pair is never split.
 */
export function splitIntoChunks(
  text: string,
  size: number = CHUNK_BYTES - ENVELOPE_BYTES
): string[] {
  if (text.length === 0) return [""];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    let bytes = 0;
    while (end < text.length) {
      const code = text.charCodeAt(end);
      const isPair =
        code >= 0xd800 &&
        code <= 0xdbff &&
        end + 1 < text.length &&
        (text.charCodeAt(end + 1) & 0xfc00) === 0xdc00;
      const cost = isPair ? 4 : code >= 0xd800 && code <= 0xdfff ? 6 : wireCost(code);
      // Always take at least one character so tiny budgets still progress.
      if (end > start && bytes + cost > size) break;
      bytes += cost;
      end += isPair ? 2 : 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export class ChunkAssembler {
  private parts: Array<string | undefined> = [];
  private total = 0;
  private received = 0;

  /** Returns the whole text once every chunk has arrived, otherwise null. Order does not matter. */
  add(i: number, total: number, chunk: string): string | null {
    if (!Number.isInteger(total) || total < 1) throw new Error("Invalid chunk count");
    if (!Number.isInteger(i) || i < 0 || i >= total) throw new Error("Chunk index out of range");
    if (this.total === 0) {
      this.total = total;
      this.parts = new Array(total);
    } else if (this.total !== total) {
      throw new Error("Chunk count changed mid-transfer");
    }
    if (this.parts[i] !== undefined) throw new Error("Duplicate chunk");
    this.parts[i] = chunk;
    this.received++;
    return this.received === this.total ? this.parts.join("") : null;
  }
}

// ---------- Binary assets

/** Bytes per asset chunk. A multiple of 3, so every chunk but the last is whole base64 groups. */
export const ASSET_STEP_BYTES = 12_000_000;
/** Bytes turned into one `btoa` call; a giant string is never built in one go. */
const BTOA_STEP = 3 * 16_384;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += BTOA_STEP) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + BTOA_STEP)));
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Base64 pieces of `bytes`, one at a time. At the default step a chunk is 16 000 000
 * characters, inside `CHUNK_BYTES` once serialised with its envelope.
 */
export function* assetChunks(
  bytes: Uint8Array,
  step: number = ASSET_STEP_BYTES
): Generator<{ index: number; total: number; data: string }> {
  const total = Math.max(1, Math.ceil(bytes.length / step));
  for (let index = 0; index < total; index++) {
    yield { index, total, data: bytesToBase64(bytes.subarray(index * step, (index + 1) * step)) };
  }
}

/** Collects the chunks of one asset, decoding each as it arrives so no giant string is built. */
export class AssetAssembler {
  private parts: Array<Uint8Array | undefined> = [];
  private total = 0;
  private received = 0;
  private length = 0;

  /** Returns the whole asset once every chunk has arrived, otherwise null. Order does not matter. */
  add(i: number, total: number, data: string): Uint8Array | null {
    if (!Number.isInteger(total) || total < 1) throw new Error("Invalid chunk count");
    if (!Number.isInteger(i) || i < 0 || i >= total) throw new Error("Chunk index out of range");
    if (this.total === 0) {
      this.total = total;
      this.parts = new Array(total);
    } else if (this.total !== total) {
      throw new Error("Chunk count changed mid-transfer");
    }
    if (this.parts[i] !== undefined) throw new Error("Duplicate chunk");
    if (i < total - 1 && data.length % 4 !== 0) throw new Error("Chunk is not whole base64 groups");
    const bytes = base64ToBytes(data);
    this.parts[i] = bytes;
    this.length += bytes.length;
    this.received++;
    if (this.received < this.total) return null;
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part as Uint8Array, offset);
      offset += (part as Uint8Array).length;
    }
    return out;
  }

  /** Bytes decoded so far. */
  get size(): number {
    return this.length;
  }
}
