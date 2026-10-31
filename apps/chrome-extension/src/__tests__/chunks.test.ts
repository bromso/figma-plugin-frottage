import { describe, expect, test } from "bun:test";
import { CHUNK_BYTES, ChunkAssembler, splitIntoChunks } from "../chunks";

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
