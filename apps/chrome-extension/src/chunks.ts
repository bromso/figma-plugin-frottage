/** Largest chunk, in UTF-16 code units. Runtime messages fail at 64 MiB (Phase 0); JSON-encoded, 16 MiB of text stays well under. */
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

export function splitIntoChunks(text: string, size: number = CHUNK_BYTES): string[] {
  if (text.length === 0) return [""];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    // Never end between the halves of a surrogate pair.
    if (end < text.length && end - start > 1) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end--;
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
