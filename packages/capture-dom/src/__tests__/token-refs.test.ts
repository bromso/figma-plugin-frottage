import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRefReader } from "../token-refs";

// happy-dom drops @layer and nested rules and does not resolve var() in computed style, so the
// stylesheet and computed style are stand-ins; the elements and `matches` are happy-dom's.

class Decl {
  private values = new Map<string, { value: string; important: boolean }>();
  constructor(text: string) {
    for (const part of text.split(";")) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      const name = part.slice(0, colon).trim();
      let value = part.slice(colon + 1).trim();
      const important = /!important$/.test(value);
      if (important) value = value.replace(/\s*!important$/, "");
      this.values.set(name, { value, important });
    }
  }
  get length() {
    return this.values.size;
  }
  item(i: number) {
    return [...this.values.keys()][i] ?? "";
  }
  getPropertyValue(name: string) {
    return this.values.get(name)?.value ?? "";
  }
  getPropertyPriority(name: string) {
    return this.values.get(name)?.important ? "important" : "";
  }
}

class StyleRule {
  constructor(
    readonly selectorText: string,
    readonly style: Decl,
    readonly cssRules: unknown[]
  ) {}
}
class LayerBlockRule {
  constructor(
    readonly name: string,
    readonly cssRules: unknown[]
  ) {}
}
class LayerStatementRule {
  constructor(readonly nameList: string[]) {}
}
class MediaRule {
  readonly type = 4;
  constructor(
    readonly conditionText: string,
    readonly cssRules: unknown[]
  ) {}
}

/** Rules and declarations out of a small, well-formed stylesheet. */
function parse(css: string): { rules: unknown[]; decls: string } {
  const rules: unknown[] = [];
  let decls = "";
  let text = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i] as string;
    if (ch === ";") {
      const t = text.trim();
      if (t.startsWith("@layer")) {
        rules.push(
          new LayerStatementRule(
            t
              .slice(6)
              .split(",")
              .map((s) => s.trim())
          )
        );
      } else decls += `${t};`;
      text = "";
      i++;
    } else if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (depth > 0) {
        if (css[j] === "{") depth++;
        if (css[j] === "}") depth--;
        j++;
      }
      const body = parse(css.slice(i + 1, j - 1));
      const prelude = text.trim();
      if (prelude.startsWith("@layer"))
        rules.push(new LayerBlockRule(prelude.slice(6).trim(), body.rules));
      else if (prelude.startsWith("@media"))
        rules.push(new MediaRule(prelude.slice(6).trim(), body.rules));
      else rules.push(new StyleRule(prelude, new Decl(body.decls), body.rules));
      text = "";
      i = j;
    } else {
      text += ch;
      i++;
    }
  }
  if (text.trim()) decls += text;
  return { rules, decls };
}

type Computed = Record<string, string>;

function setup(
  css: string,
  html: string,
  root: Computed,
  computed: Record<string, Computed>,
  now: () => number = () => 0
) {
  const happy = new Window();
  const real = happy.document as unknown as Document;
  real.body.innerHTML = html;
  const styles = new Map<Element, Computed>();
  for (const [sel, values] of Object.entries(computed)) {
    styles.set(real.querySelector(sel) as Element, values);
  }
  styles.set(real.documentElement, { "font-size": "16px", ...root });
  const win = {
    CSSStyleRule: StyleRule,
    CSSLayerBlockRule: LayerBlockRule,
    CSSLayerStatementRule: LayerStatementRule,
    matchMedia: (q: string) => ({ matches: !/print/.test(q) }),
    CSS: { supports: () => true },
    getComputedStyle: (el: Element) => ({
      getPropertyValue: (name: string) => styles.get(el)?.[name] ?? "",
    }),
  };
  const doc = {
    defaultView: win,
    documentElement: real.documentElement,
    body: real.body,
    styleSheets: [{ cssRules: parse(css).rules }],
  } as unknown as Document;
  const warnings: string[] = [];
  const reader = createRefReader(doc, win as never, {
    now,
    report: (code) => warnings.push(code),
  });
  return { reader, warnings, $: (sel: string) => real.querySelector(sel) as Element };
}

const WHITE = "rgb(255, 255, 255)";
const BLACK = "rgb(0, 0, 0)";

describe("createRefReader", () => {
  test("a class rule's var() becomes the background ref", () => {
    const { reader, $ } = setup(
      ".bg-card { background-color: var(--color-card) }",
      `<div class="bg-card"></div>`,
      { "--color-card": "#ffffff" },
      { ".bg-card": { "background-color": WHITE } }
    );
    expect(reader.refsFor($(".bg-card"))).toEqual({ background: "--color-card" });
  });

  test("a later, a more specific and an !important rule win", () => {
    const root = { "--a": "#ffffff", "--b": "#ffffff", "--c": "#ffffff" };
    const later = setup(
      ".x { background-color: var(--a) } .x { background-color: var(--b) }",
      `<div class="x"></div>`,
      root,
      { ".x": { "background-color": WHITE } }
    );
    expect(later.reader.refsFor(later.$(".x"))?.background).toBe("--b");
    const specific = setup(
      "div.x { background-color: var(--a) } .x { background-color: var(--b) }",
      `<div class="x"></div>`,
      root,
      { ".x": { "background-color": WHITE } }
    );
    expect(specific.reader.refsFor(specific.$(".x"))?.background).toBe("--a");
    const important = setup(
      ".x { background-color: var(--c) !important } div.x { background-color: var(--a) }",
      `<div class="x"></div>`,
      root,
      { ".x": { "background-color": WHITE } }
    );
    expect(important.reader.refsFor(important.$(".x"))?.background).toBe("--c");
  });

  test("an unlayered rule beats a layered one, and later layers beat earlier ones", () => {
    const root = { "--a": "#ffffff", "--b": "#ffffff" };
    const unlayered = setup(
      ".x { color: var(--a) } @layer utilities { div.x { color: var(--b) } }",
      `<div class="x"></div>`,
      root,
      { ".x": { color: WHITE } }
    );
    expect(unlayered.reader.refsFor(unlayered.$(".x"))?.color).toBe("--a");
    const layers = setup(
      "@layer base, utilities; @layer utilities { .x { color: var(--b) } } @layer base { div.x { color: var(--a) } }",
      `<div class="x"></div>`,
      root,
      { ".x": { color: WHITE } }
    );
    expect(layers.reader.refsFor(layers.$(".x"))?.color).toBe("--b");
  });

  test("colour inherits from an ancestor's rule", () => {
    const { reader, $ } = setup(
      "body { color: var(--foreground) }",
      `<main><p>Hi</p></main>`,
      { "--foreground": "#000000" },
      { p: { color: BLACK }, main: { color: BLACK } }
    );
    expect(reader.refsFor($("p"))).toEqual({ color: "--foreground" });
  });

  test("calc(var(--x) * n) gives every side the scaled ref", () => {
    const { reader, $ } = setup(
      ".p-4 { padding: calc(var(--spacing) * 4) }",
      `<div class="p-4"></div>`,
      { "--spacing": "0.25rem" },
      {
        ".p-4": {
          "padding-top": "16px",
          "padding-right": "16px",
          "padding-bottom": "16px",
          "padding-left": "16px",
        },
      }
    );
    expect(reader.refsFor($(".p-4"))).toEqual({
      padding: ["--spacing*4", "--spacing*4", "--spacing*4", "--spacing*4"],
    });
  });

  test("a ref whose token differs from the computed value is dropped", () => {
    const { reader, $ } = setup(
      ".x { background-color: var(--brand); border-radius: var(--radius) }",
      `<div class="x"></div>`,
      { "--brand": "#ff0000", "--radius": "8px" },
      {
        ".x": {
          "background-color": WHITE,
          "border-top-left-radius": "4px",
          "border-top-right-radius": "4px",
          "border-bottom-right-radius": "4px",
          "border-bottom-left-radius": "4px",
        },
      }
    );
    expect(reader.refsFor($(".x"))).toBeUndefined();
  });

  test("past the time budget no refs are read, with one warning", () => {
    let t = 0;
    const { reader, warnings, $ } = setup(
      ".x { color: var(--a) } .y { color: var(--a) }",
      `<div class="x"></div><div class="y"></div>`,
      { "--a": "#ffffff" },
      { ".x": { color: WHITE }, ".y": { color: WHITE } },
      () => (t += 1001)
    );
    expect(reader.refsFor($(".x"))).toBeUndefined();
    expect(reader.refsFor($(".y"))).toBeUndefined();
    expect(warnings).toEqual(["token-refs-partial"]);
  });
  test("only time spent reading refs counts, not the capture's work between calls", () => {
    let t = 0;
    const { reader, warnings, $ } = setup(
      ".x { color: var(--a) } .y { color: var(--a) }",
      `<div class="x"></div><div class="y"></div>`,
      { "--a": "#ffffff" },
      { ".x": { color: WHITE }, ".y": { color: WHITE } },
      () => t
    );
    t += 5000;
    expect(reader.refsFor($(".x"))).toEqual({ color: "--a" });
    t += 5000;
    expect(reader.refsFor($(".y"))).toEqual({ color: "--a" });
    expect(warnings).toEqual([]);
  });

  test("a budget spent mid-walk keeps earlier refs and gives later nodes none", () => {
    let t = 0;
    let step = 0;
    const { reader, warnings, $ } = setup(
      ".x { color: var(--a) } .y { color: var(--a) } .z { color: var(--a) }",
      `<div class="x"></div><div class="y"></div><div class="z"></div>`,
      { "--a": "#ffffff" },
      { ".x": { color: WHITE }, ".y": { color: WHITE }, ".z": { color: WHITE } },
      () => (t += step)
    );
    expect(reader.refsFor($(".x"))).toEqual({ color: "--a" });
    step = 600;
    expect(reader.refsFor($(".y"))).toBeUndefined();
    expect(reader.refsFor($(".z"))).toBeUndefined();
    expect(reader.refsFor($(".x"))).toEqual({ color: "--a" });
    expect(warnings).toEqual(["token-refs-partial"]);
  });

  test("a rule under a media query that does not apply gives no ref", () => {
    const { reader, $ } = setup(
      "@media print { .x { color: var(--a) } } @media screen { .y { color: var(--a) } }",
      `<div class="x"></div><div class="y"></div>`,
      { "--a": "#ffffff" },
      { ".x": { color: WHITE }, ".y": { color: WHITE } }
    );
    expect(reader.refsFor($(".x"))).toBeUndefined();
    expect(reader.refsFor($(".y"))).toEqual({ color: "--a" });
  });
});
