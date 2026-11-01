import { describe, expect, test } from "bun:test";
import { analyse, nestSelectors, resolveVars } from "../hover";
import { parseAuthoredBoxShadows } from "../styles";

const lookup = (table: Record<string, string>) => (name: string) => table[name];

describe("resolveVars", () => {
  test("substitutes a variable, a chain and a fallback", () => {
    expect(resolveVars("var(--a)", lookup({ "--a": "red" }))).toBe("red");
    expect(resolveVars("var(--a)", lookup({ "--a": "var(--b)", "--b": "#fff" }))).toBe("#fff");
    expect(resolveVars("var(--x, rgb(0 0 0 / .5))", lookup({}))).toBe("rgb(0 0 0 / .5)");
    expect(resolveVars("0 0 0 var(--s, 1px) var(--c)", lookup({ "--c": "red" }))).toBe(
      "0 0 0 1px red"
    );
  });
  test("gives up on a missing value, a cycle, a chain over 8 deep and runaway growth", () => {
    expect(resolveVars("var(--none)", lookup({}))).toBeNull();
    expect(resolveVars("var(--a)", lookup({ "--a": "var(--a)" }))).toBeNull();
    const deep: Record<string, string> = {};
    for (let i = 0; i < 12; i++) deep[`--v${i}`] = `var(--v${i + 1})`;
    deep["--v12"] = "red";
    expect(resolveVars("var(--v0)", lookup(deep))).toBeNull();
    const grow = { "--a": "var(--b) var(--b)", "--b": "var(--c) var(--c)", "--c": "x".repeat(900) };
    expect(resolveVars("var(--a) var(--a)", lookup(grow))).toBeNull();
    expect(resolveVars("var(--a", lookup({}))).toBeNull();
  });
});

describe("analyse", () => {
  test("replaces :hover with a match-anything pseudo-class", () => {
    expect(analyse("a:hover")).toEqual({ kind: "ok", selector: "a:is(*)" });
    expect(analyse(".card:hover .title")).toEqual({ kind: "ok", selector: ".card:is(*) .title" });
    expect(analyse(":host(:hover)")).toEqual({ kind: "ok", selector: ":host(:is(*))" });
    expect(analyse('[data-x=":hover"]')).toEqual({ kind: "none" });
  });
  test("skips :not(:hover) and counts :has and pseudo-elements as partial", () => {
    expect(analyse("a:not(:hover)")).toEqual({ kind: "skip" });
    expect(analyse("a:has(:hover)")).toEqual({ kind: "partial" });
    expect(analyse("a:hover::after")).toEqual({ kind: "partial" });
    expect(analyse("a:hover:before")).toEqual({ kind: "partial" });
  });
});

describe("analyse: a group needs :hover in every branch", () => {
  test(":is() and :where() with a branch that has no :hover are partial", () => {
    expect(analyse("x-btn:is(.a:hover, .b)")).toEqual({ kind: "partial" });
    expect(analyse(":where(.a, .b:hover) .x")).toEqual({ kind: "partial" });
    expect(analyse(":is(.a:hover, :is(.b:hover, .c)) .x")).toEqual({ kind: "partial" });
  });
  test("a group where every branch has :hover is read, nested or not", () => {
    expect(analyse("x-btn:is(.a:hover, .b:hover)")).toEqual({
      kind: "ok",
      selector: "x-btn:is(.a:is(*), .b:is(*))",
    });
    expect(analyse(":is(:is(a:hover, b:hover), c:hover)").kind).toBe("ok");
    expect(analyse(".card:is(.a, .b):hover .x").kind).toBe("ok");
  });
  test(":is(:not(:hover), .x:hover) is never read as hovered", () => {
    expect(analyse(":is(:not(:hover), .x:hover)").kind).not.toBe("ok");
  });
});

describe("nestSelectors", () => {
  test("keeps each parent branch apart, so a resting branch stays resting", () => {
    const { selectors } = nestSelectors(["& .x"], [".a", ".b:hover"]);
    expect(selectors).toEqual([":is(.a) .x", ":is(.b:hover) .x"]);
    expect(analyse(selectors[0] as string).kind).toBe("none");
    expect(analyse(selectors[1] as string).kind).toBe("ok");
  });
  test("a parent used inside :is() with a resting branch is partial", () => {
    const { selectors } = nestSelectors([":is(&, .y) .x"], [".b:hover"]);
    expect(analyse(selectors[0] as string).kind).toBe("partial");
  });
  test("reports truncation", () => {
    const parents = Array.from({ length: 60 }, (_, i) => `.p${i}:hover`);
    const out = nestSelectors(["& .x"], parents);
    expect(out.truncated).toBe(true);
    expect(out.selectors.length).toBeLessThan(60);
    expect(nestSelectors(["& .x"], [".a"]).truncated).toBe(false);
  });
});

describe("parseAuthoredBoxShadows", () => {
  test("reads hex, named and function colours", () => {
    expect(parseAuthoredBoxShadows("0 2px 4px #000")?.[0]?.color).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(parseAuthoredBoxShadows("inset 1px 1px rgb(255 0 0 / .5)")?.[0]).toMatchObject({
      inset: true,
      color: { r: 1, a: 0.5 },
    });
    expect(parseAuthoredBoxShadows("none")).toEqual([]);
  });
  test("refuses what it would have to guess", () => {
    expect(parseAuthoredBoxShadows("0 0 1em #000")).toBeNull();
    expect(parseAuthoredBoxShadows("0 0 2px")).toBeNull(); // currentcolor
    expect(parseAuthoredBoxShadows("0 0 2px currentcolor")).toBeNull();
    expect(parseAuthoredBoxShadows("0 0 calc(1px + 1px) #000")).toBeNull();
  });
});
