import { describe, expect, test } from "bun:test";
import { browserNormalise, MAX_PIXELS, readHeader, sniff } from "../assets";

const bytes = (...parts: Array<number | number[]>) => Uint8Array.from(parts.flat());
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

const png = (w: number, h: number) =>
  bytes([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10], be32(13), [73, 72, 68, 82], be32(w), be32(h));

/** A JPEG head: SOI, optional EXIF APP1 with an orientation tag, then SOF0. */
function jpeg(w: number, h: number, orientation?: number, little = false): Uint8Array {
  const u16 = (n: number) => (little ? le16(n) : [n >> 8, n & 255]);
  const u32 = (n: number) => (little ? [...le16(n & 0xffff), ...le16(n >>> 16)] : be32(n));
  const out: number[] = [0xff, 0xd8];
  if (orientation !== undefined) {
    const tiff = [
      ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(0x2a),
      ...u32(8),
      ...u16(1),
      ...u16(0x0112),
      ...u16(3),
      ...u32(1),
      ...u16(orientation),
      0,
      0,
      ...u32(0),
    ];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    out.push(0xff, 0xe1, ...[(body.length + 2) >> 8, (body.length + 2) & 255], ...body);
  }
  out.push(0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0);
  return Uint8Array.from(out);
}

const riff = (fourcc: string, payload: number[]) =>
  bytes(
    [0x52, 0x49, 0x46, 0x46],
    [0, 0, 0, 0],
    [0x57, 0x45, 0x42, 0x50],
    [...fourcc].map((c) => c.charCodeAt(0)),
    [0, 0, 0, 0],
    payload
  );

describe("readHeader", () => {
  test("PNG", () => {
    const h = png(20000, 300);
    expect(sniff(h, "")).toBe("png");
    expect(readHeader(h, "png")).toEqual({ w: 20000, h: 300, orientation: 1 });
  });
  test("GIF", () => {
    const h = bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], le16(640), le16(480));
    expect(sniff(h, "")).toBe("gif");
    expect(readHeader(h, "gif")).toEqual({ w: 640, h: 480, orientation: 1 });
  });
  test("WebP VP8X, VP8L and VP8", () => {
    const x = riff("VP8X", [0, 0, 0, 0, ...le24(5000 - 1), ...le24(100 - 1)]);
    expect(sniff(x, "")).toBe("webp");
    expect(readHeader(x, "webp")).toEqual({ w: 5000, h: 100, orientation: 1 });
    const bits = ((300 - 1) | ((200 - 1) << 14)) >>> 0;
    const l = riff("VP8L", [
      0x2f,
      bits & 255,
      (bits >> 8) & 255,
      (bits >> 16) & 255,
      (bits >>> 24) & 255,
    ]);
    expect(readHeader(l, "webp")).toEqual({ w: 300, h: 200, orientation: 1 });
    const v = riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(120), ...le16(80)]);
    expect(readHeader(v, "webp")).toEqual({ w: 120, h: 80, orientation: 1 });
  });
  test("JPEG size, with and without EXIF orientation, in both byte orders", () => {
    expect(readHeader(jpeg(8000, 6000), "jpeg")).toEqual({ w: 8000, h: 6000, orientation: 1 });
    expect(readHeader(jpeg(40, 20, 6), "jpeg")).toEqual({ w: 40, h: 20, orientation: 6 });
    expect(readHeader(jpeg(40, 20, 3, true), "jpeg")).toEqual({ w: 40, h: 20, orientation: 3 });
  });
  test("WebP with ALPH and ICCP chunks before the image chunk", () => {
    const chunk = (cc: string, payload: number[]) => [
      ...[...cc].map((c) => c.charCodeAt(0)),
      payload.length & 255,
      0,
      0,
      0,
      ...payload,
      ...(payload.length % 2 ? [0] : []),
    ];
    const head = bytes(
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      chunk("ALPH", [1, 2, 3]),
      chunk("ICCP", [9, 9, 9, 9, 9, 9]),
      chunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(333), ...le16(222)])
    );
    expect(readHeader(head, "webp")).toEqual({ w: 333, h: 222, orientation: 1 });
  });
  test("truncated or unknown headers give null", () => {
    expect(readHeader(bytes([0x89, 0x50, 0x4e, 0x47]), "png")).toBeNull();
    expect(readHeader(bytes([0xff, 0xd8, 0xff]), "jpeg")).toBeNull();
    expect(readHeader(bytes([1, 2, 3]), "other")).toBeNull();
  });
});

describe("browserNormalise", () => {
  test("refuses an image over 100 megapixels before decoding it", async () => {
    const blob = new Blob([png(20000, 20000) as BlobPart]);
    expect(20000 * 20000).toBeGreaterThan(MAX_PIXELS);
    await expect(browserNormalise(blob)).rejects.toThrow(/megapixels/);
  });
  test("an unreadable header is checked after the decode and the bitmap is closed", async () => {
    let closed = false;
    const fake = async () =>
      ({
        width: 12000,
        height: 12000,
        close: () => {
          closed = true;
        },
      }) as unknown as ImageBitmap;
    await expect(
      browserNormalise(new Blob([bytes([1, 2, 3, 4]) as BlobPart]), undefined, fake)
    ).rejects.toThrow(/megapixels/);
    expect(closed).toBe(true);
  });
  test("refuses a huge JPEG and WebP the same way", async () => {
    await expect(browserNormalise(new Blob([jpeg(15000, 15000) as BlobPart]))).rejects.toThrow(
      /megapixels/
    );
    const x = riff("VP8X", [0, 0, 0, 0, ...le24(20000 - 1), ...le24(20000 - 1)]);
    await expect(browserNormalise(new Blob([x as BlobPart]))).rejects.toThrow(/megapixels/);
  });
});
