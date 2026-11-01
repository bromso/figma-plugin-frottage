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

  test("a token says how many times it's used", () => {
    const p = plan([
      ...["a", "b", "c", "d"].map((id) => filled(id, "#112233")),
      ...texts("s", 5, { size: 20 }),
    ]);
    expect(p.tokens.colors.find((c) => c.key === "#112233")?.uses).toBe(4);
    expect(p.tokens.textStyles[0]?.uses).toBe(5);
  });

  test("a set's floor of 1 proposes a value used once, with its key on the run", () => {
    const options = { ...DEFAULT_IMPORT_OPTIONS, tokenFloor: 1 };
    const p = plan([filled("a", "#112233"), ...texts("s", 1, { size: 40 })], {}, options);
    expect(p.tokens.colors.find((c) => c.key === "#112233")?.uses).toBe(1);
    expect(p.tokens.textStyles.map((s) => [s.fontSize, s.uses])).toEqual([[40, 1]]);
    expect(runsOf(p)[0]?.styleKey).toBeDefined();
    expect(frameFills(p).some((f) => f.type === "SOLID" && f.colorKey === "#112233")).toBe(true);
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

// ---------- Spacing

type FrameOp = Extract<PlanOp, { op: "frame" }>;

/** A flex row with three 100 px boxes `gap` apart, and `pad` of padding on every side. */
function gapRow(id: string, gap: number, pad = 0): ElementNode {
  const kid = (n: number) => {
    const k = filled(`${id}-${n}`, "#ffffff");
    k.box = { x: pad + n * (100 + gap), y: pad, w: 100, h: 50 };
    return k;
  };
  const row = el(
    id,
    [0, 0],
    [kid(0), kid(1), kid(2)],
    {
      layout: {
        ...el("x", [0, 0]).layout,
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        justifyContent: "normal",
        alignItems: "flex-start",
        gap: [0, gap],
        padding: [pad, pad, pad, pad],
      },
    },
    [300 + 2 * gap + 2 * pad, 50 + 2 * pad]
  );
  return row;
}

const rows = (prefix: string, n: number, gap: number, pad = 0) =>
  Array.from({ length: n }, (_, i) => gapRow(`${prefix}${i}`, gap, pad));
const frameOps = (p: LayerPlan) => p.ops.filter((o): o is FrameOp => o.op === "frame");
const spacingKeysOf = (p: LayerPlan) =>
  frameOps(p).flatMap((o) => ("spacingKeys" in o.layout && o.layout.spacingKeys) || []);

describe("spacing tokens", () => {
  test("a px custom property used 3 or more times is a spacing token", () => {
    const p = plan([...rows("a", 3, 16), ...rows("b", 2, 24)], {
      "--space-4": "16px",
      "--space-6": "24px",
    });
    expect(p.tokens.spacing).toEqual([
      { key: "--space-4=16", name: "spacing/4", cssVar: "--space-4", px: 16 },
    ]);
    const keys = spacingKeysOf(p);
    expect(keys).toHaveLength(3);
    for (const k of keys) expect(k.itemSpacing).toBe("--space-4=16");
  });

  test("rem resolves with the root font size", () => {
    const p = plan(rows("a", 3, 16), { "--gap": "1rem" });
    expect(p.tokens.spacing?.map((s) => [s.cssVar, s.px])).toEqual([["--gap", 16]]);
  });

  test("a rem value says in the report that it assumes a 16 px root", () => {
    const p = plan(rows("a", 3, 16), { "--gap": "1rem" });
    expect(p.report.warnings.some((w) => w.includes("16 px root"))).toBe(true);
    const q = plan(rows("a", 3, 16), { "--gap": "16px" });
    expect(q.report.warnings.some((w) => w.includes("16 px root"))).toBe(false);
  });

  test("a frame counts once for a length it uses on all four sides", () => {
    const two = plan(rows("a", 2, 0, 8), { "--padding": "8px" });
    expect(two.tokens.spacing).toEqual([]);
    const three = plan(rows("a", 3, 0, 8), { "--padding": "8px" });
    expect(three.tokens.spacing).toHaveLength(1);
  });

  test("a var() that names another property resolves", () => {
    const p = plan(rows("a", 3, 16), { "--base": "16px", "--space-4": "var(--base)" });
    expect(p.tokens.spacing?.map((s) => [s.cssVar, s.px])).toEqual([["--space-4", 16]]);
  });

  test("a value no custom property names stays plain", () => {
    const p = plan(rows("a", 4, 12), { "--space-4": "16px" });
    expect(p.tokens.spacing).toEqual([]);
    expect(spacingKeysOf(p)).toEqual([]);
  });

  test("matching is exact to 0.01 px", () => {
    const near = plan(rows("a", 3, 16.005), { "--space-4": "16px" });
    expect(near.tokens.spacing).toHaveLength(1);
    const off = plan(rows("a", 3, 16.5), { "--space-4": "16px" });
    expect(off.tokens.spacing).toEqual([]);
  });

  test("the variable name is spacing/<name>", () => {
    const p = plan(rows("a", 3, 16), { "--spacing-md": "16px" });
    expect(p.tokens.spacing?.[0]?.name).toBe("spacing/md");
    const q = plan(rows("a", 3, 16), { "--brand-gutter": "16px" });
    expect(q.tokens.spacing?.[0]?.name).toBe("spacing/brand-gutter");
  });

  test("padding on every side binds, each side by its own key", () => {
    const p = plan(rows("a", 3, 0, 8), { "--padding": "8px" });
    expect(p.tokens.spacing?.map((s) => s.cssVar)).toEqual(["--padding"]);
    const [first] = spacingKeysOf(p);
    expect(first?.padding).toEqual(["--padding=8", "--padding=8", "--padding=8", "--padding=8"]);
    expect(first?.itemSpacing).toBeUndefined();
  });

  test("a matching length alone isn't spacing: the name has to say so", () => {
    const props = {
      "--font-size-m": "16px",
      "--radius-m": "16px",
      "--border-width": "16px",
      "--shadow-blur": "16px",
      "--line-height": "16px",
      "--max-height": "16px",
      "--width-card": "16px",
      "--breakpoint-sm": "16px",
      "--unit": "16px",
    };
    const p = plan(rows("a", 3, 16), props);
    expect(p.tokens.spacing).toEqual([]);
    expect(spacingKeysOf(p)).toEqual([]);
  });

  test.each([
    "--space-m",
    "--spacing-m",
    "--gap-m",
    "--brand-gutter",
    "--margin-m",
    "--padding-m",
    "--inset-m",
    "--padding-inline",
  ])("%s says spacing", (name) => {
    expect(plan(rows("a", 3, 16), { [name]: "16px" }).tokens.spacing).toHaveLength(1);
  });

  test("a name that says both isn't spacing", () => {
    const p = plan(rows("a", 3, 16), { "--gap-font-size": "16px", "--padding-line": "16px" });
    expect(p.tokens.spacing).toEqual([]);
  });

  test("zero is not a spacing token", () => {
    const p = plan(rows("a", 4, 0), { "--space-0": "0px" });
    expect(p.tokens.spacing).toEqual([]);
  });

  test("two properties with one value: the shortest name, then the alphabetical one", () => {
    const props = { "--space-large": "16px", "--gap-b": "16px", "--gap-a": "16px" };
    const a = plan(rows("a", 3, 16), props);
    expect(a.tokens.spacing?.map((s) => s.cssVar)).toEqual(["--gap-a"]);
    const reversed = plan(rows("a", 3, 16), Object.fromEntries(Object.entries(props).reverse()));
    expect(reversed.tokens.spacing).toEqual(a.tokens.spacing);
  });

  test("two values cannot share a name", () => {
    const p = plan([...rows("a", 3, 16), ...rows("b", 3, 24)], {
      "--space-4": "16px",
      "--spacing-4": "24px",
    });
    expect(p.tokens.spacing?.map((s) => s.name)).toEqual(["spacing/4"]);
    // The value left without a name stays plain.
    expect(new Set(spacingKeysOf(p).map((k) => k.itemSpacing)).size).toBe(1);
  });

  test("a property Figma could not hold is not used", () => {
    const p = plan(rows("a", 3, 16), { "--space.4": "16px", "--a b": "16px" });
    expect(p.tokens.spacing).toEqual([]);
  });

  test("the options switch for styles and variables turns it off", () => {
    const p = plan(
      rows("a", 3, 16),
      { "--space-4": "16px" },
      {
        ...DEFAULT_IMPORT_OPTIONS,
        tokens: false,
      }
    );
    expect(p.tokens.spacing ?? []).toEqual([]);
    expect(spacingKeysOf(p)).toEqual([]);
  });

  test("auto layout off leaves nothing to bind", () => {
    const p = plan(
      rows("a", 3, 16),
      { "--space-4": "16px" },
      {
        ...DEFAULT_IMPORT_OPTIONS,
        autoLayout: false,
      }
    );
    expect(p.tokens.spacing).toEqual([]);
  });

  test("grid gaps count", () => {
    const grids = Array.from({ length: 3 }, (_, i) => {
      const g = el(
        `g${i}`,
        [0, 0],
        [filled(`g${i}a`, "#ffffff"), filled(`g${i}b`, "#ffffff")],
        {
          layout: {
            ...el("x", [0, 0]).layout,
            display: "grid",
            gridTemplateColumns: "100px 100px",
            gridTemplateRows: "50px",
            rowGap: 20,
            columnGap: 20,
          },
        },
        [220, 50]
      );
      g.children[0] = { ...(g.children[0] as ElementNode), box: { x: 0, y: 0, w: 100, h: 50 } };
      g.children[1] = { ...(g.children[1] as ElementNode), box: { x: 120, y: 0, w: 100, h: 50 } };
      return g;
    });
    const p = plan(grids, { "--gap": "20px" });
    const grid = frameOps(p).find((o) => o.layout.mode === "GRID");
    if (grid?.layout.mode !== "GRID") throw new Error("no grid");
    expect(grid.layout.spacingKeys).toMatchObject({ columnGap: "--gap=20" });
  });

  test("the cap is 200 tokens, and the rest stay plain and are reported", () => {
    const props: Record<string, string> = {};
    const frames: ElementNode[] = [];
    for (let i = 0; i < 201; i++) {
      props[`--space-${i}`] = `${i + 1}px`;
      frames.push(...rows(`r${i}-`, 3, i + 1));
    }
    const p = plan(frames, props);
    expect(p.tokens.spacing).toHaveLength(200);
    expect(p.tokens.spacingOver).toBe(1);
    expect(p.report.warnings).toContain(
      "Only 200 spacing values became variables; 1 more stayed a plain value."
    );
  });

  test("the plan survives postMessage", () => {
    const p = plan(rows("a", 3, 16), { "--space-4": "16px" });
    expect(JSON.parse(JSON.stringify(p.ops))).toEqual(p.ops);
  });
});
