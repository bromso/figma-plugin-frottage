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
