import { describe, expect, test } from "bun:test";
import type { CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { mapCapture } from "../map";
import { DEFAULT_IMPORT_OPTIONS } from "../options";
import type { LayerPlan, PlanOp, PlanRun } from "../plan";
import { cap, el, inter, run, textNode } from "./fixtures";

const colour = (hex: string, a = 1) => ({
  r: Number.parseInt(hex.slice(1, 3), 16) / 255,
  g: Number.parseInt(hex.slice(3, 5), 16) / 255,
  b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  a,
});

const filled = (id: string, hex: string, a = 1) => {
  const base = el(id, [0, 0]);
  return { ...base, style: { ...base.style, backgroundColor: colour(hex, a) } };
};

/** One text node per use, so that each run counts once. */
const texts = (prefix: string, n: number, over: Partial<TextNode["runs"][number]> = {}) =>
  Array.from({ length: n }, (_, i) => textNode(`${prefix}${i}`, { runs: [run(over)] }));

const heading = (id: string, level: number, children: CaptureNode[]): ElementNode =>
  el(id, [0, 0], children, { semantic: { tag: `h${level}`, headingLevel: level } });

const plan = (
  children: CaptureNode[],
  props: Record<string, string> = {},
  options = DEFAULT_IMPORT_OPTIONS,
  url = "https://www.example.com/path"
): LayerPlan => {
  const capture = cap(el("root", [0, 0], children));
  capture.tokens.cssCustomProperties = props;
  capture.source.url = url;
  return mapCapture(capture, inter, options);
};

const frameFills = (p: LayerPlan) => p.ops.flatMap((op) => (op.op === "frame" ? op.fills : []));
const runsOf = (p: LayerPlan): PlanRun[] =>
  p.ops.flatMap((op: PlanOp) => (op.op === "text" ? op.runs : []));
const names = (p: LayerPlan) => p.tokens.textStyles.map((s) => [s.name, s.fontSize]);

describe("usage threshold", () => {
  test("values used 3 or more times become tokens", () => {
    const p = plan([
      ...["a", "b", "c"].map((id) => filled(id, "#112233")),
      ...["d", "e"].map((id) => filled(id, "#445566")),
      ...texts("s", 3, { size: 20 }),
      ...texts("t", 2, { size: 30 }),
    ]);
    expect(p.tokens.colors.map((c) => c.key)).toContain("#112233");
    expect(p.tokens.colors.map((c) => c.key)).not.toContain("#445566");
    expect(p.tokens.textStyles.map((s) => s.fontSize)).toEqual([20]);
  });

  test("runs and paints that made a token carry its key, and the others do not", () => {
    const p = plan([
      ...["a", "b", "c"].map((id) => filled(id, "#112233")),
      ...["d", "e"].map((id) => filled(id, "#445566")),
      ...texts("s", 3, { size: 20 }),
      ...texts("t", 2, { size: 30 }),
    ]);
    const kept = frameFills(p).filter((f) => f.type === "SOLID" && f.colorKey === "#112233");
    expect(kept).toHaveLength(3);
    const other = frameFills(p).find(
      (f) => f.type === "SOLID" && Math.abs(f.color.r - 0x44 / 255) < 1e-9
    );
    expect(other).not.toHaveProperty("colorKey");
    const key = p.tokens.textStyles[0]?.key;
    expect(runsOf(p).filter((r) => r.styleKey === key)).toHaveLength(3);
    expect(runsOf(p).filter((r) => r.fontSize === 30)[0]).not.toHaveProperty("styleKey");
  });

  test("fills, strokes and text colours all count towards one colour", () => {
    const side = { width: 1, color: colour("#123456"), style: "solid" };
    const bordered = el("b", [0, 0]);
    bordered.style = {
      ...bordered.style,
      borders: { top: side, right: side, bottom: side, left: side },
    };
    const p = plan([
      filled("f", "#123456"),
      bordered,
      textNode("t", { runs: [run({ color: colour("#123456") })] }),
    ]);
    expect(p.tokens.colors.map((c) => c.key)).toContain("#123456");
    const stroke = p.ops.flatMap((op) => (op.op === "frame" && op.strokes ? [op.strokes] : []));
    expect(stroke[0]?.colorKey).toBe("#123456");
    expect(runsOf(p)[0]?.colorKey).toBe("#123456");
  });

  test("a token's value does not depend on which use came first", () => {
    // Two wide-gamut values that round to one 8-bit colour, in either order.
    const near = (r: number) => {
      const base = el("x", [0, 0]);
      return { ...base, style: { ...base.style, backgroundColor: { r, g: 0, b: 0, a: 1 } } };
    };
    const a = plan([near(0.5001), near(0.5002), near(0.5003)]);
    const b = plan([near(0.5003), near(0.5002), near(0.5001)]);
    expect(a.tokens.colors).toEqual(b.tokens.colors);
    expect(a.tokens.colors[0]?.rgba).toEqual({ r: 128 / 255, g: 0, b: 0, a: 1 });
  });
});

describe("colour names", () => {
  const three = (hex: string, tag: string) => [1, 2, 3].map((i) => filled(`${tag}${i}`, hex));

  test("names come from matching CSS custom properties", () => {
    const p = plan(three("#112233", "a"), { "--color-primary": "#112233" });
    expect(p.tokens.colors[0]).toMatchObject({
      name: "color/primary",
      cssVar: "--color-primary",
      rgba: colour("#112233"),
    });
  });

  test.each([
    ["--color-primary", "color/primary"],
    ["--color-primary-dark", "color/primary/dark"],
    ["--c-brand-1-soft", "color/brand/1-soft"],
    ["--accent", "color/accent"],
    ["--Brand-Blue", "color/brand/blue"],
  ])("%s becomes %s", (prop, name) => {
    const p = plan(three("#112233", "a"), { [prop]: "#112233" });
    expect(p.tokens.colors[0]?.name).toBe(name);
    expect(p.tokens.colors[0]?.cssVar).toBe(prop);
  });

  test.each([
    ["#123", "#112233"],
    ["#112233", "#112233"],
    ["#112233ff", "#112233"],
    ["rgb(17, 34, 51)", "#112233"],
    ["rgb(17 34 51)", "#112233"],
    ["rgba(17, 34, 51, 1)", "#112233"],
    ["rgb(17 34 51 / 100%)", "#112233"],
    ["hsl(210, 50%, 13.3%)", "#112233"],
    ["white", "#ffffff"],
    ["BLACK", "#000000"],
  ])("the value %s resolves to %s", (value, hex) => {
    const p = plan(three(hex, "a"), { "--brand": value });
    expect(p.tokens.colors[0]?.name).toBe("color/brand");
  });

  test.each([
    ["rgba(17, 34, 51, 0.5)"],
    ["#11223380"],
    ["hsl(210 50% 13.3% / 50%)"],
    ["12px"],
    ["17 34 51"],
    ["calc(1px + 2px)"],
    ["var(--missing)"],
  ])("the value %s names nothing", (value) => {
    const p = plan(three("#112233", "a"), { "--brand": value });
    expect(p.tokens.colors[0]?.name).toBe("color/1");
    expect(p.tokens.colors[0]).not.toHaveProperty("cssVar");
  });

  test("a value behind var() still matches, and a loop does not hang", () => {
    const p = plan(three("#112233", "a"), {
      "--a": "var(--b)",
      "--b": "var(--a)",
      "--brand": "var(--blue)",
      "--blue": "var(--nothing, #112233)",
    });
    expect(p.tokens.colors[0]?.name).toBe("color/blue");
  });

  test("the shortest of several custom properties wins", () => {
    const p = plan(three("#112233", "a"), {
      "--color-brand-primary-dark": "#112233",
      "--color-ink": "#112233",
      "--color-text": "#112233",
    });
    expect(p.tokens.colors[0]).toMatchObject({ name: "color/ink", cssVar: "--color-ink" });
  });

  test("names stay unique across colours", () => {
    const p = plan([...three("#112233", "a"), ...three("#445566", "b")], {
      "--color-primary": "#112233",
      "--c-primary": "#445566",
    });
    const made = p.tokens.colors.map((c) => c.name);
    expect(new Set(made).size).toBe(2);
    expect(made).toContain("color/primary");
  });

  test("a custom property called color-1 does not collide with numbering", () => {
    const p = plan([...three("#112233", "a"), ...three("#445566", "b")], {
      "--color-1": "#445566",
    });
    expect(p.tokens.colors.map((c) => c.name).sort()).toEqual(["color/1", "color/2"]);
  });

  test("a property name Figma could not hold, or a selector-like one, is not used", () => {
    const p = plan(three("#112233", "a"), { "--a.b{c}": "#112233", "--color-": "#112233" });
    expect(p.tokens.colors[0]?.name).toBe("color/1");
  });

  test("custom properties for a colour under the threshold make nothing", () => {
    const p = plan([filled("a", "#112233")], { "--color-primary": "#112233" });
    expect(p.tokens.colors).toEqual([]);
  });

  test("the numbered ones go by use, most used first", () => {
    const p = plan([...three("#111111", "a"), ...three("#222222", "b"), filled("c", "#222222")]);
    expect(p.tokens.colors.map((c) => [c.name, c.key])).toEqual([
      ["color/1", "#222222"],
      ["color/2", "#111111"],
    ]);
  });
});

describe("text style names", () => {
  test("text styles are ordered heading/n and body/n by size", () => {
    const p = plan([
      ...[1, 2, 3].map((i) =>
        heading(`h${i}`, 1, [textNode(`h1t${i}`, { runs: [run({ size: 48 })] })])
      ),
      ...[1, 2, 3].map((i) =>
        heading(`j${i}`, 2, [textNode(`h2t${i}`, { runs: [run({ size: 32 })] })])
      ),
      ...texts("b", 5, { size: 16 }),
      ...texts("c", 3, { size: 14 }),
    ]);
    expect(names(p)).toEqual([
      ["heading/1", 48],
      ["heading/2", 32],
      ["body/1", 16],
      ["body/2", 14],
    ]);
  });

  test("large text with no heading tag is a heading, measured against the body size", () => {
    const body = Array.from({ length: 3 }, (_, i) =>
      textNode(`p${i}`, { text: "A long paragraph of text", runs: [run({ size: 16, end: 24 })] })
    );
    const p = plan([...body, ...texts("hero", 3, { size: 40 }), ...texts("lead", 3, { size: 18 })]);
    expect(names(p)).toEqual([
      ["heading/1", 40],
      ["body/1", 18],
      ["body/2", 16],
    ]);
  });

  test("a heading tag makes small text a heading", () => {
    const p = plan([
      ...[1, 2, 3].map((i) =>
        heading(`h${i}`, 4, [textNode(`t${i}`, { runs: [run({ size: 12 })] })])
      ),
      ...texts("b", 5, { size: 16 }),
    ]);
    expect(names(p)).toEqual([
      ["body/1", 16],
      ["heading/1", 12],
    ]);
  });

  test("a heading wrapped in collapsed elements still counts", () => {
    const wrap = (i: number) =>
      heading(`h${i}`, 2, [
        el(`s${i}`, [0, 0], [textNode(`t${i}`, { runs: [run({ size: 12 })] })]),
      ]);
    const p = plan([wrap(1), wrap(2), wrap(3), ...texts("b", 5, { size: 16 })]);
    expect(names(p)).toContainEqual(["heading/1", 12]);
  });

  test("one heading among many paragraphs of one style does not make them headings", () => {
    const p = plan([
      heading("h", 5, [textNode("ht", { runs: [run({ size: 16 })] })]),
      ...texts("b", 5, { size: 16 }),
    ]);
    expect(names(p)).toEqual([["body/1", 16]]);
  });

  test("the styles differ on every type field", () => {
    const p = plan([
      ...texts("a", 3),
      ...texts("b", 3, { weight: 700 }),
      ...texts("c", 3, { lineHeight: 24 }),
      ...texts("d", 3, { letterSpacing: 1 }),
      ...texts("e", 3, { decoration: "underline" }),
      ...texts("f", 3, { transform: "uppercase" }),
    ]);
    expect(new Set(p.tokens.textStyles.map((s) => s.key)).size).toBe(6);
    const bold = p.tokens.textStyles.find((s) => s.fontName.style === "Bold");
    expect(bold).toMatchObject({ fontSize: 16, lineHeight: null, letterSpacing: 0 });
    expect(p.tokens.textStyles.find((s) => s.textCase === "UPPER")).toBeTruthy();
    expect(p.tokens.textStyles.find((s) => s.decoration === "UNDERLINE")).toBeTruthy();
    expect(p.tokens.textStyles.find((s) => s.lineHeight === 24)).toBeTruthy();
    expect(p.tokens.textStyles.find((s) => s.letterSpacing === 1)).toBeTruthy();
  });
});

describe("what stays plain", () => {
  test("alpha colours stay plain paints", () => {
    const p = plan(
      [
        ...["a", "b", "c"].map((id) => filled(id, "#112233", 0.5)),
        ...texts("t", 3, { color: colour("#445566", 0.5) }),
      ],
      { "--veil": "rgba(17, 34, 51, 0.5)" }
    );
    expect(p.tokens.colors).toEqual([]);
    for (const f of frameFills(p)) expect(f).not.toHaveProperty("colorKey");
    for (const r of runsOf(p)) expect(r).not.toHaveProperty("colorKey");
  });

  test("shadows are not tokens", () => {
    const shadow = { x: 0, y: 1, blur: 2, spread: 0, inset: false, color: colour("#778899") };
    const shadowed = (id: string) => {
      const base = el(id, [0, 0]);
      return { ...base, style: { ...base.style, boxShadows: [shadow] } };
    };
    const p = plan([shadowed("a"), shadowed("b"), shadowed("c")]);
    expect(p.tokens.colors).toEqual([]);
  });

  test("hidden elements do not count", () => {
    const hide = (n: ReturnType<typeof filled>) => ({ ...n, visible: false });
    const p = plan([hide(filled("a", "#112233")), filled("b", "#112233"), filled("c", "#112233")]);
    expect(p.tokens.colors).toEqual([]);
  });

  test("tokens off makes none, and no paint or run carries a key", () => {
    const p = plan(
      [...["a", "b", "c"].map((id) => filled(id, "#112233")), ...texts("t", 3)],
      {},
      { ...DEFAULT_IMPORT_OPTIONS, tokens: false }
    );
    expect(p.tokens.colors).toEqual([]);
    expect(p.tokens.textStyles).toEqual([]);
    expect(JSON.stringify(p.ops)).not.toContain("colorKey");
    expect(JSON.stringify(p.ops)).not.toContain("styleKey");
  });
});

describe("collection", () => {
  test("the collection is the source hostname", () => {
    expect(plan([]).tokens.collection).toBe("www.example.com");
  });

  test.each([["file:///a/b.html"], ["not a url"], ["about:blank"]])(
    "a page with no hostname (%s) still has a collection",
    (url) => {
      expect(plan([], {}, DEFAULT_IMPORT_OPTIONS, url).tokens.collection).toBe("Frottage");
    }
  );

  test("the plan survives postMessage", () => {
    const p = plan([...["a", "b", "c"].map((id) => filled(id, "#112233")), ...texts("t", 3)]);
    expect(JSON.parse(JSON.stringify(p.tokens))).toEqual(p.tokens);
  });
});
