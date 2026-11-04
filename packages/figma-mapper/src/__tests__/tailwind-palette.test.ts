import { describe, expect, test } from "bun:test";
import { parseCssColor } from "@repo/capture-schema/css-values";
import { primitiveName } from "../infer";
import { tailwindName } from "../tailwind-palette";

const at = (css: string) => parseCssColor(css) as { r: number; g: number; b: number; a: number };
const step = (c: { r: number; g: number; b: number; a: number }, d: number) => ({
  ...c,
  r: c.r + d / 255,
});

describe("tailwindName", () => {
  test("names shadcn's neutrals after Tailwind's neutral palette", () => {
    expect(tailwindName(at("oklch(14.5% 0 0)"))).toBe("neutral/950");
    expect(tailwindName(at("oklch(98.5% 0 0)"))).toBe("neutral/50");
    expect(tailwindName(at("oklch(97% 0 0)"))).toBe("neutral/100");
  });

  test("names a chromatic Tailwind color", () => {
    expect(tailwindName(at("oklch(63.7% 0.237 25.331)"))).toBe("red/500");
  });

  test("a value one 8-bit step away is not Tailwind's", () => {
    const c = at("oklch(14.5% 0 0)");
    expect(tailwindName(step(c, 1))).toBeNull();
    expect(tailwindName(step(c, -1))).toBeNull();
  });

  test("a translucent value is not named", () => {
    expect(tailwindName({ ...at("oklch(14.5% 0 0)"), a: 0.5 })).toBeNull();
  });

  test("prefers neutral over gray, zinc, slate and stone at the same value", () => {
    // Achromatic grays in Tailwind's other families are not exact; neutral wins where they are.
    expect(tailwindName(at("oklch(97% 0 0)"))).toBe("neutral/100");
  });

  test("primitiveName uses it first, numbering a clash", () => {
    const c = at("oklch(98.5% 0 0)");
    expect(primitiveName(c, new Set())).toBe("color/neutral-50");
    expect(primitiveName(c, new Set(["color/neutral-50"]))).toBe("color/neutral-50-2");
    expect(primitiveName(step(c, 1), new Set())).toBe("color/gray-50");
  });
});
