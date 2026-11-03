import { describe, expect, test } from "bun:test";
import { evalLength, parseCssColor } from "../css-values";

const near = (a: number, b: number) => Math.abs(a - b) <= 1 / 255;

describe("parseCssColor", () => {
  test("reads oklch", () => {
    const c = parseCssColor("oklch(92% .04 86.47)");
    expect(c).not.toBeNull();
    // Within 1/255 of what the capture's parser gave before it moved here.
    expect(near(c?.r ?? 0, 0.94236)).toBe(true);
    expect(near(c?.g ?? 0, 0.89181)).toBe(true);
    expect(near(c?.b ?? 0, 0.7806)).toBe(true);
    expect(c?.a).toBe(1);
  });

  test("reads alpha after a slash", () => {
    expect(parseCssColor("oklch(100% 0 0 / .1)")?.a).toBeCloseTo(0.1);
  });

  test("reads hex and rgb", () => {
    expect(parseCssColor("#ff0000")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseCssColor("rgb(0 0 255 / 50%)")).toEqual({ r: 0, g: 0, b: 1, a: 0.5 });
  });

  test("is null for anything else", () => {
    expect(parseCssColor("bogus")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("evalLength", () => {
  test("reads px and rem", () => {
    expect(evalLength("12px", {})).toBe(12);
    expect(evalLength(".5rem", {})).toBe(8);
    expect(evalLength("2rem", {}, 10)).toBe(20);
  });

  test("evaluates calc over a var", () => {
    expect(evalLength("calc(var(--radius) - 2px)", { "--radius": ".625rem" })).toBe(8);
    expect(evalLength("calc(var(--spacing) * 4)", { "--spacing": ".25rem" })).toBe(16);
  });

  test("follows var chains and fallbacks", () => {
    expect(evalLength("var(--a)", { "--a": "var(--b)", "--b": "6px" })).toBe(6);
    expect(evalLength("var(--missing, 3px)", {})).toBe(3);
    expect(evalLength("var(--missing)", {})).toBeNull();
  });

  test("handles precedence, parentheses and division", () => {
    expect(evalLength("calc(2px + 3px * 2)", {})).toBe(8);
    expect(evalLength("calc((2px + 3px) * 2)", {})).toBe(10);
    expect(evalLength("calc(10px / 4)", {})).toBe(2.5);
    expect(evalLength("calc(10px / 0)", {})).toBeNull();
  });

  test("is null for units it cannot resolve", () => {
    expect(evalLength("1.5em", {})).toBeNull();
    expect(evalLength("50%", {})).toBeNull();
    expect(evalLength("10vw", {})).toBeNull();
    expect(evalLength("calc(1px + 1em)", {})).toBeNull();
    expect(evalLength("calc(1px * 2px)", {})).toBeNull();
  });

  test("is null, and quick, for a fan-out that grows with every level", () => {
    const props: Record<string, string> = { "--a16": "1px" };
    for (let i = 15; i >= 1; i--) {
      props[`--a${i}`] = `calc(${Array(4)
        .fill(`var(--a${i + 1})`)
        .join(" + ")})`;
    }
    const start = performance.now();
    expect(evalLength("var(--a1)", props)).toBeNull();
    expect(performance.now() - start).toBeLessThan(100);
  });

  test("is null for a var loop", () => {
    expect(evalLength("var(--a)", { "--a": "var(--b)", "--b": "var(--a)" })).toBeNull();
    expect(evalLength("var(--a)", { "--a": "var(--a)" })).toBeNull();
  });
});
