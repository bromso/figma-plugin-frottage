import { describe, expect, test } from "bun:test";
import { parseComputedColor } from "../color";

describe("parseComputedColor", () => {
  test("parses modern colour syntaxes", () => {
    expect(parseComputedColor("rgb(255 0 0 / 50%)")).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    expect(parseComputedColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseComputedColor("oklch(0.7 0.1 200)")).not.toBeNull();
  });

  test("parses legacy rgb and color(srgb)", () => {
    expect(parseComputedColor("rgb(255, 255, 255)")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseComputedColor("color(srgb 1 0.5 0 / 0.25)")).toEqual({
      r: 1,
      g: 0.5,
      b: 0,
      a: 0.25,
    });
  });

  test("converts oklch, oklab, lab and hsl to sRGB within the unit range", () => {
    const white = parseComputedColor("oklch(1 0 0)");
    expect(white?.r).toBeCloseTo(1, 2);
    expect(white?.g).toBeCloseTo(1, 2);
    const red = parseComputedColor("oklch(0.628 0.2577 29.23)");
    expect(red?.r).toBeCloseTo(1, 1);
    expect(red?.g).toBeLessThan(0.1);
    expect(parseComputedColor("hsl(120 100% 50%)")).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    const lab = parseComputedColor("lab(100 0 0)");
    expect(lab?.b).toBeCloseTo(1, 2);
    const out = parseComputedColor("oklab(0.5 0.4 0.4)");
    for (const v of [out?.r, out?.g, out?.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test("returns null for garbage", () => {
    expect(parseComputedColor("not a colour")).toBeNull();
    expect(parseComputedColor("")).toBeNull();
  });
});
