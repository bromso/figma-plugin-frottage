import { describe, expect, test } from "bun:test";
import {
  AssetAssembler,
  assetChunks,
  base64ToBytes,
  bytesToBase64,
  CHUNK_BYTES,
  ChunkAssembler,
  splitIntoChunks,
} from "../chunks";

function reassemble(chunks: string[], order: number[]): string | null {
  const a = new ChunkAssembler();
  let out: string | null = null;
  for (const i of order) out = a.add(i, chunks.length, chunks[i] as string) ?? out;
  return out;
}

describe("chunks", () => {
  test("chunks reassemble exactly", () => {
    const text = "a".repeat(40) + "é".repeat(40);
    const chunks = splitIntoChunks(text, 16);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      reassemble(
        chunks,
        chunks.map((_, i) => i)
      )
    ).toBe(text);
  });

  test("no chunk exceeds the message limit", () => {
    const sizes = splitIntoChunks("x".repeat(70 * 1024 * 1024)).map((c) => c.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(CHUNK_BYTES);
  });

  const wire = (c: string) => new TextEncoder().encode(JSON.stringify({ data: c })).length;

  test.each([
    ["CJK", "中", 12_000_000],
    ["quotes", '"', 10_000_000],
    ["control characters", "\u0001", 6_000_000],
    ["emoji", "😀", 8_000_000],
  ])("serialised chunk messages stay within the limit (%s)", (_name, ch, n) => {
    const chunks = splitIntoChunks((ch as string).repeat(n as number));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(wire(c)).toBeLessThanOrEqual(CHUNK_BYTES);
  });

  test("chunks may arrive out of order and the text is returned once", () => {
    const text = "0123456789".repeat(5);
    const chunks = splitIntoChunks(text, 10);
    const a = new ChunkAssembler();
    expect(a.add(1, chunks.length, chunks[1] as string)).toBeNull();
    expect(a.add(0, chunks.length, chunks[0] as string)).toBeNull();
    for (let i = 2; i < chunks.length - 1; i++) a.add(i, chunks.length, chunks[i] as string);
    expect(a.add(chunks.length - 1, chunks.length, chunks.at(-1) as string)).toBe(text);
  });

  test("an empty string is one empty chunk", () => {
    const chunks = splitIntoChunks("");
    expect(chunks).toEqual([""]);
    expect(reassemble(chunks, [0])).toBe("");
  });

  test("a surrogate pair is never split", () => {
    const text = "a😀😀😀😀";
    const chunks = splitIntoChunks(text, 2);
    for (const c of chunks) expect(c).toBe(c.toWellFormed());
    expect(
      reassemble(
        chunks,
        chunks.map((_, i) => i)
      )
    ).toBe(text);
  });

  test("duplicate, out-of-range and inconsistent chunks are rejected", () => {
    const a = new ChunkAssembler();
    a.add(0, 3, "a");
    expect(() => a.add(0, 3, "a")).toThrow();
    expect(() => a.add(5, 3, "a")).toThrow();
    expect(() => a.add(1, 4, "a")).toThrow();
    expect(() => new ChunkAssembler().add(0, 0, "a")).toThrow();
  });
});

describe("asset chunks", () => {
  const sample = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 256);

  test("base64 matches btoa and round-trips, including odd lengths", () => {
    for (const n of [0, 1, 2, 3, 4, 100, 49_152, 49_153, 150_001]) {
      const bytes = sample(n);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString("base64"));
      expect(base64ToBytes(b64)).toEqual(bytes);
    }
  });

  test("an asset splits into chunks that reassemble to the same bytes, in any order", () => {
    const bytes = sample(1000);
    const chunks = [...assetChunks(bytes, 99)];
    expect(chunks.length).toBeGreaterThan(5);
    const a = new AssetAssembler();
    let out: Uint8Array | null = null;
    for (const c of [...chunks].reverse()) out = a.add(c.index, c.total, c.data) ?? out;
    expect(out).toEqual(bytes);
  });

  test("an empty asset is one empty chunk", () => {
    expect([...assetChunks(new Uint8Array())]).toEqual([{ index: 0, total: 1, data: "" }]);
  });

  test("a default chunk stays under the message limit once serialised", () => {
    const bytes = sample(30_000_000);
    const sizes = [...assetChunks(bytes)].map(
      (c) =>
        new TextEncoder().encode(
          JSON.stringify({
            type: "chunk",
            kind: "asset",
            key: "k".repeat(64),
            index: c.index,
            total: c.total,
            data: c.data,
          })
        ).length
    );
    expect(sizes.length).toBe(3);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(CHUNK_BYTES);
  });

  test("the assembler rejects bad indexes, changed totals and invalid base64", () => {
    expect(() => new AssetAssembler().add(2, 2, "AAAA")).toThrow();
    const a = new AssetAssembler();
    a.add(0, 2, "AAAA");
    expect(() => a.add(1, 3, "AAAA")).toThrow();
    expect(() => a.add(0, 2, "AAAA")).toThrow(/duplicate/i);
    expect(() => new AssetAssembler().add(0, 1, "!!!!")).toThrow();
  });
});
